import { Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccessControlService } from '../../shared/access-control/access-control.service';
import { EmailConversationEntity } from './entities/email-conversation.entity';
import { EmailMessageEntity } from './entities/email-message.entity';
import { EMAIL_INBOUND_EVENT, type EmailInboundEvent } from './email-events';
import { IntegrationsService } from './integrations.service';

interface InboundInput {
  organizationId: string;
  workspaceId: string | null;
  connectionId: string;
  providerKey: string;
  counterpartyEmail: string;
  counterpartyName?: string | null;
  subject?: string | null;
  bodyText: string;
  bodyHtml?: string | null;
  externalId: string;
  threadId?: string | null;
  receivedAt?: Date | null;
  notifyUserId?: string | null;
}

interface OutboundInput {
  organizationId: string;
  workspaceId: string | null;
  connectionId: string;
  providerKey: string;
  counterpartyEmail: string;
  counterpartyName?: string | null;
  subject?: string | null;
  bodyText: string;
  externalId: string;
  threadId?: string | null;
  authoredBy: 'coworker' | 'user';
  status?: 'sent' | 'auto_replied' | 'draft' | 'failed';
}

/**
 * Owns email conversation threads and their messages — the system's
 * representation of an email exchange. Both Gmail and SMTP/IMAP connections
 * funnel inbound/outbound through here, so there's a single place to read
 * history and a single trigger point (EMAIL_INBOUND_EVENT) for the responder.
 */
@Injectable()
export class EmailConversationService {
  constructor(
    @InjectRepository(EmailConversationEntity)
    private readonly conversationRepo: Repository<EmailConversationEntity>,
    @InjectRepository(EmailMessageEntity)
    private readonly messageRepo: Repository<EmailMessageEntity>,
    private readonly accessControl: AccessControlService,
    private readonly events: EventEmitter2,
    private readonly integrations: IntegrationsService,
  ) {}

  /**
   * Record an inbound email and emit the inbound event. Idempotent on
   * (connectionId, externalId): the poller can see the same message twice, so
   * we never double-record. Returns null when it was a duplicate.
   */
  async recordInbound(input: InboundInput) {
    const existing = await this.messageRepo.findOne({
      where: { connectionId: input.connectionId, externalId: input.externalId },
    });
    if (existing) return null;

    const conversation = await this.upsertConversation(input, 'inbound');
    if (input.counterpartyName && !conversation.counterpartyName) {
      conversation.counterpartyName = input.counterpartyName;
    }
    conversation.unreadCount += 1;
    await this.conversationRepo.save(conversation);

    const message = await this.messageRepo.save(
      this.messageRepo.create({
        conversationId: conversation.id,
        organizationId: input.organizationId,
        connectionId: input.connectionId,
        direction: 'inbound',
        subject: input.subject ?? null,
        bodyText: input.bodyText,
        bodyHtml: input.bodyHtml ?? null,
        externalId: input.externalId,
        authoredBy: 'contact',
        status: 'received',
        receivedAt: input.receivedAt ?? new Date(),
      }),
    );

    const event: EmailInboundEvent = {
      conversationId: conversation.id,
      messageId: message.id,
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      connectionId: input.connectionId,
      providerKey: input.providerKey,
      counterpartyEmail: input.counterpartyEmail,
      counterpartyName: conversation.counterpartyName,
      subject: input.subject ?? null,
      bodyText: input.bodyText,
      notifyUserId: input.notifyUserId ?? null,
    };
    this.events.emit(EMAIL_INBOUND_EVENT, event);
    return { conversation, message };
  }

  /** Record an outbound email (coworker draft/auto-reply or user-sent). */
  async recordOutbound(input: OutboundInput) {
    const existing = await this.messageRepo.findOne({
      where: { connectionId: input.connectionId, externalId: input.externalId },
    });
    if (existing) return existing;
    const conversation = await this.upsertConversation(input, 'outbound');
    await this.conversationRepo.save(conversation);
    return this.messageRepo.save(
      this.messageRepo.create({
        conversationId: conversation.id,
        organizationId: input.organizationId,
        connectionId: input.connectionId,
        direction: 'outbound',
        subject: input.subject ?? null,
        bodyText: input.bodyText,
        externalId: input.externalId,
        authoredBy: input.authoredBy,
        status: input.status ?? 'sent',
        receivedAt: new Date(),
      }),
    );
  }

  /** Recent messages for a conversation, oldest→newest, for prompt context. */
  async recentMessages(conversationId: string, limit = 12) {
    const rows = await this.messageRepo.find({
      where: { conversationId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
    return rows.reverse();
  }

  async getConversationById(conversationId: string) {
    const conversation = await this.conversationRepo.findOne({
      where: { id: conversationId },
    });
    if (!conversation) {
      throw new NotFoundException('Email conversation not found.');
    }
    return conversation;
  }

  /** Replace/clear the latest draft for a conversation (one live draft each). */
  async getLatestDraft(conversationId: string) {
    return this.messageRepo.findOne({
      where: { conversationId, status: 'draft' },
      order: { createdAt: 'DESC' },
    });
  }

  async saveDraft(input: {
    conversation: EmailConversationEntity;
    bodyText: string;
    subject: string | null;
  }) {
    // Keep a single live draft per conversation.
    await this.messageRepo.delete({
      conversationId: input.conversation.id,
      status: 'draft',
    });
    return this.messageRepo.save(
      this.messageRepo.create({
        conversationId: input.conversation.id,
        organizationId: input.conversation.organizationId,
        connectionId: input.conversation.connectionId,
        direction: 'outbound',
        subject: input.subject,
        bodyText: input.bodyText,
        externalId: `draft-${input.conversation.id}-${Date.now()}`,
        authoredBy: 'coworker',
        status: 'draft',
      }),
    );
  }

  /** List conversations for the operator UI. */
  async listConversations(
    filters: { organizationId: string; workspaceId?: string },
    actorUserId: string,
  ) {
    await this.accessControl.assertResolvedAccess(actorUserId, {
      resource: 'organization',
      action: 'read',
      organizationId: filters.organizationId,
      workspaceId: filters.workspaceId,
    });
    const qb = this.conversationRepo
      .createQueryBuilder('c')
      .where('c.organizationId = :organizationId', {
        organizationId: filters.organizationId,
      });
    if (filters.workspaceId) {
      qb.andWhere('c.workspaceId = :workspaceId', {
        workspaceId: filters.workspaceId,
      });
    }
    return qb
      .orderBy('c.lastMessageAt', 'DESC', 'NULLS LAST')
      .take(100)
      .getMany();
  }

  /** Messages for a conversation (access-controlled), oldest→newest. */
  async listMessages(conversationId: string, actorUserId: string) {
    const conversation = await this.getConversationById(conversationId);
    await this.accessControl.assertResolvedAccess(actorUserId, {
      resource: 'organization',
      action: 'read',
      organizationId: conversation.organizationId,
      workspaceId: conversation.workspaceId ?? undefined,
    });
    const messages = await this.messageRepo.find({
      where: { conversationId },
      order: { createdAt: 'ASC' },
      take: 500,
    });
    return { conversation, messages };
  }

  /** Mark read, or override the auto-responder for this thread. */
  async updateConversation(
    conversationId: string,
    patch: { markRead?: boolean; autoReplyOverride?: boolean | null },
    actorUserId: string,
  ) {
    const conversation = await this.getConversationById(conversationId);
    await this.accessControl.assertResolvedAccess(actorUserId, {
      resource: 'organization',
      action: 'update',
      organizationId: conversation.organizationId,
      workspaceId: conversation.workspaceId ?? undefined,
    });
    if (patch.markRead) conversation.unreadCount = 0;
    if (patch.autoReplyOverride !== undefined) {
      conversation.autoReplyOverride = patch.autoReplyOverride;
    }
    return this.conversationRepo.save(conversation);
  }

  /**
   * Approve + send a reply in a thread from the org's connected mailbox.
   * Records the outbound message and clears the live draft.
   */
  async sendReply(
    conversationId: string,
    input: { bodyText: string; subject?: string },
    actorUserId: string,
  ) {
    const conversation = await this.getConversationById(conversationId);
    await this.accessControl.assertResolvedAccess(actorUserId, {
      resource: 'organization',
      action: 'update',
      organizationId: conversation.organizationId,
      workspaceId: conversation.workspaceId ?? undefined,
    });
    const subject = input.subject ?? this.replySubject(conversation.subject);
    const result = await this.integrations.sendOrgEmail(
      {
        organizationId: conversation.organizationId,
        workspaceId: conversation.workspaceId,
        actorUserId,
      },
      { to: [conversation.counterpartyEmail], subject, text: input.bodyText },
    );
    await this.messageRepo.delete({ conversationId, status: 'draft' });
    await this.recordOutbound({
      organizationId: conversation.organizationId,
      workspaceId: conversation.workspaceId,
      connectionId: conversation.connectionId,
      providerKey: conversation.providerKey,
      counterpartyEmail: conversation.counterpartyEmail,
      subject,
      bodyText: input.bodyText,
      externalId: result.id ?? `sent-${conversationId}-${Date.now()}`,
      threadId: conversation.threadId,
      authoredBy: 'user',
      status: 'sent',
    });
    return { ok: true as const, provider: result.provider };
  }

  /** "Re: …" subject for a reply. */
  replySubject(subject: string | null): string {
    const base = (subject ?? '').trim();
    if (!base) return 'Re:';
    return /^re:/i.test(base) ? base : `Re: ${base}`;
  }

  /** Total unread across the workspace, for the inbox badge. */
  async unreadCount(organizationId: string, workspaceId?: string) {
    const qb = this.conversationRepo
      .createQueryBuilder('c')
      .select('COALESCE(SUM(c.unreadCount), 0)', 'total')
      .where('c.organizationId = :organizationId', { organizationId });
    if (workspaceId) {
      qb.andWhere('c.workspaceId = :workspaceId', { workspaceId });
    }
    const row = await qb.getRawOne<{ total: string }>();
    return Number(row?.total ?? 0);
  }

  private async upsertConversation(
    input: {
      organizationId: string;
      workspaceId: string | null;
      connectionId: string;
      providerKey: string;
      counterpartyEmail: string;
      counterpartyName?: string | null;
      subject?: string | null;
      bodyText: string;
      threadId?: string | null;
    },
    direction: 'inbound' | 'outbound',
  ) {
    const threadKey = (input.threadId || input.counterpartyEmail).slice(0, 255);
    let conversation = await this.conversationRepo.findOne({
      where: { connectionId: input.connectionId, threadKey },
    });
    if (!conversation) {
      conversation = this.conversationRepo.create({
        organizationId: input.organizationId,
        workspaceId: input.workspaceId,
        connectionId: input.connectionId,
        providerKey: input.providerKey,
        threadKey,
        threadId: input.threadId ?? null,
        counterpartyEmail: input.counterpartyEmail,
        counterpartyName: input.counterpartyName ?? null,
        subject: input.subject ?? null,
        unreadCount: 0,
        status: 'open',
      });
    }
    conversation.lastMessageAt = new Date();
    conversation.lastMessagePreview = (input.bodyText || '').slice(0, 160);
    conversation.lastDirection = direction;
    if (input.subject && !conversation.subject)
      conversation.subject = input.subject;
    return conversation;
  }
}
