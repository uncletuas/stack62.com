import { Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { AccessControlService } from '../../shared/access-control/access-control.service';
import { WhatsAppConversationEntity } from './entities/whatsapp-conversation.entity';
import { WhatsAppMessageEntity } from './entities/whatsapp-message.entity';
import {
  WHATSAPP_INBOUND_EVENT,
  type WhatsAppInboundEvent,
} from './whatsapp-events';

/** Media attachment carried by an inbound/outbound message. */
export interface MessageMedia {
  mediaType: 'image' | 'video' | 'audio' | 'document' | 'sticker';
  mediaFileId: string;
  mediaMimeType: string | null;
  mediaFilename: string | null;
}

interface InboundInput {
  organizationId: string;
  workspaceId: string | null;
  connectionId: string;
  channel: 'web' | 'cloud';
  contactPhone: string;
  contactJid?: string | null;
  contactName?: string | null;
  contactAvatarUrl?: string | null;
  text: string;
  waMessageId?: string | null;
  media?: MessageMedia | null;
  replyToMessageId?: string | null;
  replyToPreview?: string | null;
}

interface OutboundInput {
  organizationId: string;
  workspaceId: string | null;
  connectionId: string;
  channel: 'web' | 'cloud';
  contactPhone: string;
  contactJid?: string | null;
  contactName?: string | null;
  text: string;
  waMessageId?: string | null;
  authoredBy: 'coworker' | 'user';
  status?: 'sent' | 'auto_replied' | 'failed';
  media?: MessageMedia | null;
  replyToMessageId?: string | null;
  replyToPreview?: string | null;
}

/** A short inbox/thread preview for a message that may be media-only. */
function previewFor(text: string, media?: MessageMedia | null): string {
  if (text?.trim()) return text.slice(0, 160);
  switch (media?.mediaType) {
    case 'image':
      return '📷 Photo';
    case 'video':
      return '🎬 Video';
    case 'audio':
      return '🎙️ Audio';
    case 'sticker':
      return '🌟 Sticker';
    case 'document':
      return `📎 ${media.mediaFilename ?? 'Document'}`;
    default:
      return '';
  }
}

/**
 * Owns WhatsApp conversation threads and their messages — the system's
 * representation of "a WhatsApp chat". Both channels (linked device + Cloud
 * API) funnel inbound/outbound messages through here so there is a single
 * place to read history and a single trigger point for the auto-responder.
 */
@Injectable()
export class WhatsAppConversationService {
  constructor(
    @InjectRepository(WhatsAppConversationEntity)
    private readonly conversationRepo: Repository<WhatsAppConversationEntity>,
    @InjectRepository(WhatsAppMessageEntity)
    private readonly messageRepo: Repository<WhatsAppMessageEntity>,
    private readonly accessControl: AccessControlService,
    private readonly events: EventEmitter2,
  ) {}

  /** Record an inbound message and emit the inbound event for the responder. */
  async recordInbound(input: InboundInput) {
    const phone = this.normalizePhone(input.contactPhone);
    const conversation = await this.upsertConversation(input, phone, 'inbound');
    if (input.contactName && !conversation.contactName) {
      conversation.contactName = input.contactName;
    }
    if (input.contactJid && !conversation.contactJid) {
      conversation.contactJid = input.contactJid;
    }
    // Refresh the avatar on every inbound — WhatsApp CDN URLs expire and the
    // contact may have changed their picture since we last saw them.
    if (input.contactAvatarUrl) {
      conversation.contactAvatarUrl = input.contactAvatarUrl;
    }
    conversation.unreadCount += 1;
    await this.conversationRepo.save(conversation);

    const message = await this.messageRepo.save(
      this.messageRepo.create({
        conversationId: conversation.id,
        organizationId: input.organizationId,
        connectionId: input.connectionId,
        direction: 'inbound',
        text: input.text,
        waMessageId: input.waMessageId ?? null,
        authoredBy: 'contact',
        status: 'received',
        mediaType: input.media?.mediaType ?? null,
        mediaFileId: input.media?.mediaFileId ?? null,
        mediaMimeType: input.media?.mediaMimeType ?? null,
        mediaFilename: input.media?.mediaFilename ?? null,
        replyToMessageId: input.replyToMessageId ?? null,
        replyToPreview: input.replyToPreview ?? null,
      }),
    );

    const event: WhatsAppInboundEvent = {
      conversationId: conversation.id,
      messageId: message.id,
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      connectionId: input.connectionId,
      channel: input.channel,
      contactPhone: phone,
      contactName: conversation.contactName,
      text: input.text,
    };
    this.events.emit(WHATSAPP_INBOUND_EVENT, event);
    return { conversation, message };
  }

  /**
   * Record an outbound message — a coworker auto-reply, a reply sent from the
   * Stack62 UI, or a message the operator sent from their own phone/another
   * linked device (mirrored back to us as a `fromMe` event).
   *
   * Idempotent on `waMessageId`: the same WhatsApp message can reach us twice
   * (once when we send it, once when the socket echoes it back), so we never
   * double-record. The first writer wins, which keeps the coworker's own
   * replies attributed to `coworker` rather than the later `user` echo.
   */
  async recordOutbound(input: OutboundInput) {
    if (input.waMessageId) {
      const existing = await this.messageRepo.findOne({
        where: {
          connectionId: input.connectionId,
          waMessageId: input.waMessageId,
        },
      });
      if (existing) return existing;
    }
    const phone = this.normalizePhone(input.contactPhone);
    const conversation = await this.upsertConversation(
      input,
      phone,
      'outbound',
    );
    if (input.contactName && !conversation.contactName) {
      conversation.contactName = input.contactName;
    }
    if (input.contactJid && !conversation.contactJid) {
      conversation.contactJid = input.contactJid;
    }
    await this.conversationRepo.save(conversation);
    return this.messageRepo.save(
      this.messageRepo.create({
        conversationId: conversation.id,
        organizationId: input.organizationId,
        connectionId: input.connectionId,
        direction: 'outbound',
        text: input.text,
        waMessageId: input.waMessageId ?? null,
        authoredBy: input.authoredBy,
        status: input.status ?? 'sent',
        mediaType: input.media?.mediaType ?? null,
        mediaFileId: input.media?.mediaFileId ?? null,
        mediaMimeType: input.media?.mediaMimeType ?? null,
        mediaFilename: input.media?.mediaFilename ?? null,
        replyToMessageId: input.replyToMessageId ?? null,
        replyToPreview: input.replyToPreview ?? null,
      }),
    );
  }

  /** Look up a stored message by id (for reply/react/delete operations). */
  async getMessageById(messageId: string) {
    const message = await this.messageRepo.findOne({
      where: { id: messageId },
    });
    if (!message) throw new NotFoundException('Message not found.');
    return message;
  }

  /** Find a message by its provider id within a connection. */
  async findByWaMessageId(connectionId: string, waMessageId: string) {
    return this.messageRepo.findOne({
      where: { connectionId, waMessageId },
    });
  }

  /** Record/clear an emoji reaction on a message (from us or the contact). */
  async setReaction(messageId: string, who: 'me' | 'them', emoji: string) {
    const message = await this.getMessageById(messageId);
    const reactions = { ...(message.reactions ?? {}) };
    if (emoji) reactions[who] = emoji;
    else delete reactions[who];
    message.reactions = Object.keys(reactions).length ? reactions : null;
    return this.messageRepo.save(message);
  }

  /** Mark a message deleted-for-everyone (tombstone). */
  async markDeleted(messageId: string) {
    const message = await this.getMessageById(messageId);
    message.deleted = true;
    message.text = '';
    message.mediaFileId = null;
    return this.messageRepo.save(message);
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
      throw new NotFoundException('WhatsApp conversation not found.');
    }
    return conversation;
  }

  /** Persist a freshly-fetched profile picture URL on a conversation. */
  async updateAvatar(conversationId: string, url: string | null) {
    const conversation = await this.getConversationById(conversationId);
    conversation.contactAvatarUrl = url;
    return this.conversationRepo.save(conversation);
  }

  /** Conversations on a connection that still have no avatar (for backfill). */
  async conversationsMissingAvatar(connectionId: string, limit = 50) {
    return this.conversationRepo.find({
      where: { connectionId, contactAvatarUrl: IsNull() },
      order: { lastMessageAt: 'DESC' },
      take: limit,
    });
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

  /** Mark a conversation read, or override the auto-responder for it. */
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

  private async upsertConversation(
    input: {
      organizationId: string;
      workspaceId: string | null;
      connectionId: string;
      channel: 'web' | 'cloud';
      contactJid?: string | null;
      text: string;
      media?: MessageMedia | null;
    },
    phone: string,
    direction: 'inbound' | 'outbound',
  ) {
    let conversation = await this.conversationRepo.findOne({
      where: { connectionId: input.connectionId, contactPhone: phone },
    });
    if (!conversation) {
      conversation = this.conversationRepo.create({
        organizationId: input.organizationId,
        workspaceId: input.workspaceId,
        connectionId: input.connectionId,
        channel: input.channel,
        contactPhone: phone,
        contactJid: input.contactJid ?? null,
        unreadCount: 0,
        status: 'open',
      });
    }
    conversation.lastMessageAt = new Date();
    conversation.lastMessagePreview = previewFor(input.text, input.media);
    conversation.lastDirection = direction;
    return conversation;
  }

  private normalizePhone(value: string) {
    const digits = value.replace(/[^0-9]/g, '');
    return digits || value;
  }
}
