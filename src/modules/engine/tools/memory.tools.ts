import { Injectable } from '@nestjs/common';
import { CoworkerMemoryService } from '../../coworker/coworker-memory.service';
import { tool, type ToolDefinition } from './types';

/**
 * Coworker memory tools. The Coworker uses these to retain notable
 * facts across sessions without the user having to manually curate
 * memory rows (the user-visible memory CRUD UI was removed by design).
 *
 * `memory.remember` records or updates a single keyed fact.
 * `memory.recall` lets the model query its own prior captures by
 * substring before answering — closes the loop on RAG-style memory.
 */
@Injectable()
export class MemoryTools {
  constructor(private readonly memoryService: CoworkerMemoryService) {}

  build(): ToolDefinition[] {
    return [
      tool(
        'memory.remember',
        'Record a long-term fact you should recall in later turns. Use sparingly — only for stable preferences, identifiers, or commitments that will likely matter again. Re-running with the same key replaces the prior value. Keys are short slugs (e.g. "user.office-hours", "qb.api-key-rotated").',
        {
          properties: {
            key: {
              type: 'string',
              description:
                'Short slug, unique per fact. e.g. "user.office-hours".',
            },
            text: {
              type: 'string',
              description: 'The memory itself, written for the future-you.',
            },
            kind: {
              type: 'string',
              enum: ['fact', 'preference', 'episode'],
              description:
                '"fact" = objective; "preference" = user-stated; "episode" = something that happened.',
            },
          },
          required: ['key', 'text'],
        },
        async (input, ctx) => {
          if (!ctx.workspaceId) {
            return {
              output: null,
              summary: 'Skipped: no workspace context.',
            };
          }
          const result = await this.memoryService.autoCapture({
            organizationId: ctx.organizationId,
            workspaceId: ctx.workspaceId,
            systemId: ctx.systemId,
            kind: input.kind as 'fact' | 'preference' | 'episode' | undefined,
            key: String(input.key),
            text: String(input.text),
          });
          return {
            output: {
              id: result.row.id,
              action: result.action,
              key: result.row.key,
            },
            summary: `${result.action === 'created' ? 'Stored' : 'Updated'} memory "${result.row.key}".`,
          };
        },
        { actionLevel: 2 },
      ),

      tool(
        'memory.recall',
        'Search your own prior captured memories before answering. Returns up to 10 most recent matches whose key or text contains the query (case-insensitive substring). Use this when the user asks something where context from earlier sessions would help.',
        {
          properties: {
            query: {
              type: 'string',
              description: 'What to look up (substring matched).',
            },
          },
          required: ['query'],
        },
        async (input, ctx) => {
          if (!ctx.workspaceId) return { output: [], summary: 'No workspace.' };
          const list = await this.memoryService.list(
            {
              organizationId: ctx.organizationId,
              workspaceId: ctx.workspaceId,
            },
            ctx.actorUserId,
          );
          const q = String(input.query || '').toLowerCase();
          const hits = list
            .filter(
              (m) =>
                m.key?.toLowerCase().includes(q) ||
                m.text.toLowerCase().includes(q),
            )
            .slice(0, 10)
            .map((m) => ({
              key: m.key,
              kind: m.kind,
              text: m.text,
              updatedAt: m.updatedAt,
            }));
          return {
            output: hits,
            summary: `${hits.length} memor${hits.length === 1 ? 'y' : 'ies'}.`,
          };
        },
        { actionLevel: 1 },
      ),
    ];
  }
}
