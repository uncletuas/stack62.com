import { Injectable } from '@nestjs/common';
import { FilesService } from '../../files/files.service';
import { SystemsService } from '../../systems/systems.service';
import { tool, type ToolDefinition } from './types';

@Injectable()
export class WorkspaceTools {
  constructor(
    private readonly systemsService: SystemsService,
    private readonly filesService: FilesService,
  ) {}

  build(): ToolDefinition[] {
    return [
      tool(
        'workspace.search',
        'Search workspace systems and files by a plain text query.',
        {
          properties: {
            query: { type: 'string' },
          },
          required: ['query'],
        },
        async (input, ctx) => {
          const query = String(input.query ?? '').toLowerCase();
          const [systems, files] = await Promise.all([
            ctx.workspaceId
              ? this.systemsService.findAll(
                  {
                    organizationId: ctx.organizationId,
                    workspaceId: ctx.workspaceId,
                  },
                  ctx.actorUserId,
                )
              : Promise.resolve([]),
            this.filesService.list(ctx.organizationId, ctx.actorUserId, {
              workspaceId: ctx.workspaceId ?? undefined,
            }),
          ]);
          const matchedSystems = systems
            .filter((system) =>
              [system.name, system.description, system.purpose]
                .filter(Boolean)
                .join(' ')
                .toLowerCase()
                .includes(query),
            )
            .slice(0, 20);
          const matchedFiles = files
            .filter((file) => file.filename.toLowerCase().includes(query))
            .slice(0, 20);
          return {
            output: {
              systems: matchedSystems.map((system) => ({
                id: system.id,
                name: system.name,
                status: system.status,
              })),
              files: matchedFiles.map((file) => ({
                id: file.id,
                filename: file.filename,
                mimeType: file.mimeType,
                scope: file.scope,
              })),
            },
            summary: `${matchedSystems.length} system(s), ${matchedFiles.length} file(s).`,
          };
        },
      ),
      tool(
        'workspace.read_context',
        'Read a compact snapshot of workspace systems and files.',
        {
          properties: {},
        },
        async (_input, ctx) => {
          const [systems, files] = await Promise.all([
            ctx.workspaceId
              ? this.systemsService.findAll(
                  {
                    organizationId: ctx.organizationId,
                    workspaceId: ctx.workspaceId,
                  },
                  ctx.actorUserId,
                )
              : Promise.resolve([]),
            this.filesService.list(ctx.organizationId, ctx.actorUserId, {
              workspaceId: ctx.workspaceId ?? undefined,
            }),
          ]);
          return {
            output: {
              systems: systems.slice(0, 30).map((system) => ({
                id: system.id,
                name: system.name,
                status: system.status,
                purpose: system.purpose,
                updatedAt: system.updatedAt,
              })),
              files: files.slice(0, 40).map((file) => ({
                id: file.id,
                filename: file.filename,
                mimeType: file.mimeType,
                scope: file.scope,
                updatedAt: file.updatedAt,
              })),
            },
            summary: `Workspace has ${systems.length} system(s) and ${files.length} file(s).`,
          };
        },
      ),
    ];
  }
}
