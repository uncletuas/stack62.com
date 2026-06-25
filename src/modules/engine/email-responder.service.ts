import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EmailAgentService } from '../coworker/email-agent.service';
import type { EmailAgentConfigEntity } from '../coworker/entities/email-agent-config.entity';
import { EmailConversationService } from '../integrations/email-conversation.service';
import {
  EMAIL_INBOUND_EVENT,
  type EmailInboundEvent,
} from '../integrations/email-events';
import { IntegrationsService } from '../integrations/integrations.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { RoomsService } from '../rooms/rooms.service';
import { AnthropicClient, type AnthropicMessage } from './anthropic.client';

/**
 * Listens for inbound email and prepares the coworker's reply. By default it
 * DRAFTS a reply (saved on the thread) and notifies the user for approval; if
 * the workspace's email agent has auto-send on, it sends immediately. Honours
 * enable/schedule/daily-cap/per-thread-override, mirroring the WhatsApp responder.
 *
 * Decoupled from integrations via the event bus to avoid a circular dependency.
 */
@Injectable()
export class EmailResponderService {
  private readonly logger = new Logger(EmailResponderService.name);

  constructor(
    private readonly agent: EmailAgentService,
    private readonly conversations: EmailConversationService,
    private readonly integrations: IntegrationsService,
    private readonly organizations: OrganizationsService,
    private readonly rooms: RoomsService,
    private readonly anthropic: AnthropicClient,
  ) {}

  @OnEvent(EMAIL_INBOUND_EVENT, { async: true })
  async handleInbound(event: EmailInboundEvent): Promise<void> {
    try {
      await this.process(event);
    } catch (err) {
      this.logger.warn(
        `Email auto-reply failed for ${event.conversationId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private async process(event: EmailInboundEvent): Promise<void> {
    if (!event.workspaceId) return; // config is per workspace
    const config = await this.agent.getForResponder(
      event.organizationId,
      event.workspaceId,
    );
    if (!config || !config.enabled) return;

    const conversation = await this.conversations.getConversationById(
      event.conversationId,
    );
    if (conversation.autoReplyOverride === false) return;
    if (!this.agent.isWithinSchedule(config)) return;

    const history = await this.conversations.recentMessages(
      event.conversationId,
      20,
    );
    if (this.dailyCapReached(config, history)) {
      this.logger.log(
        `Email auto-reply cap reached for workspace ${event.workspaceId}; drafting only.`,
      );
    }

    const reply = await this.generateReply(event, config, history);
    if (!reply) return;

    const subject = this.conversations.replySubject(event.subject);
    const canAutoSend =
      config.autoSend && !this.dailyCapReached(config, history);

    if (canAutoSend) {
      try {
        const result = await this.integrations.sendOrgEmail(
          {
            organizationId: event.organizationId,
            workspaceId: event.workspaceId,
            actorUserId: event.notifyUserId,
          },
          { to: [event.counterpartyEmail], subject, text: reply },
        );
        await this.conversations.recordOutbound({
          organizationId: event.organizationId,
          workspaceId: event.workspaceId,
          connectionId: event.connectionId,
          providerKey: event.providerKey,
          counterpartyEmail: event.counterpartyEmail,
          subject,
          bodyText: reply,
          externalId: result.id ?? `auto-${event.conversationId}-${Date.now()}`,
          threadId: conversation.threadId,
          authoredBy: 'coworker',
          status: 'auto_replied',
        });
        await this.notify(event, reply, true);
      } catch (err) {
        this.logger.warn(
          `Email auto-send failed; leaving a draft instead: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        await this.conversations.saveDraft({
          conversation,
          bodyText: reply,
          subject,
        });
        await this.notify(event, reply, false);
      }
    } else {
      await this.conversations.saveDraft({
        conversation,
        bodyText: reply,
        subject,
      });
      await this.notify(event, reply, false);
    }
  }

  private async generateReply(
    event: EmailInboundEvent,
    config: EmailAgentConfigEntity,
    history: Array<{ direction: string; bodyText: string }>,
  ): Promise<string | null> {
    const system = this.buildSystemPrompt(config, event);
    const messages: AnthropicMessage[] = history
      .filter((m) => m.bodyText)
      .map((m) => ({
        role: m.direction === 'inbound' ? 'user' : 'assistant',
        content: m.bodyText,
      }));
    if (
      messages.length === 0 ||
      messages[messages.length - 1].role !== 'user'
    ) {
      messages.push({ role: 'user', content: event.bodyText });
    }
    const apiKey = await this.resolveOrgKey(event.organizationId);
    try {
      const completion = await this.anthropic.complete({
        system,
        messages,
        maxTokens: 700,
        temperature: 0.5,
        apiKey,
      });
      const text = completion.content
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();
      if (!text) return null;
      return this.applySignature(text, config);
    } catch (err) {
      this.logger.warn(
        `Email reply generation failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
  }

  private buildSystemPrompt(
    config: EmailAgentConfigEntity,
    event: EmailInboundEvent,
  ): string {
    const name = config.identityName?.trim() || 'the assistant';
    const lines: string[] = [];
    lines.push(
      `You are ${name}${
        config.identityRole ? `, ${config.identityRole}` : ''
      }, drafting an email reply on behalf of the business.`,
    );
    if (event.counterpartyName) {
      lines.push(`You are replying to ${event.counterpartyName}.`);
    }
    if (config.tone) lines.push(`Manner and tone: ${config.tone}`);
    lines.push(
      'Write a clear, complete email reply: a brief greeting, the answer, and a short sign-off. Plain text only. Never reveal you are an AI. Do not invent facts, prices, or commitments beyond the business information below.',
    );
    if (config.businessInfo) {
      lines.push(
        `Business information you may use (this is the source of truth):\n${config.businessInfo}`,
      );
    }
    lines.push(
      'If you cannot answer from the business information, say you will check and follow up — do not make things up.',
    );
    return lines.join('\n\n');
  }

  private applySignature(text: string, config: EmailAgentConfigEntity): string {
    const sig = config.signature?.trim();
    if (!sig || text.includes(sig)) return text;
    return `${text}\n\n${sig}`;
  }

  private dailyCapReached(
    config: EmailAgentConfigEntity,
    history: Array<{
      direction: string;
      authoredBy?: string;
      createdAt?: Date;
    }>,
  ): boolean {
    if (!config.maxAutoRepliesPerDay || config.maxAutoRepliesPerDay <= 0) {
      return false;
    }
    const since = Date.now() - 24 * 60 * 60 * 1000;
    const count = history.filter(
      (m) =>
        m.direction === 'outbound' &&
        m.authoredBy === 'coworker' &&
        m.createdAt &&
        new Date(m.createdAt).getTime() >= since,
    ).length;
    return count >= config.maxAutoRepliesPerDay;
  }

  /** Notify the mailbox owner in their private coworker room. */
  private async notify(
    event: EmailInboundEvent,
    reply: string,
    sent: boolean,
  ): Promise<void> {
    if (!event.notifyUserId) return;
    try {
      const room = await this.rooms.getOrCreatePrivateCoworkerRoom(
        event.organizationId,
        event.notifyUserId,
      );
      const from = event.counterpartyName
        ? `${event.counterpartyName} <${event.counterpartyEmail}>`
        : event.counterpartyEmail;
      const heading = sent
        ? `📧 New email from ${from} — I replied automatically:`
        : `📧 New email from ${from}${
            event.subject ? ` — "${event.subject}"` : ''
          }. I drafted a reply for your review (open the Email inbox to send or edit):`;
      const body = `${heading}\n\n> ${event.bodyText.slice(0, 400)}\n\n**${
        sent ? 'Sent reply' : 'Draft reply'
      }:**\n${reply}`;
      await this.rooms.postMessage(room.id, { body }, event.notifyUserId, {
        authorKind: 'coworker',
      });
    } catch (err) {
      this.logger.warn(
        `Email notify failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async resolveOrgKey(organizationId: string): Promise<string | null> {
    try {
      const org = await this.organizations.findById(organizationId);
      return (
        (org as { openrouterApiKey?: string | null } | null)
          ?.openrouterApiKey ?? null
      );
    } catch {
      return null;
    }
  }
}
