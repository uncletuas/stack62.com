import { Injectable } from '@nestjs/common';
import { DocumentExtractionService } from '../../document-extraction/document-extraction.service';
import { FoldersService } from '../../folders/folders.service';
import { SemanticSearchService } from '../../semantic-search/semantic-search.service';
import { tool, type ToolDefinition } from './types';

/**
 * Coworker tools for the document-management surface. These are the
 * verbs the Coworker uses to be useful at "find that doc / extract
 * the totals / what's in this folder?" without the user having to
 * remember filenames.
 */
@Injectable()
export class DocumentsTools {
  constructor(
    private readonly semanticSearch: SemanticSearchService,
    private readonly extraction: DocumentExtractionService,
    private readonly folders: FoldersService,
  ) {}

  build(): ToolDefinition[] {
    return [
      tool(
        'documents.search',
        'Semantic search across all uploaded files. Use this when the user is looking for a document by topic, content, or context — NOT by exact filename. Returns top matching files with snippets so the model can quote them in its answer. Honors folder ACLs.',
        {
          properties: {
            query: {
              type: 'string',
              description:
                'Natural-language description of what the user is looking for. E.g. "the onboarding policy from last quarter".',
            },
            limit: {
              type: 'number',
              description: 'Max hits to return. Default 6, max 16.',
            },
            folderId: {
              type: 'string',
              description: 'Optional: restrict to a single folder.',
            },
          },
          required: ['query'],
        },
        async (input, ctx) => {
          const query = String(input.query || '').trim();
          const limit = Math.max(
            1,
            Math.min(typeof input.limit === 'number' ? input.limit : 6, 16),
          );
          const folderId =
            typeof input.folderId === 'string' ? input.folderId : null;

          const results = await this.semanticSearch.searchSimilar(
            ctx.organizationId,
            query,
            ctx.actorUserId,
            { limit, folderId },
          );

          return {
            output: results.map((row) => ({
              fileId: row.fileId,
              filename: row.filename,
              folderId: row.folderId,
              score: Math.round(row.score * 1000) / 1000,
              snippet:
                row.text.length > 360
                  ? row.text.slice(0, 360) + '…'
                  : row.text,
            })),
            summary:
              results.length === 0
                ? `No files match "${query}". Suggest the user upload the document first.`
                : `${results.length} hit${results.length === 1 ? '' : 's'} for "${query}".`,
          };
        },
        { actionLevel: 1 },
      ),

      tool(
        'documents.extract_fields',
        'Run vision OCR on a file (receipt, invoice, letter, ID, business card, form, etc.) and return structured fields. Idempotent — returns the prior extraction if one exists and `force` is not true.',
        {
          properties: {
            fileId: { type: 'string' },
            force: {
              type: 'boolean',
              description: 'Re-run extraction even if a completed one exists.',
            },
            hint: {
              type: 'string',
              enum: [
                'receipt',
                'invoice',
                'letter',
                'contract',
                'id_card',
                'business_card',
                'form',
                'unknown',
              ],
              description:
                'Optional: tell the extractor what kind of document this is. Use only when you are confident — it produces cleaner output but a wrong hint reduces quality.',
            },
          },
          required: ['fileId'],
        },
        async (input, ctx) => {
          const fileId = String(input.fileId);
          const extraction = await this.extraction.extractFromFile(
            fileId,
            ctx.actorUserId,
            {
              force: Boolean(input.force),
              hint:
                typeof input.hint === 'string'
                  ? (input.hint as
                      | 'receipt'
                      | 'invoice'
                      | 'letter'
                      | 'contract'
                      | 'id_card'
                      | 'business_card'
                      | 'form'
                      | 'unknown')
                  : undefined,
            },
          );
          return {
            output: {
              documentType: extraction.documentType,
              fields: extraction.extractedFields,
              confidence: extraction.confidence,
              modelUsed: extraction.modelUsed,
            },
            summary: `Extracted ${extraction.documentType} fields with confidence ${
              extraction.confidence ?? 'n/a'
            }.`,
          };
        },
        { actionLevel: 2 },
      ),

      tool(
        'folders.list',
        'List folders. Pass `parentId` to drill down; omit it to list the org root.',
        {
          properties: {
            parentId: { type: 'string' },
            workspaceId: { type: 'string' },
          },
        },
        async (input, ctx) => {
          const folders = await this.folders.listChildren(
            typeof input.parentId === 'string' ? input.parentId : null,
            ctx.organizationId,
            typeof input.workspaceId === 'string'
              ? input.workspaceId
              : (ctx.workspaceId ?? null),
            ctx.actorUserId,
          );
          return {
            output: folders.map((f) => ({
              id: f.id,
              name: f.name,
              path: f.path,
              parentId: f.parentId,
              isPersonal: f.isPersonal,
            })),
            summary: `${folders.length} folder${folders.length === 1 ? '' : 's'}.`,
          };
        },
        { actionLevel: 1 },
      ),

      tool(
        'folders.create',
        'Create a new folder under an optional parent. Caller must have `write` on the parent (or be org admin). Use this when the user asks the Coworker to organize their files into named folders.',
        {
          properties: {
            name: { type: 'string' },
            parentId: { type: 'string' },
            isPersonal: { type: 'boolean' },
          },
          required: ['name'],
        },
        async (input, ctx) => {
          const folder = await this.folders.createFolder(
            {
              organizationId: ctx.organizationId,
              workspaceId: ctx.workspaceId ?? null,
              parentId:
                typeof input.parentId === 'string' ? input.parentId : null,
              name: String(input.name),
              isPersonal: Boolean(input.isPersonal),
            },
            ctx.actorUserId,
          );
          return {
            output: { id: folder.id, name: folder.name, path: folder.path },
            summary: `Created folder ${folder.path}.`,
          };
        },
        { actionLevel: 3 },
      ),

      tool(
        'folders.grant_access',
        "Share a folder with another team member, a role, or everyone in the org/workspace. Permissions: read | comment | write | share | admin. Use when the user says 'give Sarah access to the Finance folder'.",
        {
          properties: {
            folderId: { type: 'string' },
            subjectType: {
              type: 'string',
              enum: ['user', 'role', 'org_everyone', 'workspace_everyone'],
            },
            userId: {
              type: 'string',
              description:
                'Required when subjectType=user. Resolve from the user search tool if needed.',
            },
            role: {
              type: 'string',
              description: 'Required when subjectType=role.',
            },
            permission: {
              type: 'string',
              enum: ['read', 'comment', 'write', 'share', 'admin'],
            },
            expiresInDays: {
              type: 'number',
              description: 'Optional: auto-revoke after N days.',
            },
          },
          required: ['folderId', 'subjectType', 'permission'],
        },
        async (input, ctx) => {
          const expiresAt =
            typeof input.expiresInDays === 'number'
              ? new Date(
                  Date.now() +
                    Number(input.expiresInDays) * 24 * 60 * 60 * 1000,
                )
              : null;
          const acl = await this.folders.grantAccess(
            {
              folderId: String(input.folderId),
              subjectType: input.subjectType as
                | 'user'
                | 'role'
                | 'org_everyone'
                | 'workspace_everyone',
              userId:
                typeof input.userId === 'string' ? input.userId : undefined,
              role: typeof input.role === 'string' ? input.role : undefined,
              permission: input.permission as
                | 'read'
                | 'comment'
                | 'write'
                | 'share'
                | 'admin',
              expiresAt,
            },
            ctx.actorUserId,
          );
          return {
            output: { aclId: acl.id, expiresAt: acl.expiresAt },
            summary: `Granted ${acl.permission} on folder ${acl.folderId}.`,
          };
        },
        { actionLevel: 3, sensitive: true },
      ),
    ];
  }
}
