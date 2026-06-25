import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Repository } from 'typeorm';
import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import ExcelJS from 'exceljs';
import PptxGenJS from 'pptxgenjs';
import PDFDocument from 'pdfkit';
import { AccessControlService } from '../../shared/access-control/access-control.service';
import { ActivityService } from '../activity/activity.service';
import { AuditService } from '../audit/audit.service';
import { FilesService } from '../files/files.service';
import { OpenRouterService } from '../ai/openrouter.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { ContentIndexService } from '../search/content-index.service';
import { TasksService } from '../tasks/tasks.service';
import { WorkflowsService } from '../workflows/workflows.service';
import {
  CreateDocumentCommentDto,
  CreateDocumentDto,
  DocumentActionDto,
  DocumentToTasksDto,
  ListDocumentsDto,
  UpdateDocumentDto,
} from './dto/document.dto';
import {
  DocumentFormat,
  DocumentSpecBlock,
  GenerateDocumentDto,
} from './dto/generate-document.dto';
import { DocumentCommentEntity } from './entities/document-comment.entity';
import { DocumentVersionEntity } from './entities/document-version.entity';
import { DocumentEntity } from './entities/document.entity';

const MIME: Record<DocumentFormat, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  pdf: 'application/pdf',
  png: 'image/png',
  md: 'text/markdown',
  txt: 'text/plain',
};

export interface StructuredSpec {
  title: string;
  blocks: DocumentSpecBlock[];
}

export interface GenerateDocumentResult {
  fileId: string;
  filename: string;
  mimeType: string;
  size: number;
  downloadUrl: string;
  spec: StructuredSpec;
}

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);
  private readonly storageRoot: string;

  constructor(
    @InjectRepository(DocumentEntity)
    private readonly documentsRepository: Repository<DocumentEntity>,
    @InjectRepository(DocumentVersionEntity)
    private readonly versionsRepository: Repository<DocumentVersionEntity>,
    @InjectRepository(DocumentCommentEntity)
    private readonly commentsRepository: Repository<DocumentCommentEntity>,
    private readonly configService: ConfigService,
    private readonly filesService: FilesService,
    private readonly openRouterService: OpenRouterService,
    private readonly organizationsService: OrganizationsService,
    private readonly accessControlService: AccessControlService,
    private readonly activityService: ActivityService,
    private readonly auditService: AuditService,
    private readonly tasksService: TasksService,
    private readonly workflowsService: WorkflowsService,
    private readonly contentIndexService: ContentIndexService,
  ) {
    const configured = this.configService.get<string>(
      'DOCUMENTS_STORAGE_ROOT',
      'storage/documents',
    );
    this.storageRoot = path.resolve(configured);
    if (!fs.existsSync(this.storageRoot)) {
      fs.mkdirSync(this.storageRoot, { recursive: true });
    }
  }

  async create(payload: CreateDocumentDto, actorUserId: string) {
    await this.accessControlService.assertResolvedAccess(actorUserId, {
      resource: 'document',
      action: 'create',
      organizationId: payload.organizationId,
      workspaceId: payload.workspaceId,
      systemId: payload.systemId,
    });

    const document = await this.documentsRepository.save(
      this.documentsRepository.create({
        organizationId: payload.organizationId,
        workspaceId: payload.workspaceId ?? null,
        systemId: payload.systemId ?? null,
        createdByUserId: actorUserId,
        updatedByUserId: actorUserId,
        title: payload.title,
        content: payload.content ?? '',
        format: payload.format ?? 'markdown',
        currentVersion: 1,
        metadata: payload.metadata ?? null,
      }),
    );

    await this.versionsRepository.save(
      this.versionsRepository.create({
        documentId: document.id,
        version: 1,
        createdByUserId: actorUserId,
        title: document.title,
        content: document.content,
        changeSummary: 'Initial version',
      }),
    );

    await this.logDocumentAction('document.create', document, actorUserId);
    await this.indexDocument(document);
    return document;
  }

  async findAll(filters: ListDocumentsDto, actorUserId: string) {
    const qb = this.documentsRepository.createQueryBuilder('document');
    await this.accessControlService.applyTenantScopeToQueryBuilder(
      qb,
      'document',
      actorUserId,
      {
        organizationField: 'organizationId',
        workspaceField: 'workspaceId',
        organizationId: filters.organizationId,
        workspaceId: filters.workspaceId,
      },
    );

    if (filters.systemId) {
      qb.andWhere('document.systemId = :systemId', {
        systemId: filters.systemId,
      });
    }
    if (filters.status) {
      qb.andWhere('document.status = :status', { status: filters.status });
    } else {
      // Hide soft-deleted documents from the default listing.
      qb.andWhere('document.status != :deleted', { deleted: 'deleted' });
    }

    return qb.orderBy('document.updatedAt', 'DESC').take(200).getMany();
  }

  async findOne(documentId: string, actorUserId: string) {
    const document = await this.documentsRepository.findOne({
      where: { id: documentId },
    });
    if (!document) throw new NotFoundException('Document not found.');
    await this.accessControlService.assertResolvedAccess(actorUserId, {
      resource: 'document',
      action: 'read',
      organizationId: document.organizationId,
      workspaceId: document.workspaceId,
      systemId: document.systemId,
    });
    return document;
  }

  async update(
    documentId: string,
    payload: UpdateDocumentDto,
    actorUserId: string,
  ) {
    const document = await this.findOne(documentId, actorUserId);
    await this.accessControlService.assertResolvedAccess(actorUserId, {
      resource: 'document',
      action: 'update',
      organizationId: document.organizationId,
      workspaceId: document.workspaceId,
      systemId: document.systemId,
    });

    const beforeData = { ...document };
    const titleChanged =
      payload.title !== undefined && payload.title !== document.title;
    const contentChanged =
      payload.content !== undefined && payload.content !== document.content;

    document.title = payload.title ?? document.title;
    document.content = payload.content ?? document.content;
    document.metadata = payload.metadata ?? document.metadata;
    document.updatedByUserId = actorUserId;

    if (titleChanged || contentChanged) {
      document.currentVersion += 1;
    }

    const updated = await this.documentsRepository.save(document);

    if (titleChanged || contentChanged) {
      await this.versionsRepository.save(
        this.versionsRepository.create({
          documentId: updated.id,
          version: updated.currentVersion,
          createdByUserId: actorUserId,
          title: updated.title,
          content: updated.content,
          changeSummary: payload.changeSummary ?? 'Document updated',
        }),
      );
    }

    await this.activityService.log({
      organizationId: updated.organizationId,
      workspaceId: updated.workspaceId,
      systemId: updated.systemId,
      actorUserId,
      action: 'document.update',
      targetType: 'document',
      targetId: updated.id,
      origin: 'user',
      metadata: {
        title: updated.title,
        currentVersion: updated.currentVersion,
      },
    });

    await this.auditService.log({
      organizationId: updated.organizationId,
      workspaceId: updated.workspaceId,
      systemId: updated.systemId,
      actorUserId,
      action: 'document.update',
      targetType: 'document',
      targetId: updated.id,
      beforeData,
      afterData: updated,
    });

    if (titleChanged || contentChanged) {
      await this.indexDocument(updated);
    }

    return updated;
  }

  /** Soft-delete a document (status='deleted'); hidden from the listing. */
  async remove(documentId: string, actorUserId: string) {
    const document = await this.findOne(documentId, actorUserId);
    await this.accessControlService.assertResolvedAccess(actorUserId, {
      resource: 'document',
      action: 'update',
      organizationId: document.organizationId,
      workspaceId: document.workspaceId,
      systemId: document.systemId,
    });
    document.status = 'deleted';
    document.updatedByUserId = actorUserId;
    await this.documentsRepository.save(document);
    await this.logDocumentAction('document.delete', document, actorUserId);
    return { id: document.id, status: 'deleted' as const };
  }

  /** Duplicate a document into a new one with " (copy)" appended to the title. */
  async duplicate(documentId: string, actorUserId: string) {
    const source = await this.findOne(documentId, actorUserId);
    return this.create(
      {
        organizationId: source.organizationId,
        workspaceId: source.workspaceId ?? undefined,
        systemId: source.systemId ?? undefined,
        title: `${source.title} (copy)`,
        content: source.content,
        format: source.format,
        metadata: source.metadata ?? undefined,
      } as CreateDocumentDto,
      actorUserId,
    );
  }

  async listVersions(documentId: string, actorUserId: string) {
    await this.findOne(documentId, actorUserId);
    return this.versionsRepository.find({
      where: { documentId },
      order: { version: 'DESC' },
    });
  }

  async addComment(
    documentId: string,
    payload: CreateDocumentCommentDto,
    actorUserId: string,
  ) {
    const document = await this.findOne(documentId, actorUserId);
    const comment = await this.commentsRepository.save(
      this.commentsRepository.create({
        documentId,
        authorUserId: actorUserId,
        body: payload.body,
        anchor: payload.anchor ?? null,
      }),
    );

    await this.activityService.log({
      organizationId: document.organizationId,
      workspaceId: document.workspaceId,
      systemId: document.systemId,
      actorUserId,
      action: 'document.comment',
      targetType: 'document',
      targetId: document.id,
      origin: 'user',
      metadata: { commentId: comment.id },
    });

    return comment;
  }

  async listComments(documentId: string, actorUserId: string) {
    await this.findOne(documentId, actorUserId);
    return this.commentsRepository.find({
      where: { documentId },
      order: { createdAt: 'ASC' },
    });
  }

  async summarize(documentId: string, actorUserId: string) {
    const document = await this.findOne(documentId, actorUserId);
    const org = await this.organizationsService.findById(
      document.organizationId,
    );
    const summary = await this.openRouterService.complete(
      [
        {
          role: 'system',
          content:
            'Summarize the document for a business workspace. Be concise, concrete, and include key action points if present.',
        },
        {
          role: 'user',
          content: `Title: ${document.title}\n\n${document.content.slice(0, 20000)}`,
        },
      ],
      org?.openrouterApiKey ?? null,
      org?.preferredModel ?? null,
    );
    return { documentId: document.id, title: document.title, summary };
  }

  async rewrite(
    documentId: string,
    payload: DocumentActionDto,
    actorUserId: string,
  ) {
    const document = await this.findOne(documentId, actorUserId);
    const org = await this.organizationsService.findById(
      document.organizationId,
    );
    const rewritten = await this.openRouterService.complete(
      [
        {
          role: 'system',
          content:
            'Rewrite this document. Preserve factual meaning and structure unless the user requests otherwise. Return only the rewritten document content.',
        },
        {
          role: 'user',
          content: `Instruction: ${payload.instruction ?? 'Improve clarity and professionalism.'}\n\nTitle: ${document.title}\n\n${document.content.slice(0, 20000)}`,
        },
      ],
      org?.openrouterApiKey ?? null,
      org?.preferredModel ?? null,
    );
    return this.update(
      documentId,
      {
        content: rewritten,
        changeSummary: payload.instruction ?? 'Rewritten by coworker',
      },
      actorUserId,
    );
  }

  async turnIntoTasks(
    documentId: string,
    payload: DocumentToTasksDto,
    actorUserId: string,
  ) {
    const document = await this.findOne(documentId, actorUserId);
    if (!document.workspaceId) {
      throw new BadRequestException('Document must belong to a workspace.');
    }
    const org = await this.organizationsService.findById(
      document.organizationId,
    );
    const raw = await this.openRouterService.complete(
      [
        {
          role: 'system',
          content:
            'Extract implementation tasks from the document. Return JSON only: {"tasks":[{"title":"...","description":"...","priority":"low|medium|high"}]}',
        },
        { role: 'user', content: document.content.slice(0, 20000) },
      ],
      org?.openrouterApiKey ?? null,
      org?.preferredModel ?? null,
    );
    const parsed = this.extractJson(raw) as {
      tasks?: Array<{
        title?: string;
        description?: string;
        priority?: string;
      }>;
    } | null;
    const specs = (parsed?.tasks ?? []).filter((task) => task.title);
    const created = [];
    for (const [index, spec] of specs.entries()) {
      created.push(
        await this.tasksService.create(
          {
            organizationId: document.organizationId,
            workspaceId: document.workspaceId,
            systemId: document.systemId ?? undefined,
            title: spec.title ?? `Task ${index + 1}`,
            description: spec.description,
            priority: spec.priority ?? 'medium',
            assigneeUserId: payload.assigneeUserIds?.[index],
            metadata: { sourceDocumentId: document.id },
          },
          actorUserId,
        ),
      );
    }
    return { documentId: document.id, tasks: created };
  }

  async turnIntoWorkflow(documentId: string, actorUserId: string) {
    const document = await this.findOne(documentId, actorUserId);
    if (!document.workspaceId || !document.systemId) {
      throw new BadRequestException(
        'Document must belong to a workspace system before it can become a workflow.',
      );
    }
    const workflow = await this.workflowsService.create(
      {
        organizationId: document.organizationId,
        workspaceId: document.workspaceId,
        systemId: document.systemId,
        name: `${document.title} Workflow`,
        triggerType: 'manual',
        definition: {
          sourceDocumentId: document.id,
          steps: [
            { key: 'review', name: 'Review document', type: 'manual' },
            { key: 'implement', name: 'Implement actions', type: 'manual' },
            { key: 'complete', name: 'Confirm completion', type: 'manual' },
          ],
        },
      },
      actorUserId,
    );
    return { documentId: document.id, workflow };
  }

  async generate(
    dto: GenerateDocumentDto,
    actorUserId: string,
  ): Promise<GenerateDocumentResult> {
    await this.accessControlService.assertResolvedAccess(actorUserId, {
      resource: 'system',
      action: 'create',
      organizationId: dto.organizationId,
      workspaceId: dto.workspaceId,
      systemId: dto.systemId,
    });

    let spec: StructuredSpec;

    if (dto.blocks && dto.blocks.length > 0) {
      spec = { title: dto.title, blocks: dto.blocks };
    } else if (dto.prompt) {
      spec = await this.draftSpecFromPrompt(dto);
    } else {
      spec = {
        title: dto.title,
        blocks: [{ type: 'paragraph', text: '(empty document)' }],
      };
    }

    const { absPath, size, extension } = await this.renderToDisk(
      dto.organizationId,
      dto.format,
      spec,
    );

    const filename = `${this.safeFilename(spec.title)}.${extension}`;

    const file = await this.filesService.register({
      organizationId: dto.organizationId,
      workspaceId: dto.workspaceId ?? null,
      systemId: dto.systemId ?? null,
      scope: 'document',
      filename,
      mimeType: MIME[dto.format],
      absolutePath: absPath,
      size,
      ownerKind: 'document',
      uploadedByUserId: actorUserId,
      metadata: {
        format: dto.format,
        source: dto.prompt ? 'ai' : 'structured',
        ...(dto.metadata ?? {}),
      },
    });

    return {
      fileId: file.id,
      filename: file.filename,
      mimeType: file.mimeType,
      size: Number(file.size),
      downloadUrl: `/v1/files/${file.id}/download`,
      spec,
    };
  }

  private async logDocumentAction(
    action: string,
    document: DocumentEntity,
    actorUserId: string,
  ) {
    await this.activityService.log({
      organizationId: document.organizationId,
      workspaceId: document.workspaceId,
      systemId: document.systemId,
      actorUserId,
      action,
      targetType: 'document',
      targetId: document.id,
      origin: 'user',
      metadata: { title: document.title },
    });
    await this.auditService.log({
      organizationId: document.organizationId,
      workspaceId: document.workspaceId,
      systemId: document.systemId,
      actorUserId,
      action,
      targetType: 'document',
      targetId: document.id,
      afterData: document,
    });
  }

  private async indexDocument(document: DocumentEntity) {
    try {
      await this.contentIndexService.index({
        organizationId: document.organizationId,
        workspaceId: document.workspaceId,
        systemId: document.systemId,
        sourceType: 'document',
        sourceId: document.id,
        sourceTitle: document.title,
        text: document.content,
        metadata: {
          format: document.format,
          currentVersion: document.currentVersion,
        },
      });
    } catch (err) {
      this.logger.warn(
        `Document indexing failed for ${document.id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private extractJson(content: string): unknown {
    const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fenced?.[1] ?? content;
    const first = candidate.indexOf('{');
    const last = candidate.lastIndexOf('}');
    if (first < 0 || last <= first) return null;
    try {
      return JSON.parse(candidate.slice(first, last + 1));
    } catch {
      return null;
    }
  }

  private async draftSpecFromPrompt(
    dto: GenerateDocumentDto,
  ): Promise<StructuredSpec> {
    const org = await this.organizationsService.findById(dto.organizationId);
    const orgApiKey = org?.openrouterApiKey ?? null;
    const model = dto.model ?? org?.preferredModel ?? null;

    const sys = `You are a document drafting AI. Given a request, produce a structured document as JSON. Respond with ONLY valid JSON:
{
  "title": "Short title",
  "blocks": [
    { "type": "heading", "level": 1, "text": "..." },
    { "type": "paragraph", "text": "..." },
    { "type": "bullets", "items": ["...", "..."] },
    { "type": "numbered", "items": ["...", "..."] },
    { "type": "table", "rows": [["Header1","Header2"], ["r1c1","r1c2"]] },
    { "type": "slide", "title": "Slide Title", "body": "Body text" }
  ]
}
Use 'slide' blocks only for .pptx. Keep it concrete and professional.`;

    const user = `Format: ${dto.format}\nTitle: ${dto.title}\nRequest:\n${dto.prompt}`;

    const raw = await this.openRouterService.complete(
      [
        { role: 'system', content: sys },
        { role: 'user', content: user },
      ],
      orgApiKey,
      model,
    );

    const jsonMatch =
      raw.match(/```json\s*([\s\S]*?)```/i) ??
      raw.match(/```\s*([\s\S]*?)```/i);
    const jsonStr = jsonMatch ? jsonMatch[1] : raw;
    const first = jsonStr.indexOf('{');
    const last = jsonStr.lastIndexOf('}');
    if (first < 0) {
      return {
        title: dto.title,
        blocks: [{ type: 'paragraph', text: raw }],
      };
    }

    try {
      const parsed = JSON.parse(
        jsonStr.slice(first, last + 1),
      ) as StructuredSpec;
      if (!Array.isArray(parsed.blocks)) parsed.blocks = [];
      parsed.title = parsed.title || dto.title;
      return parsed;
    } catch {
      return {
        title: dto.title,
        blocks: [{ type: 'paragraph', text: raw }],
      };
    }
  }

  private async renderToDisk(
    organizationId: string,
    format: DocumentFormat,
    spec: StructuredSpec,
  ): Promise<{ absPath: string; size: number; extension: string }> {
    const id = crypto.randomUUID();
    const dir = path.join(this.storageRoot, organizationId);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const absPath = path.join(dir, `${id}.${format}`);

    switch (format) {
      case 'docx':
        await this.renderDocx(absPath, spec);
        break;
      case 'xlsx':
        await this.renderXlsx(absPath, spec);
        break;
      case 'pptx':
        await this.renderPptx(absPath, spec);
        break;
      case 'pdf':
        await this.renderPdf(absPath, spec);
        break;
      case 'png':
        await this.renderPng(absPath, spec);
        break;
      case 'md':
        await fs.promises.writeFile(absPath, this.renderMarkdown(spec), 'utf8');
        break;
      case 'txt':
      default:
        await fs.promises.writeFile(absPath, this.renderPlain(spec), 'utf8');
        break;
    }

    const stat = await fs.promises.stat(absPath);
    return { absPath, size: stat.size, extension: format };
  }

  // ---------- DOCX ----------
  private async renderDocx(absPath: string, spec: StructuredSpec) {
    const children: Paragraph[] = [];

    children.push(
      new Paragraph({
        text: spec.title,
        heading: HeadingLevel.TITLE,
        alignment: AlignmentType.CENTER,
      }),
    );

    for (const block of spec.blocks) {
      switch (block.type) {
        case 'heading': {
          const lvl = Math.min(Math.max(block.level ?? 1, 1), 5);
          const headingMap: Record<
            number,
            (typeof HeadingLevel)[keyof typeof HeadingLevel]
          > = {
            1: HeadingLevel.HEADING_1,
            2: HeadingLevel.HEADING_2,
            3: HeadingLevel.HEADING_3,
            4: HeadingLevel.HEADING_4,
            5: HeadingLevel.HEADING_5,
          };
          children.push(
            new Paragraph({ text: block.text ?? '', heading: headingMap[lvl] }),
          );
          break;
        }
        case 'paragraph':
          children.push(
            new Paragraph({ children: [new TextRun(block.text ?? '')] }),
          );
          break;
        case 'bullets':
          for (const item of block.items ?? []) {
            children.push(new Paragraph({ text: item, bullet: { level: 0 } }));
          }
          break;
        case 'numbered':
          for (const item of block.items ?? []) {
            children.push(new Paragraph({ text: `• ${item}` }));
          }
          break;
        case 'pageBreak':
          children.push(
            new Paragraph({ children: [new TextRun({ break: 1 })] }),
          );
          break;
        default:
          break;
      }
    }

    const tables: Table[] = [];
    for (const block of spec.blocks) {
      if (block.type === 'table' && block.rows) {
        tables.push(
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: block.rows.map(
              (row) =>
                new TableRow({
                  children: row.map(
                    (cell) =>
                      new TableCell({
                        children: [new Paragraph(cell)],
                      }),
                  ),
                }),
            ),
          }),
        );
      }
    }

    const doc = new Document({
      sections: [{ children: [...children, ...tables] }],
    });

    const buf = await Packer.toBuffer(doc);
    await fs.promises.writeFile(absPath, buf);
  }

  // ---------- XLSX ----------
  private async renderXlsx(absPath: string, spec: StructuredSpec) {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Stack62';
    wb.created = new Date();

    const tables = spec.blocks.filter((b) => b.type === 'table' && b.rows);

    if (tables.length === 0) {
      const sheet = wb.addWorksheet(spec.title.slice(0, 28) || 'Sheet1');
      sheet.addRow([spec.title]);
      sheet.addRow([]);
      for (const block of spec.blocks) {
        if (block.type === 'heading' || block.type === 'paragraph') {
          sheet.addRow([block.text ?? '']);
        } else if (block.type === 'bullets' || block.type === 'numbered') {
          for (const item of block.items ?? []) sheet.addRow([`• ${item}`]);
        }
      }
    } else {
      tables.forEach((block, idx) => {
        const name = (block.title ?? `Sheet ${idx + 1}`).slice(0, 28);
        const sheet = wb.addWorksheet(name);
        for (const row of block.rows ?? []) sheet.addRow(row);
        if (block.rows && block.rows.length > 0) {
          sheet.getRow(1).font = { bold: true };
        }
      });
    }

    await wb.xlsx.writeFile(absPath);
  }

  // ---------- PPTX ----------
  private async renderPptx(absPath: string, spec: StructuredSpec) {
    const pptx = new PptxGenJS();
    pptx.title = spec.title;

    const titleSlide = pptx.addSlide();
    titleSlide.addText(spec.title, {
      x: 0.5,
      y: 2.0,
      w: 9,
      h: 1.5,
      fontSize: 36,
      bold: true,
      align: 'center',
    });

    const slideBlocks = spec.blocks.filter((b) => b.type === 'slide');
    const source = slideBlocks.length > 0 ? slideBlocks : spec.blocks;

    for (const block of source) {
      if (block.type === 'slide') {
        const s = pptx.addSlide();
        s.addText(block.title ?? '', {
          x: 0.5,
          y: 0.4,
          w: 9,
          h: 0.8,
          fontSize: 28,
          bold: true,
        });
        s.addText(block.body ?? '', {
          x: 0.5,
          y: 1.4,
          w: 9,
          h: 5,
          fontSize: 16,
        });
      } else if (block.type === 'heading') {
        const s = pptx.addSlide();
        s.addText(block.text ?? '', {
          x: 0.5,
          y: 0.4,
          w: 9,
          h: 0.8,
          fontSize: 28,
          bold: true,
        });
      } else if (block.type === 'paragraph') {
        const s = pptx.addSlide();
        s.addText(block.text ?? '', {
          x: 0.5,
          y: 0.5,
          w: 9,
          h: 5,
          fontSize: 16,
        });
      } else if (block.type === 'bullets' || block.type === 'numbered') {
        const s = pptx.addSlide();
        const items = (block.items ?? []).map((t) => ({ text: t }));
        s.addText(items, {
          x: 0.5,
          y: 0.5,
          w: 9,
          h: 5,
          fontSize: 18,
          bullet: true,
        });
      }
    }

    await pptx.writeFile({ fileName: absPath });
  }

  // ---------- PDF ----------
  private async renderPdf(absPath: string, spec: StructuredSpec) {
    await new Promise<void>((resolve, reject) => {
      const doc = new PDFDocument({ size: 'LETTER', margin: 54 });
      const stream = fs.createWriteStream(absPath);
      doc.pipe(stream);

      doc.fontSize(22).text(spec.title, { align: 'center' });
      doc.moveDown();

      for (const block of spec.blocks) {
        switch (block.type) {
          case 'heading': {
            const lvl = block.level ?? 1;
            const size = Math.max(20 - lvl * 2, 12);
            doc.fontSize(size).text(block.text ?? '');
            doc.moveDown(0.5);
            break;
          }
          case 'paragraph':
            doc.fontSize(12).text(block.text ?? '', { align: 'left' });
            doc.moveDown(0.5);
            break;
          case 'bullets':
            for (const item of block.items ?? []) {
              doc.fontSize(12).text(`• ${item}`);
            }
            doc.moveDown(0.5);
            break;
          case 'numbered':
            (block.items ?? []).forEach((item, i) => {
              doc.fontSize(12).text(`${i + 1}. ${item}`);
            });
            doc.moveDown(0.5);
            break;
          case 'table':
            for (const row of block.rows ?? []) {
              doc.fontSize(11).text(row.join('  |  '));
            }
            doc.moveDown(0.5);
            break;
          case 'pageBreak':
            doc.addPage();
            break;
          default:
            break;
        }
      }

      doc.end();
      stream.on('finish', () => resolve());
      stream.on('error', reject);
    });
  }

  // ---------- PNG ----------
  private async renderPng(absPath: string, spec: StructuredSpec) {
    // 1x1 transparent png as placeholder. For a real implementation we would
    // use a headless browser (Puppeteer) or node-canvas; here we embed a
    // minimal PNG so the pipeline is complete and the file exists on disk.
    const PNG_1X1 = Buffer.from(
      '89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000D49444154789C6360000000000200018E5D5C060000000049454E44AE426082',
      'hex',
    );
    await fs.promises.writeFile(absPath, PNG_1X1);
    // Sidecar text for the spec so it isn't lost:
    await fs.promises.writeFile(
      absPath + '.txt',
      this.renderPlain(spec),
      'utf8',
    );
  }

  // ---------- plain/md ----------
  private renderPlain(spec: StructuredSpec): string {
    const lines: string[] = [spec.title, ''];
    for (const block of spec.blocks) {
      switch (block.type) {
        case 'heading':
          lines.push(block.text ?? '');
          lines.push('');
          break;
        case 'paragraph':
          lines.push(block.text ?? '');
          lines.push('');
          break;
        case 'bullets':
        case 'numbered':
          for (const it of block.items ?? []) lines.push(`- ${it}`);
          lines.push('');
          break;
        case 'table':
          for (const row of block.rows ?? []) lines.push(row.join(' | '));
          lines.push('');
          break;
        default:
          break;
      }
    }
    return lines.join('\n');
  }

  private renderMarkdown(spec: StructuredSpec): string {
    const out: string[] = [`# ${spec.title}`, ''];
    for (const block of spec.blocks) {
      switch (block.type) {
        case 'heading':
          out.push(
            `${'#'.repeat(Math.min(block.level ?? 2, 6))} ${block.text ?? ''}`,
          );
          out.push('');
          break;
        case 'paragraph':
          out.push(block.text ?? '');
          out.push('');
          break;
        case 'bullets':
          for (const it of block.items ?? []) out.push(`- ${it}`);
          out.push('');
          break;
        case 'numbered':
          (block.items ?? []).forEach((it, i) => out.push(`${i + 1}. ${it}`));
          out.push('');
          break;
        case 'table':
          if (block.rows && block.rows.length > 0) {
            out.push(`| ${block.rows[0].join(' | ')} |`);
            out.push(`| ${block.rows[0].map(() => '---').join(' | ')} |`);
            for (let i = 1; i < block.rows.length; i += 1) {
              out.push(`| ${block.rows[i].join(' | ')} |`);
            }
            out.push('');
          }
          break;
        default:
          break;
      }
    }
    return out.join('\n');
  }

  private safeFilename(name: string): string {
    return (
      name
        .replace(/[^\w\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-')
        .slice(0, 80) || 'document'
    );
  }
}
