import { Injectable } from '@nestjs/common';
import { SchedulesService } from '../../schedules/schedules.service';
import { tool, type ToolDefinition } from './types';

/**
 * Schedules tools — let the Coworker set up cron-style autonomous
 * runs in natural language. "Remind me to follow up with Sarah every
 * weekday at 9 AM" → Coworker parses the time/recurrence and calls
 * schedules.create with assignedToCoworker=true.
 *
 * Two tools:
 *   schedules.create — make a new schedule entry. Caller provides
 *     ISO start time + optional RRULE for recurrence + optional
 *     reminder text. assignedToCoworker defaults true since the
 *     Coworker is the one being asked to do this.
 *   schedules.list_mine — list the schedules attached to the current
 *     workspace so the Coworker can introspect / cancel.
 */
@Injectable()
export class SchedulesTools {
  constructor(private readonly schedulesService: SchedulesService) {}

  build(): ToolDefinition[] {
    return [
      tool(
        'schedules.create',
        'Create a recurring or one-off schedule on the user\'s behalf. Use this when the user asks "schedule X for Y" or "remind me at Z" or "every Monday do W". Always set assignedToCoworker=true (default) so this fires through autonomous mode — the user can flip individual ones to manual reminders from the Schedules UI.',
        {
          properties: {
            title: {
              type: 'string',
              description: 'Short label the user will recognise in the schedules list.',
            },
            kind: {
              type: 'string',
              enum: ['reminder', 'job', 'workflow', 'task'],
              description:
                '"reminder" for plain alerts; "job"/"workflow"/"task" hook into the relevant runtime.',
            },
            startsAt: {
              type: 'string',
              description:
                'ISO-8601 datetime for the first fire. For "every weekday at 9 AM" set this to the next weekday 9 AM and add recurrenceRule.',
            },
            endsAt: {
              type: 'string',
              description: 'Optional ISO-8601 end of the schedule window.',
            },
            recurrenceRule: {
              type: 'string',
              description:
                'Optional iCalendar RRULE (RFC 5545). e.g. "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR" for every weekday.',
            },
            reminderText: {
              type: 'string',
              description: 'Optional message body for reminder-kind schedules.',
            },
            assignedToCoworker: {
              type: 'boolean',
              description:
                'When true (default), the Coworker handles the schedule autonomously when autonomousMode is on. When false, the schedule reminds the human only.',
            },
            taskId: { type: 'string', description: 'Link to an existing task.' },
            systemId: { type: 'string', description: 'Optional system scope.' },
          },
          required: ['title', 'kind', 'startsAt'],
        },
        async (input, ctx) => {
          if (!ctx.workspaceId) {
            throw new Error(
              'A workspace context is required to create a schedule.',
            );
          }
          const dto = {
            organizationId: ctx.organizationId,
            workspaceId: ctx.workspaceId,
            systemId:
              typeof input.systemId === 'string' ? input.systemId : undefined,
            taskId:
              typeof input.taskId === 'string' ? input.taskId : undefined,
            title: String(input.title),
            kind: String(input.kind),
            startsAt: new Date(String(input.startsAt)),
            endsAt: input.endsAt ? new Date(String(input.endsAt)) : undefined,
            recurrenceRule:
              typeof input.recurrenceRule === 'string'
                ? input.recurrenceRule
                : undefined,
            metadata: input.reminderText
              ? { reminderText: String(input.reminderText) }
              : undefined,
          };
          const schedule = await this.schedulesService.create(
            dto,
            ctx.actorUserId,
          );
          // Patch the new schedule with the Coworker-assignment flag.
          // schedulesService.create doesn't expose the flag in its
          // DTO yet, so we update the row directly after creation.
          const assigned =
            input.assignedToCoworker === undefined
              ? true
              : Boolean(input.assignedToCoworker);
          if (assigned) {
            await this.schedulesService.markAssignedToCoworker(
              schedule.id,
              true,
            );
          }
          return {
            output: {
              id: schedule.id,
              title: schedule.title,
              startsAt: schedule.startsAt,
              recurrenceRule: schedule.recurrenceRule,
              assignedToCoworker: assigned,
            },
            summary: `Scheduled "${schedule.title}" for ${new Date(schedule.startsAt).toLocaleString()}${assigned ? ' (Coworker will handle it)' : ''}.`,
          };
        },
        { actionLevel: 2 },
      ),

      tool(
        'schedules.list_mine',
        'List schedules for the current workspace. Returns the next 20 upcoming entries sorted by start time. Use this to answer "what\'s on my schedule?" or to find a schedule the user wants to cancel.',
        {
          properties: {
            includePast: {
              type: 'boolean',
              description: 'Set true to include schedules already past their startsAt.',
            },
          },
        },
        async (_input, ctx) => {
          if (!ctx.workspaceId) {
            return {
              output: { schedules: [] },
              summary: 'No workspace context.',
            };
          }
          const list = await this.schedulesService.findAll(
            {
              organizationId: ctx.organizationId,
              workspaceId: ctx.workspaceId,
            },
            ctx.actorUserId,
          );
          const trimmed = list.slice(0, 20).map(
            (s: {
              id: string;
              title: string;
              kind: string;
              status: string;
              startsAt: Date;
              recurrenceRule: string | null;
              assignedToCoworker: boolean;
            }) => ({
              id: s.id,
              title: s.title,
              kind: s.kind,
              status: s.status,
              startsAt: s.startsAt,
              recurrenceRule: s.recurrenceRule,
              assignedToCoworker: s.assignedToCoworker,
            }),
          );
          return {
            output: { schedules: trimmed },
            summary: `${trimmed.length} schedule${trimmed.length === 1 ? '' : 's'}.`,
          };
        },
        { actionLevel: 1 },
      ),
    ];
  }
}
