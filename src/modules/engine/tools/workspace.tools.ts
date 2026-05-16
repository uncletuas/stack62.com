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
        'workspace.open',
        "Open a file, folder, system, document, or other workspace item in the user's interface. Use this when the user says \"open X\", \"show me Y\", or \"pull up Z\" and you know which entity they mean. The frontend interprets the returned intent and switches the active tab.",
        {
          properties: {
            target: {
              type: 'string',
              enum: [
                'file',
                'folder',
                'document',
                'system',
                'task',
                'schedule',
                'plan',
                'report',
                'workflow',
                'meeting-bot',
                'room',
                'files-explorer',
              ],
              description:
                "What kind of thing to open. 'file' opens a file in a new editor tab; 'files-explorer' opens the file browser; 'system' opens a system editor; etc.",
            },
            id: {
              type: 'string',
              description:
                "The id of the entity to open. Required for 'file', 'document', 'system', 'task', 'schedule', 'plan', 'report', 'workflow', 'meeting-bot', 'room'. Omit for 'folder' (uses 'folderId') and 'files-explorer'.",
            },
            folderId: {
              type: 'string',
              description:
                "Folder id when opening 'folder'. Omit to open the org root.",
            },
            title: {
              type: 'string',
              description:
                'Optional display title for the tab. Falls back to a sensible default.',
            },
          },
          required: ['target'],
        },
        async (input) => {
          const target = String(input.target);
          const id =
            typeof input.id === 'string' && input.id.trim()
              ? input.id.trim()
              : undefined;
          const folderId =
            typeof input.folderId === 'string' && input.folderId.trim()
              ? input.folderId.trim()
              : undefined;
          const title =
            typeof input.title === 'string' && input.title.trim()
              ? input.title.trim()
              : undefined;
          // We don't validate that the id actually exists here — the
          // frontend will navigate to a 404-ish state if it's wrong,
          // which is the right place for that feedback. Doing the
          // lookup here would also leak existence info via error
          // shapes; the existing get-by-id endpoints already enforce
          // ACL on read.
          return {
            output: {
              intent: 'workspace.open',
              target,
              id,
              folderId,
              title,
            },
            summary: title
              ? `Opening ${target}: ${title}`
              : `Opening ${target}.`,
          };
        },
        { actionLevel: 1 },
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
