import { Injectable } from '@nestjs/common';
import { DocumentsService } from '../../documents/documents.service';
import { FilesService } from '../../files/files.service';
import { tool, type ToolDefinition } from './types';

@Injectable()
export class FileTools {
  constructor(
    private readonly filesService: FilesService,
    private readonly documentsService: DocumentsService,
  ) {}

  build(): ToolDefinition[] {
    return [
      tool(
        'files.list',
        'List files stored in this workspace.',
        {
          properties: {
            scope: {
              type: 'string',
              enum: [
                'attachment',
                'document',
                'system_asset',
                'avatar',
                'other',
              ],
            },
            systemId: { type: 'string' },
            ownerKind: { type: 'string' },
            ownerId: { type: 'string' },
          },
        },
        async (input, ctx) => {
          const rows = await this.filesService.list(
            ctx.organizationId,
            ctx.actorUserId,
            {
              workspaceId: ctx.workspaceId ?? undefined,
              systemId:
                typeof input.systemId === 'string' ? input.systemId : undefined,
              scope:
                typeof input.scope === 'string'
                  ? (input.scope as
                      | 'attachment'
                      | 'document'
                      | 'system_asset'
                      | 'avatar'
                      | 'other')
                  : undefined,
              ownerKind:
                typeof input.ownerKind === 'string'
                  ? input.ownerKind
                  : undefined,
              ownerId:
                typeof input.ownerId === 'string' ? input.ownerId : undefined,
            },
          );
          return {
            output: rows.map((f) => ({
              id: f.id,
              filename: f.filename,
              mimeType: f.mimeType,
              size: f.size,
              scope: f.scope,
              updatedAt: f.updatedAt,
            })),
            summary: `${rows.length} file${rows.length === 1 ? '' : 's'}.`,
          };
        },
      ),
      tool(
        'files.read_text',
        'Read the textual contents of a file. Supports text-like files and Word .docx documents.',
        {
          properties: {
            fileId: { type: 'string' },
          },
          required: ['fileId'],
        },
        async (input, ctx) => {
          const content = await this.filesService.readEditableContent(
            String(input.fileId),
            ctx.actorUserId,
          );
          return {
            output: {
              filename: content.filename,
              mimeType: content.mimeType,
              format: content.format,
              text: content.text.slice(0, 32_000),
            },
            summary: `Read ${content.filename}.`,
          };
        },
      ),
      tool(
        'files.read',
        'Read editable text from a workspace file.',
        {
          properties: {
            fileId: { type: 'string' },
          },
          required: ['fileId'],
        },
        async (input, ctx) => {
          const content = await this.filesService.readEditableContent(
            String(input.fileId),
            ctx.actorUserId,
          );
          return {
            output: content,
            summary: `Read ${content.filename}.`,
          };
        },
      ),
      tool(
        'files.write_text',
        'Replace the editable text contents of a file. Supports text-like files and Word .docx documents.',
        {
          properties: {
            fileId: { type: 'string' },
            text: { type: 'string' },
          },
          required: ['fileId', 'text'],
        },
        async (input, ctx) => {
          const content = await this.filesService.saveEditableContent(
            String(input.fileId),
            String(input.text ?? ''),
            ctx.actorUserId,
          );
          return {
            output: {
              filename: content.filename,
              mimeType: content.mimeType,
              format: content.format,
            },
            summary: `Updated ${content.filename}.`,
          };
        },
      ),
      tool(
        'files.write',
        'Replace editable text in a workspace file.',
        {
          properties: {
            fileId: { type: 'string' },
            text: { type: 'string' },
          },
          required: ['fileId', 'text'],
        },
        async (input, ctx) => {
          const content = await this.filesService.saveEditableContent(
            String(input.fileId),
            String(input.text ?? ''),
            ctx.actorUserId,
          );
          return {
            output: content,
            summary: `Updated ${content.filename}.`,
          };
        },
      ),
      tool(
        'files.patch',
        'Apply a simple text replacement patch to an editable file.',
        {
          properties: {
            fileId: { type: 'string' },
            find: { type: 'string' },
            replace: { type: 'string' },
          },
          required: ['fileId', 'find', 'replace'],
        },
        async (input, ctx) => {
          const current = await this.filesService.readEditableContent(
            String(input.fileId),
            ctx.actorUserId,
          );
          const find = String(input.find ?? '');
          if (!find || !current.text.includes(find)) {
            throw new Error('Patch text was not found in the file.');
          }
          const updated = await this.filesService.saveEditableContent(
            String(input.fileId),
            current.text.replace(find, String(input.replace ?? '')),
            ctx.actorUserId,
          );
          return {
            output: updated,
            summary: `Patched ${updated.filename}.`,
          };
        },
      ),
      tool(
        'files.delete',
        'Delete a workspace file.',
        {
          properties: {
            fileId: { type: 'string' },
          },
          required: ['fileId'],
        },
        async (input, ctx) => {
          const deleted = await this.filesService.delete(
            String(input.fileId),
            ctx.actorUserId,
          );
          return {
            output: deleted,
            summary: 'Deleted file.',
          };
        },
      ),
      tool(
        'documents.generate',
        'Generate a Word/Excel/PowerPoint/PDF/Markdown document with AI from a prompt or block spec.',
        {
          properties: {
            format: {
              type: 'string',
              enum: ['docx', 'xlsx', 'pptx', 'pdf', 'png', 'md', 'txt'],
            },
            title: { type: 'string' },
            prompt: { type: 'string' },
            blocks: {
              type: 'array',
              items: { type: 'object' },
              description: 'Optional explicit document blocks.',
            },
            systemId: { type: 'string' },
          },
          required: ['format', 'title'],
        },
        async (input, ctx) => {
          const doc = await this.documentsService.generate(
            {
              organizationId: ctx.organizationId,
              workspaceId: ctx.workspaceId ?? undefined,
              systemId:
                typeof input.systemId === 'string'
                  ? input.systemId
                  : (ctx.systemId ?? undefined),
              format: input.format as
                | 'docx'
                | 'xlsx'
                | 'pptx'
                | 'pdf'
                | 'png'
                | 'md'
                | 'txt',
              title: String(input.title),
              prompt:
                typeof input.prompt === 'string' ? input.prompt : undefined,
              blocks: undefined,
            },
            ctx.actorUserId,
          );
          return {
            output: {
              fileId: doc.fileId,
              filename: doc.filename,
              mimeType: doc.mimeType,
              size: doc.size,
              downloadUrl: doc.downloadUrl,
            },
            summary: `Generated ${doc.filename}.`,
          };
        },
      ),
      tool(
        'documents.inspect',
        'Inspect an editable business document as text.',
        {
          properties: {
            fileId: { type: 'string' },
          },
          required: ['fileId'],
        },
        async (input, ctx) => {
          const content = await this.filesService.readEditableContent(
            String(input.fileId),
            ctx.actorUserId,
          );
          return {
            output: content,
            summary: `Inspected ${content.filename}.`,
          };
        },
      ),
      tool(
        'documents.edit',
        'Rewrite the editable text of a business document.',
        {
          properties: {
            fileId: { type: 'string' },
            text: { type: 'string' },
          },
          required: ['fileId', 'text'],
        },
        async (input, ctx) => {
          const content = await this.filesService.saveEditableContent(
            String(input.fileId),
            String(input.text ?? ''),
            ctx.actorUserId,
          );
          return {
            output: content,
            summary: `Edited ${content.filename}.`,
          };
        },
      ),
      tool(
        'documents.export',
        'Return the download URL for an existing document file.',
        {
          properties: {
            fileId: { type: 'string' },
          },
          required: ['fileId'],
        },
        async (input, ctx) => {
          const file = await this.filesService.findOne(
            String(input.fileId),
            ctx.actorUserId,
          );
          return {
            output: {
              fileId: file.id,
              filename: file.filename,
              mimeType: file.mimeType,
              downloadUrl: `/v1/files/${file.id}/download`,
            },
            summary: `Prepared export for ${file.filename}.`,
          };
        },
      ),
    ];
  }
}
