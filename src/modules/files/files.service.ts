import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import PptxGenJS from 'pptxgenjs';
import { AccessControlService } from '../../shared/access-control/access-control.service';
import { ContentIndexService } from '../search/content-index.service';
import { UploadFileDto } from './dto/upload-file.dto';
import { FileEntity, FileScope } from './entities/file.entity';

interface UploadInput {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
  size: number;
}

export interface EditableFileContent {
  fileId: string;
  filename: string;
  mimeType: string;
  editable: boolean;
  format: 'text' | 'docx' | 'xlsx' | 'pptx';
  text: string;
}

@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);
  private readonly storageRoot: string;

  constructor(
    @InjectRepository(FileEntity)
    private readonly filesRepository: Repository<FileEntity>,
    private readonly accessControlService: AccessControlService,
    private readonly configService: ConfigService,
    private readonly contentIndexService: ContentIndexService,
  ) {
    const configured = this.configService.get<string>('FILE_STORAGE_ROOT', '');
    this.storageRoot = configured
      ? path.resolve(configured)
      : path.resolve(process.cwd(), 'storage', 'files');
    this.ensureDir(this.storageRoot);
  }

  async upload(
    dto: UploadFileDto,
    file: UploadInput,
    actorUserId: string,
  ): Promise<FileEntity> {
    await this.accessControlService.assertResolvedAccess(actorUserId, {
      resource: 'system',
      action: 'create',
      organizationId: dto.organizationId,
      workspaceId: dto.workspaceId,
      systemId: dto.systemId,
    });

    const scope: FileScope = dto.scope ?? 'attachment';
    const id = crypto.randomUUID();
    const ext = path.extname(file.originalName) || '';
    const safeName = `${id}${ext}`;

    const relDir = path.join(dto.organizationId, scope);
    const absDir = path.join(this.storageRoot, relDir);
    this.ensureDir(absDir);

    const absPath = path.join(absDir, safeName);
    await fs.promises.writeFile(absPath, file.buffer);

    const checksum = crypto
      .createHash('sha256')
      .update(file.buffer)
      .digest('hex');

    const entity = this.filesRepository.create({
      id,
      organizationId: dto.organizationId,
      workspaceId: dto.workspaceId ?? null,
      systemId: dto.systemId ?? null,
      scope,
      filename: file.originalName,
      mimeType: file.mimeType,
      size: String(file.size),
      storagePath: path.join(relDir, safeName).replace(/\\/g, '/'),
      checksum,
      ownerKind: dto.ownerKind ?? null,
      ownerId: dto.ownerId ?? null,
      metadata: null,
      uploadedByUserId: actorUserId,
      status: 'active',
    });

    const saved = await this.filesRepository.save(entity);
    await this.indexFileBuffer(saved, file.buffer);
    return saved;
  }

  /**
   * Register a file that has already been written to disk (used by
   * DocumentsService so it doesn't have to round-trip through multer).
   */
  async register(params: {
    organizationId: string;
    workspaceId?: string | null;
    systemId?: string | null;
    scope: FileScope;
    filename: string;
    mimeType: string;
    absolutePath: string;
    size: number;
    ownerKind?: string | null;
    ownerId?: string | null;
    uploadedByUserId?: string | null;
    metadata?: Record<string, unknown> | null;
  }): Promise<FileEntity> {
    const rel = path
      .relative(this.storageRoot, params.absolutePath)
      .replace(/\\/g, '/');

    const buffer = await fs.promises.readFile(params.absolutePath);
    const checksum = crypto.createHash('sha256').update(buffer).digest('hex');

    const entity = this.filesRepository.create({
      organizationId: params.organizationId,
      workspaceId: params.workspaceId ?? null,
      systemId: params.systemId ?? null,
      scope: params.scope,
      filename: params.filename,
      mimeType: params.mimeType,
      size: String(params.size),
      storagePath: rel,
      checksum,
      ownerKind: params.ownerKind ?? null,
      ownerId: params.ownerId ?? null,
      metadata: params.metadata ?? null,
      uploadedByUserId: params.uploadedByUserId ?? null,
      status: 'active',
    });

    const saved = await this.filesRepository.save(entity);
    await this.indexFileBuffer(saved, buffer);
    return saved;
  }

  async list(
    organizationId: string,
    actorUserId: string,
    filters: {
      workspaceId?: string;
      systemId?: string;
      scope?: FileScope;
      ownerKind?: string;
      ownerId?: string;
    } = {},
  ) {
    const qb = this.filesRepository.createQueryBuilder('file');

    await this.accessControlService.applyTenantScopeToQueryBuilder(
      qb,
      'file',
      actorUserId,
      {
        organizationField: 'organizationId',
        workspaceField: 'workspaceId',
        organizationId,
        workspaceId: filters.workspaceId,
      },
    );

    if (filters.workspaceId) {
      qb.andWhere('file.workspaceId = :wid', { wid: filters.workspaceId });
    }
    if (filters.systemId) {
      qb.andWhere('file.systemId = :sid', { sid: filters.systemId });
    }
    if (filters.scope) {
      qb.andWhere('file.scope = :scope', { scope: filters.scope });
    }
    if (filters.ownerKind) {
      qb.andWhere('file.ownerKind = :ok', { ok: filters.ownerKind });
    }
    if (filters.ownerId) {
      qb.andWhere('file.ownerId = :oid', { oid: filters.ownerId });
    }

    qb.andWhere("file.status = 'active'");
    qb.orderBy('file.createdAt', 'DESC').limit(200);

    return qb.getMany();
  }

  async findOne(fileId: string, actorUserId: string) {
    const file = await this.filesRepository.findOne({ where: { id: fileId } });
    if (!file || file.status === 'deleted') {
      throw new NotFoundException('File not found.');
    }

    await this.accessControlService.assertResolvedAccess(actorUserId, {
      resource: 'system',
      action: 'read',
      organizationId: file.organizationId,
      workspaceId: file.workspaceId ?? undefined,
    });

    return file;
  }

  getAbsolutePath(file: FileEntity): string {
    return path.join(this.storageRoot, file.storagePath);
  }

  async read(fileId: string, actorUserId: string) {
    const file = await this.findOne(fileId, actorUserId);
    const abs = this.getAbsolutePath(file);
    const buffer = await fs.promises.readFile(abs);
    return { file, buffer };
  }

  async readEditableContent(
    fileId: string,
    actorUserId: string,
  ): Promise<EditableFileContent> {
    const { file, buffer } = await this.read(fileId, actorUserId);
    const format = this.editableFormat(file.filename, file.mimeType);
    if (!format) {
      throw new BadRequestException('This file type is not editable yet.');
    }

    const text =
      format === 'docx'
        ? await this.extractDocxText(buffer)
        : format === 'xlsx'
          ? await this.extractXlsxText(buffer)
          : format === 'pptx'
            ? await this.extractPptxText(buffer)
        : buffer.toString('utf8');

    return {
      fileId: file.id,
      filename: file.filename,
      mimeType: file.mimeType,
      editable: true,
      format,
      text,
    };
  }

  async saveEditableContent(
    fileId: string,
    text: string,
    actorUserId: string,
  ): Promise<EditableFileContent> {
    const file = await this.findOne(fileId, actorUserId);

    await this.accessControlService.assertResolvedAccess(actorUserId, {
      resource: 'system',
      action: 'update',
      organizationId: file.organizationId,
      workspaceId: file.workspaceId ?? undefined,
      systemId: file.systemId ?? undefined,
    });

    const format = this.editableFormat(file.filename, file.mimeType);
    if (!format) {
      throw new BadRequestException('This file type is not editable yet.');
    }

    const buffer =
      format === 'docx'
        ? await this.renderDocxFromText(text || ' ')
        : format === 'xlsx'
          ? await this.renderXlsxFromText(text)
          : format === 'pptx'
            ? await this.renderPptxFromText(text)
        : Buffer.from(text ?? '', 'utf8');

    const abs = this.getAbsolutePath(file);
    await fs.promises.writeFile(abs, buffer);

    file.size = String(buffer.length);
    file.checksum = crypto.createHash('sha256').update(buffer).digest('hex');
    file.metadata = {
      ...(file.metadata ?? {}),
      editableText: true,
      editedAt: new Date().toISOString(),
    };
    await this.filesRepository.save(file);
    await this.indexFileBuffer(file, buffer);

    return {
      fileId: file.id,
      filename: file.filename,
      mimeType: file.mimeType,
      editable: true,
      format,
      text,
    };
  }

  async delete(fileId: string, actorUserId: string) {
    const file = await this.findOne(fileId, actorUserId);
    file.status = 'deleted';
    await this.filesRepository.save(file);
    return { id: file.id, status: 'deleted' };
  }

  private ensureDir(dir: string) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private editableFormat(
    filename: string,
    mimeType: string,
  ): 'text' | 'docx' | 'xlsx' | 'pptx' | null {
    const lower = filename.toLowerCase();
    if (
      lower.endsWith('.docx') ||
      mimeType ===
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ) {
      return 'docx';
    }
    if (
      lower.endsWith('.xlsx') ||
      lower.endsWith('.xls') ||
      mimeType ===
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ) {
      return 'xlsx';
    }
    if (
      lower.endsWith('.pptx') ||
      mimeType ===
        'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    ) {
      return 'pptx';
    }
    if (
      /^(text\/|application\/(json|xml|x-yaml))/.test(mimeType) ||
      /\.(txt|md|csv|json|js|ts|tsx|html|css|sql|yaml|yml|xml|log|rtf)$/i.test(
        filename,
      )
    ) {
      return 'text';
    }
    return null;
  }

  private async indexFileBuffer(file: FileEntity, buffer: Buffer) {
    try {
      const text = await this.extractTextForIndex(file, buffer);
      if (!text.trim()) return;
      await this.contentIndexService.index({
        organizationId: file.organizationId,
        workspaceId: file.workspaceId,
        systemId: file.systemId,
        sourceType: 'file',
        sourceId: file.id,
        sourceTitle: file.filename,
        text,
        metadata: {
          mimeType: file.mimeType,
          scope: file.scope,
          ownerKind: file.ownerKind,
          ownerId: file.ownerId,
        },
      });
    } catch (err) {
      this.logger.warn(
        `File indexing failed for ${file.id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private async extractTextForIndex(file: FileEntity, buffer: Buffer) {
    const format = this.editableFormat(file.filename, file.mimeType);
    if (!format) return '';
    if (format === 'docx') return this.extractDocxText(buffer);
    if (format === 'xlsx') return this.extractXlsxText(buffer);
    if (format === 'pptx') return this.extractPptxText(buffer);
    return buffer.toString('utf8');
  }

  private async extractDocxText(buffer: Buffer): Promise<string> {
    const zip = await JSZip.loadAsync(buffer);
    const documentXml = await zip.file('word/document.xml')?.async('string');
    if (!documentXml) return '';

    const paragraphs = documentXml
      .split(/<\/w:p>/)
      .map((paragraph) => {
        const runs = Array.from(paragraph.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g));
        return runs.map((run) => decodeXml(run[1])).join('');
      })
      .filter((line) => line.trim().length > 0);

    return paragraphs.join('\n\n');
  }

  private async extractXlsxText(buffer: Buffer): Promise<string> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    const sheet = workbook.worksheets[0];
    if (!sheet) return '';
    const rows: string[] = [];
    sheet.eachRow((row) => {
      const values = Array.isArray(row.values) ? row.values.slice(1) : [];
      rows.push(values.map((value) => csvEscape(cellText(value))).join(','));
    });
    return rows.join('\n');
  }

  private async extractPptxText(buffer: Buffer): Promise<string> {
    const zip = await JSZip.loadAsync(buffer);
    const slideFiles = Object.keys(zip.files)
      .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
      .sort((a, b) => Number(a.match(/\d+/)?.[0] ?? 0) - Number(b.match(/\d+/)?.[0] ?? 0));

    const slides: string[] = [];
    for (const name of slideFiles) {
      const xml = await zip.file(name)?.async('string');
      if (!xml) continue;
      const text = Array.from(xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g))
        .map((match) => decodeXml(match[1]))
        .filter(Boolean)
        .join('\n');
      slides.push(text);
    }
    return slides.join('\n\n--- slide ---\n\n');
  }

  private async renderDocxFromText(text: string): Promise<Buffer> {
    const paragraphs = text.split(/\n{2,}/).map((block) =>
      new Paragraph({
        children: [new TextRun(block.replace(/\n/g, ' '))],
      }),
    );
    const doc = new Document({
      sections: [{ children: paragraphs.length ? paragraphs : [new Paragraph('')] }],
    });
    return Buffer.from(await Packer.toBuffer(doc));
  }

  private async renderXlsxFromText(text: string): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Sheet1');
    for (const row of parseCsv(text)) sheet.addRow(row);
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  private async renderPptxFromText(text: string): Promise<Buffer> {
    const pptx = new PptxGenJS();
    const slides = text.split(/\n\s*--- slide ---\s*\n/i);
    for (const raw of slides.length ? slides : ['']) {
      const slide = pptx.addSlide();
      const lines = raw.split('\n').filter((line) => line.trim());
      slide.addText(lines[0] || 'Untitled slide', {
        x: 0.6,
        y: 0.45,
        w: 8.2,
        h: 0.6,
        fontSize: 28,
        bold: true,
        color: '1f2937',
      });
      slide.addText(lines.slice(1).join('\n') || ' ', {
        x: 0.75,
        y: 1.35,
        w: 8,
        h: 3.8,
        fontSize: 16,
        breakLine: false,
        color: '374151',
        fit: 'shrink',
      });
    }
    const output = await pptx.write({ outputType: 'nodebuffer' });
    return Buffer.isBuffer(output)
      ? output
      : Buffer.from(output as ArrayBuffer);
  }
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    if ('text' in value && typeof value.text === 'string') return value.text;
    if ('result' in value) return cellText(value.result);
    return JSON.stringify(value);
  }
  return String(value);
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function parseCsv(text: string): string[][] {
  return text
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .map((line) => {
      const cells: string[] = [];
      let cell = '';
      let quoted = false;
      for (let i = 0; i < line.length; i += 1) {
        const char = line[i];
        const next = line[i + 1];
        if (char === '"' && quoted && next === '"') {
          cell += '"';
          i += 1;
        } else if (char === '"') {
          quoted = !quoted;
        } else if (char === ',' && !quoted) {
          cells.push(cell);
          cell = '';
        } else {
          cell += char;
        }
      }
      cells.push(cell);
      return cells;
    });
}
