import { Injectable } from '@nestjs/common';
import { MeetingBotService } from '../../meeting-bot/meeting-bot.service';
import { tool, type ToolDefinition } from './types';

/**
 * Meeting bot tools. The Coworker uses these when the user says
 * "attend my 3 PM Meet and take notes" or "did anything happen in
 * yesterday's product sync?". Three verbs:
 *
 *   meetings.attend       — schedule the bot to join a Meet URL
 *   meetings.list_mine    — show recent attended meetings + status
 *   meetings.summary      — fetch the summary + transcript of one
 */
@Injectable()
export class MeetingsTools {
  constructor(private readonly meetingBot: MeetingBotService) {}

  build(): ToolDefinition[] {
    return [
      tool(
        'meetings.attend',
        'Send the Coworker bot to attend a Google Meet on the user\'s behalf. The bot joins, captures Meet\'s live captions, and at the end of the call generates a summary + decisions + action items. Only Google Meet URLs (https://meet.google.com/...) are supported.',
        {
          properties: {
            meetingUrl: {
              type: 'string',
              description:
                'Full Google Meet URL the bot should join. e.g. https://meet.google.com/abc-defg-hij',
            },
            title: {
              type: 'string',
              description:
                'Optional human label for the meeting (e.g. "Product weekly"). Shows up in the user\'s meeting list and on the summary.',
            },
            roomId: {
              type: 'string',
              description:
                'Optional Coworker room id where the summary should be posted at end-of-call. Leave unset to keep it on the session page only.',
            },
          },
          required: ['meetingUrl'],
        },
        async (input, ctx) => {
          if (!ctx.workspaceId) {
            throw new Error('A workspace context is required.');
          }
          const session = await this.meetingBot.schedule({
            organizationId: ctx.organizationId,
            workspaceId: ctx.workspaceId,
            meetingUrl: String(input.meetingUrl),
            title:
              typeof input.title === 'string' ? input.title : undefined,
            roomId:
              typeof input.roomId === 'string' ? input.roomId : undefined,
            requestedByUserId: ctx.actorUserId,
          });
          return {
            output: {
              sessionId: session.id,
              status: session.status,
              meetingUrl: session.meetingUrl,
            },
            summary:
              `Bot scheduled to join. You'll see "${session.title || 'the meeting'}" in your meetings list shortly.`,
          };
        },
        { actionLevel: 3, sensitive: true },
      ),

      tool(
        'meetings.list_mine',
        'List the most recent meeting-bot sessions the current user has scheduled (active and past). Returns id, status, meetingUrl, title, startedAt, endedAt.',
        { properties: {} },
        async (_input, ctx) => {
          const rows = await this.meetingBot.listForUser(
            ctx.organizationId,
            ctx.actorUserId,
            20,
          );
          return {
            output: rows.map((s) => ({
              id: s.id,
              status: s.status,
              title: s.title,
              meetingUrl: s.meetingUrl,
              startedAt: s.startedAt,
              endedAt: s.endedAt,
              errorMessage: s.errorMessage,
            })),
            summary: `${rows.length} session${rows.length === 1 ? '' : 's'}.`,
          };
        },
        { actionLevel: 1 },
      ),

      tool(
        'meetings.summary',
        'Fetch the summary + transcript of a past meeting-bot session. Use this to answer "what did we decide in the standup?" — the Coworker can quote back the captured captions.',
        {
          properties: {
            sessionId: {
              type: 'string',
              description: 'The meeting session id from meetings.list_mine.',
            },
            includeTranscript: {
              type: 'boolean',
              description: 'When true (default), include the per-line transcript along with the summary.',
            },
          },
          required: ['sessionId'],
        },
        async (input, ctx) => {
          const sessionId = String(input.sessionId);
          const session = await this.meetingBot.findById(
            sessionId,
            ctx.actorUserId,
          );
          const includeTranscript = input.includeTranscript !== false;
          const transcript = includeTranscript
            ? await this.meetingBot.getTranscript(sessionId, ctx.actorUserId)
            : [];
          return {
            output: {
              session: {
                id: session.id,
                title: session.title,
                status: session.status,
                startedAt: session.startedAt,
                endedAt: session.endedAt,
                summary: session.summary,
              },
              transcript: transcript.map((t) => ({
                speakerLabel: t.speakerLabel,
                text: t.text,
                startsAtSec: t.startsAtSec,
              })),
            },
            summary: session.summary
              ? `Summary available (${transcript.length} caption rows).`
              : `Session ${session.status}; no summary yet.`,
          };
        },
        { actionLevel: 1 },
      ),
    ];
  }
}
