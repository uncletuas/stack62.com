import { Injectable } from '@nestjs/common';
import { FilesService } from '../../files/files.service';
import { RoomsService } from '../../rooms/rooms.service';
import { tool, type ToolDefinition } from './types';

/**
 * Coworker tools for reaching out to team members in Stack62 rooms.
 * Posting a message is sensitive (it has side effects on real humans),
 * so it's action-level 3 and sensitive=true in the action ladder.
 * External email lives in IntegrationTools (`integrations.send_email`),
 * which sends through the org's own connected mailbox.
 */
@Injectable()
export class CommunicationsTools {
  constructor(
    private readonly roomsService: RoomsService,
    private readonly files: FilesService,
  ) {}

  build(): ToolDefinition[] {
    return [
      tool(
        'rooms.send_message',
        'Post a message into a Stack62 room on behalf of the user. Use this when the user asks the Coworker to tell or notify someone — find the right room id (use rooms.list_mine first if you do not know it) and send the message as the user. To share files (an uploaded doc referenced as file:<id>, or one you created), pass their ids in attachmentFileIds — they render as downloadable chips. Mentioning @stack62 inside the body will summon another Coworker turn in that room.',
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
                'Plain text / markdown body of the message. Keep concise; this is a chat surface, not an email. Optional when attachmentFileIds is set.',
            },
            mentions: {
              type: 'array',
              items: { type: 'string' },
              description: 'Optional list of user ids to @mention.',
            },
            attachmentFileIds: {
              type: 'array',
              items: { type: 'string' },
              description: 'Optional stored file ids to share as attachments.',
            },
          },
          required: ['roomId'],
        },
        async (input, ctx) => {
          const roomId = String(input.roomId);
          const body = String(input.body || '').trim();
          const mentions = Array.isArray(input.mentions)
            ? (input.mentions as unknown[])
                .filter((v): v is string => typeof v === 'string')
                .slice(0, 50)
            : undefined;
          const fileIds = Array.isArray(input.attachmentFileIds)
            ? (input.attachmentFileIds as unknown[])
                .filter((v): v is string => typeof v === 'string')
                .slice(0, 10)
            : [];
          // Resolve each file id to a labelled attachment chip (access checked).
          const attachments: Array<{
            kind: 'file';
            id: string;
            label?: string;
          }> = [];
          for (const id of fileIds) {
            try {
              const file = await this.files.findOne(id, ctx.actorUserId);
              attachments.push({ kind: 'file', id, label: file.filename });
            } catch {
              /* skip a file the user can't access */
            }
          }
          const message = await this.roomsService.postMessage(
            roomId,
            {
              body,
              mentions,
              attachments: attachments.length ? attachments : undefined,
            },
            ctx.actorUserId,
            { authorKind: 'user' },
          );
          return {
            output: {
              messageId: message.id,
              roomId: message.roomId,
              createdAt: message.createdAt,
            },
            summary: `Posted to room ${roomId} (${body.length} chars${
              attachments.length ? `, ${attachments.length} file(s)` : ''
            }).`,
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
    ];
  }
}
