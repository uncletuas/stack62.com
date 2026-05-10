import { Injectable } from '@nestjs/common';
import { SystemsService } from '../../systems/systems.service';
import { tool, type ToolDefinition } from './types';

@Injectable()
export class SystemTools {
  constructor(private readonly systemsService: SystemsService) {}

  build(): ToolDefinition[] {
    return [
      tool(
        'systems.create_or_update',
        'Create a new Stack62 system or add a draft version to an existing one.',
        {
          properties: {
            systemId: { type: 'string' },
            name: { type: 'string' },
            purpose: { type: 'string' },
            description: { type: 'string' },
            definition: { type: 'object' },
          },
        },
        async (input, ctx) => {
          if (typeof input.systemId === 'string' && input.systemId) {
            const version = await this.systemsService.createDraftVersion(
              input.systemId,
              ctx.actorUserId,
              typeof input.description === 'string'
                ? input.description
                : 'Coworker system update',
              typeof input.definition === 'object' && input.definition !== null
                ? (input.definition as Record<string, unknown>)
                : {},
              typeof input.purpose === 'string' ? input.purpose : undefined,
            );
            return {
              output: { systemId: input.systemId, version },
              summary: `Updated system draft version ${version.versionNumber}.`,
            };
          }

          if (!ctx.workspaceId) {
            throw new Error('workspaceId is required to create a system.');
          }
          const created = await this.systemsService.create(
            {
              organizationId: ctx.organizationId,
              workspaceId: ctx.workspaceId,
              name: String(input.name ?? 'Untitled System'),
              purpose:
                typeof input.purpose === 'string' ? input.purpose : undefined,
              description:
                typeof input.description === 'string'
                  ? input.description
                  : undefined,
              sourcePrompt:
                typeof input.purpose === 'string' ? input.purpose : undefined,
              modules: [],
              views: [],
              dashboards: [],
            },
            ctx.actorUserId,
          );
          return {
            output: created,
            summary: `Created ${created.system.name}.`,
          };
        },
      ),
      tool(
        'systems.delete',
        'Delete a Stack62 system by marking it deleted.',
        {
          properties: {
            systemId: { type: 'string' },
          },
          required: ['systemId'],
        },
        async (input, ctx) => {
          const deleted = await this.systemsService.delete(
            String(input.systemId),
            ctx.actorUserId,
          );
          return {
            output: deleted,
            summary: `Deleted ${deleted.name}.`,
          };
        },
      ),
    ];
  }
}
