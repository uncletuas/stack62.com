import { Injectable } from '@nestjs/common';
import { EmailSenderService } from '../../file-sharing/email-sender.service';
import { RoomsService } from '../../rooms/rooms.service';
import { tool, type ToolDefinition } from './types';

/**
 * Coworker tools for reaching out: chatting with team members in
 * Stack62 rooms and sending external email. Both are sensitive (they
 * have side effects on real humans), so they're action-level 3 and
 * sensitive=true by default in the action ladder.
 */
@Injectable()
export class CommunicationsTools {
  constructor(
    private readonly roomsService: RoomsService,
    private readonly emailSender: EmailSenderService,
  ) {}

  build(): ToolDefinition[] {
    return [
      tool(
        'rooms.send_message',
        'Post a message into a Stack62 room on behalf of the user. Use this when the user asks the Coworker to tell or notify someone — find the right room id (use rooms.list_mine first if you do not know it) and send the message as the user. Mentioning @stack62 inside the body will summon another Coworker turn in that room.',
        {
          properties: {
            roomId: {
              type: 'string',
              description:
                'Stack62 room id. Use rooms.list_mine to discover the right id (channel, group, dm, or coworker_private).',
            },
            body: {
              type: 'string',
              description:
                'Plain text / markdown body of the message. Keep concise; this is a chat surface, not an email.',
            },
            mentions: {
              type: 'array',
              items: { type: 'string' },
              description: 'Optional list of user ids to @mention.',
            },
          },
          required: ['roomId', 'body'],
        },
        async (input, ctx) => {
          const roomId = String(input.roomId);
          const body = String(input.body || '').trim();
          const mentions = Array.isArray(input.mentions)
            ? (input.mentions as unknown[])
                .filter((v): v is string => typeof v === 'string')
                .slice(0, 50)
            : undefined;
          const message = await this.roomsService.postMessage(
            roomId,
            { body, mentions },
            ctx.actorUserId,
            { authorKind: 'user' },
          );
          return {
            output: {
              messageId: message.id,
              roomId: message.roomId,
              createdAt: message.createdAt,
            },
            summary: `Posted to room ${roomId} (${body.length} chars).`,
          };
        },
        { actionLevel: 3, sensitive: true },
      ),

      tool(
        'rooms.list_mine',
        'List the rooms the current user is a member of in this organization. Returns id + kind + name so the Coworker can pick the right one for rooms.send_message.',
        {
          properties: {},
        },
        async (_input, ctx) => {
          const rooms = await this.roomsService.listMyRooms(
            ctx.organizationId,
            ctx.actorUserId,
          );
          return {
            output: rooms.map((r) => ({
              id: r.id,
              kind: r.kind,
              name: r.name,
              lastActivityAt: r.lastActivityAt,
            })),
            summary: `${rooms.length} room${rooms.length === 1 ? '' : 's'}.`,
          };
        },
        { actionLevel: 1 },
      ),

      tool(
        'email.send',
        'Send an email to one or more recipients via the workspace email integration (Resend). Use when the user explicitly asks to email someone — never proactively. Subject is required. Body can include markdown-like newlines; we wrap it in a simple HTML template.',
        {
          properties: {
            to: {
              oneOf: [
                { type: 'string' },
                { type: 'array', items: { type: 'string' } },
              ],
              description:
                'Recipient address, or array of recipient addresses (max 10).',
            },
            subject: { type: 'string' },
            body: {
              type: 'string',
              description:
                'Plain-text body. Newlines are preserved in the rendered email.',
            },
            replyTo: { type: 'string' },
          },
          required: ['to', 'subject', 'body'],
        },
        async (input) => {
          const recipients = Array.isArray(input.to)
            ? (input.to as unknown[])
                .filter((v): v is string => typeof v === 'string')
                .slice(0, 10)
            : typeof input.to === 'string'
              ? [input.to]
              : [];
          if (recipients.length === 0) {
            throw new Error('No recipients provided.');
          }
          const subject = String(input.subject || '').slice(0, 200);
          const body = String(input.body || '');
          const replyTo =
            typeof input.replyTo === 'string' ? input.replyTo : undefined;

          let sent = 0;
          for (const to of recipients) {
            const ok = await this.emailSender.sendEmail({
              to,
              subject,
              text: body,
              html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#222;">${body
                .split(/\n{2,}/)
                .map((para) => `<p>${escapeHtml(para).replace(/\n/g, '<br />')}</p>`)
                .join('')}<p style="margin-top:32px;color:#888;font-size:12px;">Sent via Stack62.</p></div>`,
              replyTo,
            });
            if (ok) sent++;
          }
          return {
            output: {
              recipients,
              sent,
              configured: this.emailSender.isConfigured(),
            },
            summary: this.emailSender.isConfigured()
              ? `Sent to ${sent}/${recipients.length} recipient${
                  recipients.length === 1 ? '' : 's'
                }.`
              : 'Email provider not configured — message not sent.',
          };
        },
        { actionLevel: 3, sensitive: true },
      ),
    ];
  }
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
