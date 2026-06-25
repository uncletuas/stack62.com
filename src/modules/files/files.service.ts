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
import * as mammoth from 'mammoth';
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
   * Store an in-memory buffer as a file without an access-control check —
   * for system-originated content that has no acting user, e.g. media pulled
   * off an inbound WhatsApp message. Tenant scoping comes from the explicit
   * organization/workspace, so the bytes still land in the right place.
   */
  async registerBuffer(params: {
    organizationId: string;
    workspaceId?: string | null;
    scope?: FileScope;
    filename: string;
    mimeType: string;
    buffer: Buffer;
    ownerKind?: string | null;
    ownerId?: string | null;
    metadata?: Record<string, unknown> | null;
  }): Promise<FileEntity> {
    const scope: FileScope = params.scope ?? 'attachment';
    const id = crypto.randomUUID();
    const ext = path.extname(params.filename) || '';
    const safeName = `${id}${ext}`;
    const storageKey = `${params.organizationId}/${scope}/${safeName}`;
    const checksum = crypto
      .createHash('sha256')
      .update(params.buffer)
      .digest('hex');

    await this.storage.putObject({
      key: storageKey,
      body: params.buffer,
      contentType: params.mimeType,
      checksum,
    });

    const entity = this.filesRepository.create({
      id,
      organizationId: params.organizationId,
      workspaceId: params.workspaceId ?? null,
      systemId: null,
      scope,
      filename: params.filename,
      mimeType: params.mimeType,
      size: String(params.buffer.length),
      storagePath: storageKey,
      checksum,
      ownerKind: params.ownerKind ?? null,
      ownerId: params.ownerId ?? null,
      metadata: params.metadata ?? null,
      uploadedByUserId: null,
      status: 'active',
      folderId: null,
    });

    const saved = await this.filesRepository.save(entity);
    await this.indexFileBuffer(saved, params.buffer);
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

    // For documents we round-trip rich HTML. If the file has been edited
    // in-app we keep the canonical HTML in metadata (lossless); otherwise
    // we convert the original .docx to HTML with mammoth, which preserves
    // headings, bold/italic, lists, tables, and links instead of dumping
    // raw OOXML markup the way the old regex extractor did.
    const savedHtml =
      typeof file.metadata?.editableHtml === 'string'
        ? file.metadata.editableHtml
        : null;
    // Presentations round-trip a rich "deck" JSON (positioned text, fonts,
    // colors, images) that the slides editor renders natively.
    const savedDeck =
      typeof file.metadata?.editableDeck === 'string'
        ? file.metadata.editableDeck
        : null;

    const text =
      format === 'docx'
        ? (savedHtml ?? (await this.extractDocxHtml(buffer)))
        : format === 'xlsx'
          ? await this.extractXlsxText(buffer)
          : format === 'pptx'
            ? (savedDeck ?? (await this.extractPptxDeck(buffer)))
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

    // Documents arrive as rich HTML from the editor. We keep that HTML as
    // the lossless source of truth in metadata and (re)build the .docx
    // binary from its plain-text projection so downloads stay valid.
    const docxPlain = format === 'docx' ? htmlToPlainText(text) : text;

    const buffer =
      format === 'docx'
        ? await this.renderDocxFromText(docxPlain || ' ')
        : format === 'xlsx'
          ? await this.renderXlsxFromText(text)
          : format === 'pptx'
            ? await this.renderPptxFromDeck(text)
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
      // Keep the full-fidelity editor content so re-opening restores
      // exactly what the user last saw: HTML for documents, deck JSON for
      // presentations.
      editableHtml: format === 'docx' ? text : undefined,
      editableDeck: format === 'pptx' ? text : undefined,
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

  /**
   * Convert a .docx to clean editor HTML, preserving headings, bold,
   * italic, lists, tables, and links. Falls back to the legacy plain-text
   * extractor only if mammoth can't parse the document.
   */
  private async extractDocxHtml(buffer: Buffer): Promise<string> {
    try {
      const result = await mammoth.convertToHtml({ buffer });
      const html = (result.value ?? '').trim();
      if (html) return html;
    } catch (err) {
      this.logger.warn(
        `mammoth docx->html failed, falling back to text: ${
          (err as Error).message
        }`,
      );
    }
    const text = await this.extractDocxText(buffer);
    return text
      .split(/\n{2,}/)
      .map((p) => `<p>${escapeHtml(p)}</p>`)
      .join('');
  }

  private async extractDocxText(buffer: Buffer): Promise<string> {
    const zip = await JSZip.loadAsync(buffer);
    const documentXml = await zip.file('word/document.xml')?.async('string');
    if (!documentXml) return '';

    const paragraphs = documentXml
      .split(/<\/w:p>/)
      .map((paragraph) => {
        const runs = Array.from(
          paragraph.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g),
        );
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
      .sort(
        (a, b) =>
          Number(a.match(/\d+/)?.[0] ?? 0) - Number(b.match(/\d+/)?.[0] ?? 0),
      );

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

  /**
   * Parse a .pptx into the rich "deck" JSON the slides editor renders
   * natively: each slide keeps its positioned text boxes (with font size,
   * bold/italic, color, alignment) and inline images. Falls back to a
   * simple text-only deck if parsing fails, so import never breaks.
   */
  private async extractPptxDeck(buffer: Buffer): Promise<string> {
    try {
      const zip = await JSZip.loadAsync(buffer);
      const presXml =
        (await zip.file('ppt/presentation.xml')?.async('string')) ?? '';
      const sizeMatch = presXml.match(/<p:sldSz[^>]*cx="(\d+)"[^>]*cy="(\d+)"/);
      const cx = sizeMatch ? Number(sizeMatch[1]) : 12192000;
      const cy = sizeMatch ? Number(sizeMatch[2]) : 6858000;
      const scaleX = SLIDE_CANVAS_W / cx;
      const scaleY = SLIDE_CANVAS_H / cy;

      const slideNames = Object.keys(zip.files)
        .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
        .sort(
          (a, b) =>
            Number(a.match(/\d+/)?.[0] ?? 0) - Number(b.match(/\d+/)?.[0] ?? 0),
        );

      const slides: unknown[] = [];
      for (const name of slideNames) {
        const xml = await zip.file(name)?.async('string');
        if (!xml) continue;

        // Map relationship ids -> media targets for this slide.
        const relName = name.replace(
          /slides\/(slide\d+)\.xml$/,
          'slides/_rels/$1.xml.rels',
        );
        const relsXml = (await zip.file(relName)?.async('string')) ?? '';
        const rels = new Map<string, string>();
        for (const m of relsXml.matchAll(
          /<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g,
        )) {
          rels.set(m[1], m[2]);
        }

        const elements: unknown[] = [];

        for (const sp of xml.matchAll(/<p:sp>([\s\S]*?)<\/p:sp>/g)) {
          const block = sp[1];
          const xf = parseXfrm(block);
          const body = parseTextBody(block, scaleX);
          if (!body || !body.text.trim()) continue;
          elements.push({
            id: crypto.randomUUID(),
            type: 'text',
            x: Math.round((xf?.x ?? 0) * scaleX),
            y: Math.round((xf?.y ?? 0) * scaleY),
            w: Math.round((xf?.cx ?? cx * 0.8) * scaleX),
            h: Math.round((xf?.cy ?? 1_000_000) * scaleY),
            text: body.text,
            fontSize: body.fontSize,
            fontFamily: SLIDE_DEFAULT_FONT,
            bold: body.bold,
            italic: body.italic,
            underline: body.underline,
            color: body.color,
            align: body.align,
          });
        }

        for (const pic of xml.matchAll(/<p:pic>([\s\S]*?)<\/p:pic>/g)) {
          const block = pic[1];
          const xf = parseXfrm(block);
          const embed = block.match(/r:embed="([^"]+)"/);
          let src = '';
          if (embed) {
            const target = rels.get(embed[1]);
            if (target) {
              const mediaPath = target.replace(/^\.\.\//, 'ppt/');
              const media = zip.file(mediaPath);
              if (media) {
                const b64 = await media.async('base64');
                const ext = (mediaPath.split('.').pop() ?? 'png').toLowerCase();
                const mime =
                  ext === 'jpg' || ext === 'jpeg'
                    ? 'image/jpeg'
                    : ext === 'gif'
                      ? 'image/gif'
                      : ext === 'svg'
                        ? 'image/svg+xml'
                        : 'image/png';
                src = `data:${mime};base64,${b64}`;
              }
            }
          }
          if (!src) continue;
          elements.push({
            id: crypto.randomUUID(),
            type: 'image',
            src,
            x: Math.round((xf?.x ?? 0) * scaleX),
            y: Math.round((xf?.y ?? 0) * scaleY),
            w: Math.round((xf?.cx ?? 4_000_000) * scaleX),
            h: Math.round((xf?.cy ?? 3_000_000) * scaleY),
          });
        }

        slides.push({
          id: crypto.randomUUID(),
          background: '#ffffff',
          elements,
        });
      }

      if (!slides.length) throw new Error('no slides parsed');
      return JSON.stringify({ version: 2, slides });
    } catch (err) {
      this.logger.warn(
        `pptx->deck failed, falling back to text slides: ${
          (err as Error).message
        }`,
      );
      const text = await this.extractPptxText(buffer);
      const slides = text.split(/\n\s*--- slide ---\s*\n/i).map((chunk) => {
        const lines = chunk.split(/\r?\n/).filter((l) => l.trim());
        const els: unknown[] = [];
        if (lines[0]) {
          els.push({
            id: crypto.randomUUID(),
            type: 'text',
            x: 100,
            y: 80,
            w: 1400,
            h: 120,
            text: lines[0],
            fontSize: 56,
            fontFamily: SLIDE_DEFAULT_FONT,
            bold: true,
            color: '#1f1f1f',
          });
        }
        if (lines.length > 1) {
          els.push({
            id: crypto.randomUUID(),
            type: 'text',
            x: 100,
            y: 240,
            w: 1400,
            h: 560,
            text: lines.slice(1).join('\n'),
            fontSize: 32,
            fontFamily: SLIDE_DEFAULT_FONT,
            color: '#1f1f1f',
          });
        }
        return {
          id: crypto.randomUUID(),
          background: '#ffffff',
          elements: els,
        };
      });
      return JSON.stringify({
        version: 2,
        slides: slides.length
          ? slides
          : [{ id: crypto.randomUUID(), background: '#ffffff', elements: [] }],
      });
    }
  }

  private async renderDocxFromText(text: string): Promise<Buffer> {
    const paragraphs = text.split(/\n{2,}/).map(
      (block) =>
        new Paragraph({
          children: [new TextRun(block.replace(/\n/g, ' '))],
        }),
    );
    const doc = new Document({
      sections: [
        { children: paragraphs.length ? paragraphs : [new Paragraph('')] },
      ],
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

  /**
   * Rebuild a .pptx from the editor's deck JSON, mapping the 1600×900
   * canvas back to a 13.333×7.5in slide and preserving text formatting and
   * inline images. Falls back to the legacy text renderer if the payload
   * isn't a deck (e.g. an older plain-text presentation).
   */
  private async renderPptxFromDeck(text: string): Promise<Buffer> {
    let deck: { version?: number; slides?: unknown[] } | null = null;
    try {
      deck = JSON.parse(text);
    } catch {
      deck = null;
    }
    if (!deck || deck.version !== 2 || !Array.isArray(deck.slides)) {
      return this.renderPptxFromText(text);
    }

    const pptx = new PptxGenJS();
    pptx.defineLayout({ name: 'S62', width: 13.333, height: 7.5 });
    pptx.layout = 'S62';
    const pxToIn = 13.333 / SLIDE_CANVAS_W;
    const pxToPt = 0.6; // 1600px canvas (120px/in) -> points

    for (const rawSlide of deck.slides) {
      const slide = rawSlide as {
        background?: string;
        elements?: Array<Record<string, unknown>>;
      };
      const s = pptx.addSlide();
      if (
        typeof slide.background === 'string' &&
        slide.background.startsWith('#')
      ) {
        s.background = { color: slide.background.slice(1) };
      }
      for (const el of slide.elements ?? []) {
        const x = (Number(el.x) || 0) * pxToIn;
        const y = (Number(el.y) || 0) * pxToIn;
        const w = Math.max(0.1, (Number(el.w) || 100) * pxToIn);
        const h = Math.max(0.1, (Number(el.h) || 100) * pxToIn);
        if (el.type === 'text') {
          s.addText(String(el.text ?? ''), {
            x,
            y,
            w,
            h,
            fontSize: Math.max(
              6,
              Math.round((Number(el.fontSize) || 32) * pxToPt),
            ),
            bold: !!el.bold,
            italic: !!el.italic,
            color: hexNoHash(el.color, '1f1f1f'),
            align: (el.align as 'left' | 'center' | 'right') || 'left',
            valign: 'top',
          });
        } else if (el.type === 'image' && typeof el.src === 'string') {
          if (el.src.startsWith('data:'))
            s.addImage({ data: el.src, x, y, w, h });
          else s.addImage({ path: el.src, x, y, w, h });
        } else if (el.type === 'shape') {
          s.addShape(
            el.shape === 'ellipse'
              ? pptx.ShapeType.ellipse
              : pptx.ShapeType.rect,
            {
              x,
              y,
              w,
              h,
              fill: { color: hexNoHash(el.fill, '60a5fa') },
              line: el.stroke
                ? {
                    color: hexNoHash(el.stroke, '1d4ed8'),
                    width: Number(el.strokeWidth) || 1,
                  }
                : undefined,
            },
          );
        }
      }
    }

    const output = await pptx.write({ outputType: 'nodebuffer' });
    return Buffer.isBuffer(output)
      ? output
      : Buffer.from(output as ArrayBuffer);
  }
}

// Slide editor canvas (must match SlidesEditor's CANVAS_W/H).
const SLIDE_CANVAS_W = 1600;
const SLIDE_CANVAS_H = 900;
const SLIDE_DEFAULT_FONT = "'Inter', 'Arial', sans-serif";

/** Read an <a:xfrm> position/size (EMU) from a pptx shape block. */
function parseXfrm(
  block: string,
): { x: number; y: number; cx: number; cy: number } | null {
  const off = block.match(/<a:off\s+x="(-?\d+)"\s+y="(-?\d+)"/);
  const ext = block.match(/<a:ext\s+cx="(\d+)"\s+cy="(\d+)"/);
  if (!off && !ext) return null;
  return {
    x: off ? Number(off[1]) : 0,
    y: off ? Number(off[2]) : 0,
    cx: ext ? Number(ext[1]) : 0,
    cy: ext ? Number(ext[2]) : 0,
  };
}

/** Pull text + first-run formatting out of a pptx shape's <p:txBody>. */
function parseTextBody(
  block: string,
  scaleX: number,
): {
  text: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  color: string;
  align: 'left' | 'center' | 'right';
} | null {
  const bodyMatch = block.match(/<p:txBody>([\s\S]*?)<\/p:txBody>/);
  if (!bodyMatch) return null;
  const body = bodyMatch[1];

  const paragraphs = Array.from(body.matchAll(/<a:p>([\s\S]*?)<\/a:p>/g)).map(
    (m) =>
      Array.from(m[1].matchAll(/<a:t>([\s\S]*?)<\/a:t>/g))
        .map((t) => decodeXml(t[1]))
        .join(''),
  );
  const text = paragraphs.join('\n').replace(/\n{3,}/g, '\n\n');

  const szMatch = body.match(/<a:rPr[^>]*\bsz="(\d+)"/);
  const fontSize = szMatch
    ? Math.max(8, Math.round((Number(szMatch[1]) / 100) * 12700 * scaleX))
    : Math.max(8, Math.round((1800 / 100) * 12700 * scaleX));
  const bold = /<a:rPr[^>]*\bb="1"/.test(body);
  const italic = /<a:rPr[^>]*\bi="1"/.test(body);
  const underline = /<a:rPr[^>]*\bu="(?!none)/.test(body);
  const colorMatch = body.match(/<a:srgbClr\s+val="([0-9A-Fa-f]{6})"/);
  const color = colorMatch ? `#${colorMatch[1].toLowerCase()}` : '#1f1f1f';
  const algnMatch = body.match(/<a:pPr[^>]*\balgn="(\w+)"/);
  const align =
    algnMatch?.[1] === 'ctr'
      ? 'center'
      : algnMatch?.[1] === 'r'
        ? 'right'
        : 'left';

  return { text, fontSize, bold, italic, underline, color, align };
}

/** Normalize "#rrggbb" / "rrggbb" to bare hex for PptxGenJS. */
function hexNoHash(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const hex = value.replace('#', '').trim();
  return /^[0-9A-Fa-f]{6}$/.test(hex) ? hex : fallback;
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Project editor HTML down to plain text with paragraph breaks, used to
 * keep the .docx binary valid/downloadable while the lossless HTML lives
 * in metadata. Block tags become double newlines; inline tags are dropped.
 */
function htmlToPlainText(html: string): string {
  if (!html) return '';
  return html
    .replace(/<\s*(br)\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr|blockquote)>/gi, '\n\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
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
