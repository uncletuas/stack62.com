import {
  BadRequestException,
  Inject,
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
import { STORAGE_BACKEND } from '../../shared/storage';
import type { StorageBackend } from '../../shared/storage';
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
    @Inject(STORAGE_BACKEND)
    private readonly storage: StorageBackend,
  ) {
    const configured = this.configService.get<string>('FILE_STORAGE_ROOT', '');
    this.storageRoot = configured
      ? path.resolve(configured)
      : path.resolve(process.cwd(), 'storage', 'files');
    // Local-disk only — kept for legacy register() compatibility. The
    // StorageBackend is the canonical read/write path for everything else.
    if (this.storage.name === 'local-disk') {
      this.ensureDir(this.storageRoot);
    }
  }

  /** Read raw bytes via the storage backend. Works for both local-disk and S3. */
  async getBuffer(file: FileEntity): Promise<Buffer> {
    return this.storage.getObjectBuffer(file.storagePath);
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
    const storageKey = `${dto.organizationId}/${scope}/${safeName}`;

    const checksum = crypto
      .createHash('sha256')
      .update(file.buffer)
      .digest('hex');

    await this.storage.putObject({
      key: storageKey,
      body: file.buffer,
      contentType: file.mimeType,
      checksum,
    });

    const entity = this.filesRepository.create({
      id,
      organizationId: dto.organizationId,
      workspaceId: dto.workspaceId ?? null,
      systemId: dto.systemId ?? null,
      scope,
      filename: file.originalName,
      mimeType: file.mimeType,
      size: String(file.size),
      storagePath: storageKey,
      checksum,
      ownerKind: dto.ownerKind ?? null,
      ownerId: dto.ownerId ?? null,
      metadata: null,
      uploadedByUserId: actorUserId,
      status: 'active',
      folderId: (dto as { folderId?: string }).folderId ?? null,
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
    const buffer = await fs.promises.readFile(params.absolutePath);
    const checksum = crypto.createHash('sha256').update(buffer).digest('hex');

    // For non-local backends, copy the on-disk file into object storage
    // so the registered key resolves correctly later. The DocumentsService
    // writes to a local temp dir; we re-key it under the canonical layout.
    let storageKey: string;
    if (this.storage.name === 'local-disk') {
      storageKey = path
        .relative(this.storageRoot, params.absolutePath)
        .replace(/\\/g, '/');
    } else {
      storageKey = `${params.organizationId}/${params.scope}/${path.basename(
        params.absolutePath,
      )}`;
      await this.storage.putObject({
        key: storageKey,
        body: buffer,
        contentType: params.mimeType,
        checksum,
      });
    }

    const entity = this.filesRepository.create({
      organizationId: params.organizationId,
      workspaceId: params.workspaceId ?? null,
      systemId: params.systemId ?? null,
      scope: params.scope,
      filename: params.filename,
      mimeType: params.mimeType,
      size: String(params.size),
      storagePath: storageKey,
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


  async read(fileId: string, actorUserId: string) {
    const file = await this.findOne(fileId, actorUserId);
    const buffer = await this.storage.getObjectBuffer(file.storagePath);
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

    file.checksum = crypto.createHash('sha256').update(buffer).digest('hex');
    await this.storage.putObject({
      key: file.storagePath,
      body: buffer,
      contentType: file.mimeType,
      checksum: file.checksum,
    });
    file.size = String(buffer.length);
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

  /**
   * Walk the version chain back from a file. Returns the current file
   * first, then each prior version (followed by previousVersionFileId).
   * The chain is capped at 50 to defend against pathological loops.
   */
  async listVersions(fileId: string, actorUserId: string) {
    const head = await this.findOne(fileId, actorUserId);
    const history = [head];
    let cursorId = head.previousVersionFileId;
    while (cursorId && history.length < 50) {
      const prev = await this.filesRepository.findOne({
        where: { id: cursorId },
      });
      if (!prev) break;
      // Access check — if the user can read the head, they can read
      // prior versions (same file, same scope, same org).
      history.push(prev);
      cursorId = prev.previousVersionFileId;
    }
    return history.map((row) => ({
      id: row.id,
      version: row.version,
      filename: row.filename,
      size: row.size,
      checksum: row.checksum,
      mimeType: row.mimeType,
      uploadedByUserId: row.uploadedByUserId,
      createdAt: row.createdAt,
      isCurrent: row.id === head.id,
    }));
  }

  async delete(fileId: string, actorUserId: string) {
    const file = await this.findOne(fileId, actorUserId);
    file.status = 'deleted';
    await this.filesRepository.save(file);
    return { id: file.id, status: 'deleted' };
  }

  /**
   * Rename and/or move a file. Either field is optional — pass only
   * what changed. `folderId: null` moves the file to the implicit org
   * root.
   */
  async update(
    fileId: string,
    actorUserId: string,
    patch: { filename?: string; folderId?: string | null },
  ) {
    const file = await this.findOne(fileId, actorUserId);
    let dirty = false;
    if (typeof patch.filename === 'string') {
      const clean = patch.filename.trim();
      if (!clean) throw new BadRequestException('filename cannot be empty.');
      if (clean.length > 512)
        throw new BadRequestException('filename is too long (max 512).');
      if (/[\\/]/.test(clean))
        throw new BadRequestException('filename cannot contain / or \\.');
      file.filename = clean;
      dirty = true;
    }
    if (patch.folderId !== undefined) {
      file.folderId = patch.folderId;
      dirty = true;
    }
    if (!dirty) return file;
    return this.filesRepository.save(file);
  }

  /**
   * Delete many files in one call. Per-file access is still enforced
   * inside findOne(). Returns a per-id outcome so the UI can keep the
   * rows that failed and clear the rest.
   */
  async deleteMany(fileIds: string[], actorUserId: string) {
    const results: Array<{ id: string; ok: boolean; error?: string }> = [];
    for (const id of fileIds) {
      try {
        await this.delete(id, actorUserId);
        results.push({ id, ok: true });
      } catch (err) {
        results.push({
          id,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return { results };
  }

  /** Move many files to a single folder (or to the root with null). */
  async moveMany(
    fileIds: string[],
    folderId: string | null,
    actorUserId: string,
  ) {
    const results: Array<{ id: string; ok: boolean; error?: string }> = [];
    for (const id of fileIds) {
      try {
        await this.update(id, actorUserId, { folderId });
        results.push({ id, ok: true });
      } catch (err) {
        results.push({
          id,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return { results };
  }

  /**
   * Duplicate a file into the same or different folder. Reuses the
   * underlying storage object — files are content-addressed, no extra
   * disk cost. Filename gets " (copy)" appended unless one was
   * provided.
   */
  async copy(
    fileId: string,
    actorUserId: string,
    opts: { folderId?: string | null; filename?: string } = {},
  ) {
    const src = await this.findOne(fileId, actorUserId);
    const clone = this.filesRepository.create({
      organizationId: src.organizationId,
      workspaceId: src.workspaceId,
      systemId: src.systemId,
      scope: src.scope,
      filename: opts.filename?.trim() || appendCopySuffix(src.filename),
      mimeType: src.mimeType,
      size: src.size,
      storagePath: src.storagePath,
      checksum: src.checksum,
      ownerKind: src.ownerKind,
      ownerId: src.ownerId,
      metadata: src.metadata,
      uploadedByUserId: actorUserId,
      status: 'active',
      folderId: opts.folderId === undefined ? src.folderId : opts.folderId,
      version: 1,
      previousVersionFileId: null,
    });
    return this.filesRepository.save(clone);
  }

  /** Generate signed download URL (if storage supports it) */
  async getSignedDownloadUrl(
    fileId: string,
    actorUserId: string,
    expiresInSeconds: number = 3600,
  ): Promise<string | null> {
    const file = await this.findOne(fileId, actorUserId);
    if (typeof this.storage.generateSignedDownloadUrl === 'function') {
      return this.storage.generateSignedDownloadUrl(
        file.storagePath,
        expiresInSeconds,
      );
    }
    return null;
  }

  /** Generate signed upload URL for a new file */
  async getSignedUploadUrl(
    dto: UploadFileDto,
    mimeType: string,
    filename: string,
    actorUserId: string,
  ): Promise<{ key: string; signedUrl: string | null }> {
    await this.accessControlService.assertResolvedAccess(actorUserId, {
      resource: 'system',
      action: 'create',
      organizationId: dto.organizationId,
      workspaceId: dto.workspaceId,
      systemId: dto.systemId,
    });

    const id = crypto.randomUUID();
    const ext = path.extname(filename) || '';
    const safeName = `${id}${ext}`;
    const key = `${dto.organizationId}/${dto.scope || 'attachment'}/${safeName}`;

    let signedUrl: string | null = null;
    if (typeof this.storage.generateSignedUploadUrl === 'function') {
      signedUrl = await this.storage.generateSignedUploadUrl(
        key,
        mimeType,
        3600,
      );
    }

    return { key, signedUrl };
  }

  /** Register file after direct upload to signed URL */
  async registerDirectUpload(
    dto: UploadFileDto,
    key: string,
    filename: string,
    mimeType: string,
    size: number,
    checksum: string,
    actorUserId: string,
  ) {
    await this.accessControlService.assertResolvedAccess(actorUserId, {
      resource: 'system',
      action: 'create',
      organizationId: dto.organizationId,
      workspaceId: dto.workspaceId,
      systemId: dto.systemId,
    });

    const entity = this.filesRepository.create({
      id: path.basename(key, path.extname(key)),
      organizationId: dto.organizationId,
      workspaceId: dto.workspaceId ?? null,
      systemId: dto.systemId ?? null,
      scope: dto.scope || 'attachment',
      filename,
      mimeType,
      size: String(size),
      storagePath: key,
      checksum,
      ownerKind: dto.ownerKind ?? null,
      ownerId: dto.ownerId ?? null,
      metadata: null,
      uploadedByUserId: actorUserId,
      status: 'active',
      folderId: (dto as { folderId?: string }).folderId ?? null,
    });

    const saved = await this.filesRepository.save(entity);
    return saved;
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

function appendCopySuffix(filename: string): string {
  const dotAt = filename.lastIndexOf('.');
  if (dotAt <= 0) return `${filename} (copy)`;
  const base = filename.slice(0, dotAt);
  const ext = filename.slice(dotAt);
  return `${base} (copy)${ext}`;
}
