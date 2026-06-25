import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { WhatsAppAgentService } from '../coworker/whatsapp-agent.service';
import type { WhatsAppAgentConfigEntity } from '../coworker/entities/whatsapp-agent-config.entity';
import { IntegrationsService } from '../integrations/integrations.service';
import { WhatsAppConversationService } from '../integrations/whatsapp-conversation.service';
import {
  WHATSAPP_INBOUND_EVENT,
  type WhatsAppInboundEvent,
} from '../integrations/whatsapp-events';
import { WhatsAppWebService } from '../integrations/whatsapp-web.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { AnthropicClient, type AnthropicMessage } from './anthropic.client';

/**
 * Listens for inbound WhatsApp messages and drafts + sends the coworker's
 * reply, honouring the workspace's WhatsApp agent settings: on/off, schedule
 * (time of response), delay, manner/tone, coworker identity, and the business
 * information the coworker answers with.
 *
 * Decoupled from the integrations module via the event bus so there is no
 * circular dependency between integrations and the AI engine.
 */
@Injectable()
export class WhatsAppResponderService {
  private readonly logger = new Logger(WhatsAppResponderService.name);
  private static readonly MAX_DELAY_MS = 600_000;
  private static readonly AWAY_COOLDOWN_MS = 6 * 60 * 60 * 1000;

  constructor(
    private readonly agent: WhatsAppAgentService,
    private readonly conversations: WhatsAppConversationService,
    private readonly whatsAppWeb: WhatsAppWebService,
    private readonly integrations: IntegrationsService,
    private readonly organizations: OrganizationsService,
    private readonly anthropic: AnthropicClient,
  ) {}

  @OnEvent(WHATSAPP_INBOUND_EVENT, { async: true })
  async handleInbound(event: WhatsAppInboundEvent): Promise<void> {
    try {
      await this.process(event);
    } catch (err) {
      this.logger.warn(
        `WhatsApp auto-reply failed for ${event.conversationId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private async process(event: WhatsAppInboundEvent): Promise<void> {
    if (!event.workspaceId) return; // auto-reply config is per workspace
    const config = await this.agent.getForResponder(
      event.organizationId,
      event.workspaceId,
    );
    if (!config || !config.autoReplyEnabled) return;

    const conversation = await this.conversations.getConversationById(
      event.conversationId,
    );
    // Per-chat override: false = a human took over, pause the bot.
    if (conversation.autoReplyOverride === false) return;

    const withinWindow = this.agent.isWithinSchedule(config);
    const history = await this.conversations.recentMessages(
      event.conversationId,
      14,
    );

    if (!withinWindow) {
      await this.maybeSendAwayMessage(event, config, history);
      return;
    }

    if (this.dailyCapReached(config, history)) {
      this.logger.log(
        `WhatsApp auto-reply cap reached for ${event.conversationId}; skipping.`,
      );
      return;
    }

    const reply = await this.generateReply(event, config, history);
    if (!reply) return;

    await this.delay(config.responseDelaySeconds);
    await this.send(event, reply, 'auto_replied');
  }

  private async generateReply(
    event: WhatsAppInboundEvent,
    config: WhatsAppAgentConfigEntity,
    history: Array<{ direction: string; text: string }>,
  ): Promise<string | null> {
    const system = this.buildSystemPrompt(config, event);
    const messages: AnthropicMessage[] = history
      .filter((m) => m.text)
      .map((m) => ({
        role: m.direction === 'inbound' ? 'user' : 'assistant',
        content: m.text,
      }));
    if (
      messages.length === 0 ||
      messages[messages.length - 1].role !== 'user'
    ) {
      messages.push({ role: 'user', content: event.text });
    }
    const apiKey = await this.resolveOrgKey(event.organizationId);
    try {
      const completion = await this.anthropic.complete({
        system,
        messages,
        maxTokens: 400,
        temperature: 0.6,
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
        `WhatsApp reply generation failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
  }

  private buildSystemPrompt(
    config: WhatsAppAgentConfigEntity,
    event: WhatsAppInboundEvent,
  ): string {
    const name = config.identityName?.trim() || 'the assistant';
    const lines: string[] = [];
    lines.push(
      `You are ${name}${
        config.identityRole ? `, ${config.identityRole}` : ''
      }, replying to a customer on WhatsApp on behalf of the business.`,
    );
    if (event.contactName) {
      lines.push(`The customer's name is ${event.contactName}.`);
    }
    if (config.tone) {
      lines.push(`Manner and tone: ${config.tone}`);
    }
    lines.push(
      'Reply as a real WhatsApp chat message: short, natural, and directly useful. No email-style greetings or sign-offs unless it fits the chat. Never reveal you are an AI. Do not invent facts, prices, or commitments beyond the business information below.',
    );
    if (config.businessInfo) {
      lines.push(
        `Business information you may use to answer (this is the source of truth):\n${config.businessInfo}`,
      );
    }
    lines.push(
      'If you cannot answer from the business information, say you will check and have someone follow up — do not make things up.',
    );
    return lines.join('\n\n');
  }

  private applySignature(
    text: string,
    config: WhatsAppAgentConfigEntity,
  ): string {
    const sig = config.signature?.trim();
    if (!sig) return text;
    if (text.includes(sig)) return text;
    return `${text}\n\n${sig}`;
  }

  private async maybeSendAwayMessage(
    event: WhatsAppInboundEvent,
    config: WhatsAppAgentConfigEntity,
    history: Array<{ direction: string; text: string; createdAt?: Date }>,
  ): Promise<void> {
    const away = config.awayMessage?.trim();
    if (!away) return;
    // Don't re-send the away message on every after-hours ping.
    const lastOutbound = [...history]
      .reverse()
      .find((m) => m.direction === 'outbound');
    if (
      lastOutbound?.createdAt &&
      Date.now() - new Date(lastOutbound.createdAt).getTime() <
        WhatsAppResponderService.AWAY_COOLDOWN_MS
    ) {
      return;
    }
    await this.send(event, this.applySignature(away, config), 'auto_replied');
  }

  private dailyCapReached(
    config: WhatsAppAgentConfigEntity,
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

  private async send(
    event: WhatsAppInboundEvent,
    text: string,
    status: 'sent' | 'auto_replied',
  ): Promise<void> {
    const providerKey =
      event.channel === 'web' ? 'whatsapp-web' : 'whatsapp-cloud';
    const connection = await this.integrations.resolveConnection(
      event.organizationId,
      providerKey,
      event.workspaceId,
    );
    if (!connection) {
      this.logger.warn(
        `No ${providerKey} connection to send auto-reply for ${event.conversationId}.`,
      );
      return;
    }
    let waMessageId: string | null = null;
    if (event.channel === 'web') {
      const result = await this.whatsAppWeb.sendText(
        connection,
        event.contactPhone,
        text,
        {
          organizationId: event.organizationId,
          workspaceId: event.workspaceId,
          actorUserId: null,
          source: 'engine',
        },
      );
      waMessageId = result.id ?? null;
    } else {
      const result = await this.integrations.sendWhatsApp(
        {
          organizationId: event.organizationId,
          workspaceId: event.workspaceId ?? undefined,
          to: event.contactPhone,
          message: text,
        },
        null,
      );
      waMessageId = result.id ?? null;
    }
    await this.conversations.recordOutbound({
      organizationId: event.organizationId,
      workspaceId: event.workspaceId,
      connectionId: connection.id,
      channel: event.channel,
      contactPhone: event.contactPhone,
      text,
      waMessageId,
      authoredBy: 'coworker',
      status,
    });
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

  private async delay(seconds: number): Promise<void> {
    const ms = Math.min(
      Math.max((seconds ?? 0) * 1000, 0),
      WhatsAppResponderService.MAX_DELAY_MS,
    );
    if (ms === 0) return;
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}
