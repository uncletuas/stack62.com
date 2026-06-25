import { Inject, Injectable } from '@nestjs/common';
import { RecordsService } from '../../records/records.service';
import { SystemsService } from '../../systems/systems.service';
import { tool, type ToolDefinition } from './types';

@Injectable()
export class DataTools {
  constructor(
    private readonly systemsService: SystemsService,
    private readonly recordsService: RecordsService,
  ) {}

  build(): ToolDefinition[] {
    return [
      tool(
        'systems.list',
        'List business systems in the workspace. Returns id, name, status, and module count for each.',
        {
          properties: {
            status: {
              type: 'string',
              description: 'Optional status filter (e.g. "active").',
            },
          },
        },
        async (input, ctx) => {
          const rows = await this.systemsService.findAll(
            {
              organizationId: ctx.organizationId,
              workspaceId: ctx.workspaceId ?? undefined,
              status:
                typeof input.status === 'string' ? input.status : undefined,
            },
            ctx.actorUserId,
          );
          return {
            output: rows.map((r) => ({
              id: r.id,
              name: r.name,
              slug: r.slug,
              purpose: r.purpose,
              status: r.status,
              governanceMode: r.governanceMode,
            })),
            summary: `Found ${rows.length} system${rows.length === 1 ? '' : 's'}.`,
          };
        },
      ),
      tool(
        'systems.get',
        'Get full details of a system: modules, entities, fields, workflows, metrics.',
        {
          properties: {
            systemId: { type: 'string', description: 'System UUID.' },
          },
          required: ['systemId'],
        },
        async (input) => {
          const detail = await this.systemsService.findOne(
            String(input.systemId),
          );
          return {
            output: {
              id: detail.id,
              name: detail.name,
              status: detail.status,
              modules: detail.modules.map((m) => ({
                id: m.id,
                name: m.name,
                key: m.key,
                kind: m.kind,
                recordCount: m.recordCount,
                pendingCount: m.pendingCount,
                entities: m.entities.map((e) => ({
                  id: e.id,
                  name: e.name,
                  key: e.key,
                  fields: e.fields.map((f) => ({
                    id: f.id,
                    name: f.name,
                    key: f.key,
                    dataType: f.dataType,
                    required: f.required,
                  })),
                })),
              })),
              workflows: detail.workflows.map((w) => ({
                id: w.id,
                name: w.name,
                triggerType: w.triggerType,
                status: w.status,
              })),
              metrics: detail.metrics,
            },
            summary: `System "${detail.name}" — ${detail.modules.length} modules, ${detail.metrics.totalRecords} records.`,
          };
        },
      ),
      tool(
        'records.find',
        'Search records inside a module. Returns up to 50 matching rows with their structured data.',
        {
          properties: {
            systemId: { type: 'string' },
            moduleDefinitionId: { type: 'string' },
            entityDefinitionId: { type: 'string' },
            status: { type: 'string' },
          },
          required: ['systemId'],
        },
        async (input, ctx) => {
          const rows = await this.recordsService.findAll(
            {
              organizationId: ctx.organizationId,
              workspaceId: ctx.workspaceId ?? undefined,
              systemId: String(input.systemId),
              moduleDefinitionId:
                typeof input.moduleDefinitionId === 'string'
                  ? input.moduleDefinitionId
                  : undefined,
              entityDefinitionId:
                typeof input.entityDefinitionId === 'string'
                  ? input.entityDefinitionId
                  : undefined,
              status:
                typeof input.status === 'string' ? input.status : undefined,
            },
            ctx.actorUserId,
          );
          const trimmed = rows.slice(0, 50);
          return {
            output: trimmed.map((r) => ({
              id: r.id,
              moduleDefinitionId: r.moduleDefinitionId,
              entityDefinitionId: r.entityDefinitionId,
              status: r.status,
              data: r.data,
              updatedAt: r.updatedAt,
            })),
            summary: `Found ${rows.length} record${rows.length === 1 ? '' : 's'} (showing ${trimmed.length}).`,
          };
        },
      ),
      tool(
        'records.create',
        'Create a new record in a module/entity. Pass data as a key→value object matching the entity fields.',
        {
          properties: {
            systemId: { type: 'string' },
            moduleDefinitionId: { type: 'string' },
            entityDefinitionId: { type: 'string' },
            status: { type: 'string', description: 'Defaults to "active".' },
            data: {
              type: 'object',
              description: 'Field values keyed by field key.',
            },
          },
          required: [
            'systemId',
            'moduleDefinitionId',
            'entityDefinitionId',
            'data',
          ],
        },
        async (input, ctx) => {
          if (!ctx.workspaceId)
            throw new Error('workspaceId is required to create a record.');
          const r = await this.recordsService.create(
            {
              organizationId: ctx.organizationId,
              workspaceId: ctx.workspaceId,
              systemId: String(input.systemId),
              moduleDefinitionId: String(input.moduleDefinitionId),
              entityDefinitionId: String(input.entityDefinitionId),
              status:
                typeof input.status === 'string' ? input.status : 'active',
              data: (input.data ?? {}) as Record<string, unknown>,
            },
            ctx.actorUserId,
          );
          return {
            output: { id: r.id, status: r.status },
            summary: `Created record ${r.id.slice(0, 8)}.`,
          };
        },
      ),
      tool(
        'records.update',
        'Update an existing record. Pass only the fields to change.',
        {
          properties: {
            recordId: { type: 'string' },
            status: { type: 'string' },
            data: { type: 'object' },
          },
          required: ['recordId'],
        },
        async (input, ctx) => {
          const r = await this.recordsService.update(
            String(input.recordId),
            {
              status:
                typeof input.status === 'string' ? input.status : undefined,
              data: (input.data ?? undefined) as
                | Record<string, unknown>
                | undefined,
            },
            ctx.actorUserId,
          );
          return {
            output: { id: r.id, status: r.status },
            summary: `Updated record ${r.id.slice(0, 8)}.`,
          };
        },
      ),
    ];
  }
}
