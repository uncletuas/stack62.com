import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { AccessControlService } from '../../shared/access-control/access-control.service';
import { DocumentExtractionService } from '../document-extraction/document-extraction.service';
import { FilesService } from '../files/files.service';
import { FoldersService } from '../folders/folders.service';
import { EmbeddingService } from './embedding.service';
import { DocumentChunkEntity } from './entities/document-chunk.entity';

/**
 * Coworker-facing semantic search.
 *
 * Indexing path: when a file is uploaded or content changes, the
 * FilesService can call `indexFile(fileId)` here. We pull the
 * extraction text (or fall back to raw text-extractable formats),
 * chunk it, embed it, and persist.
 *
 * Search path: `searchSimilar(orgId, query, opts)` returns top-K
 * chunks ranked by cosine similarity, plus a snippet of context.
 *
 * Storage: chunks live in `document_chunks` with the embedding stored
 * as JSONB. On startup we ensure the pgvector extension is installed
 * and add a `vector(N)` column + index if it isn't there yet — that
 * gives us pgvector's native `<=>` operator with HNSW indexing for
 * production-grade search at scale.
 */
@Injectable()
export class SemanticSearchService implements OnModuleInit {
  private readonly logger = new Logger(SemanticSearchService.name);
  private vectorColumnReady = false;

  constructor(
    @InjectRepository(DocumentChunkEntity)
    private readonly chunksRepo: Repository<DocumentChunkEntity>,
    private readonly dataSource: DataSource,
    private readonly embeddings: EmbeddingService,
    private readonly filesService: FilesService,
    private readonly extractionService: DocumentExtractionService,
    private readonly foldersService: FoldersService,
    private readonly accessControl: AccessControlService,
  ) {}

  async onModuleInit() {
    await this.ensurePgVector();
  }

  // ── Indexing ──────────────────────────────────────────────────────────

  /**
   * Re-index a file. Idempotent — wipes prior chunks for the file
   * before inserting new ones.
   */
  async indexFile(fileId: string, actorUserId: string): Promise<number> {
    const file = await this.filesService.findOne(fileId, actorUserId);

    // Prefer the OCR'd raw text if extraction has run; fall back to
    // text-extractable formats via the existing FilesService.
    let text: string | null = null;
    const extraction = await this.extractionService.getForFile(fileId);
    if (extraction?.status === 'completed' && extraction.rawText) {
      text = extraction.rawText;
    } else {
      try {
        const editable = await this.filesService.readEditableContent(
          fileId,
          actorUserId,
        );
        text = editable.text;
      } catch {
        // not editable — skip text-only indexing
      }
    }
    if (!text || !text.trim()) return 0;

    const chunks = chunkText(text, 500);
    const vectors = await this.embeddings.embed(chunks);

    // Wipe + insert.
    await this.chunksRepo.delete({ fileId });
    const rows = chunks.map((chunk, i) =>
      this.chunksRepo.create({
        organizationId: file.organizationId,
        workspaceId: file.workspaceId,
        folderId: file.folderId,
        fileId: file.id,
        ordinal: i,
        text: chunk,
        embedding: vectors[i],
        metadata: { mimeType: file.mimeType, filename: file.filename },
      }),
    );
    await this.chunksRepo.save(rows);

    if (this.vectorColumnReady) {
      // Mirror the JSONB embedding into the native vector column for
      // fast similarity search.
      await this.dataSource.query(
        `UPDATE document_chunks SET embedding_vec = (embedding::text)::vector WHERE file_id = $1`,
        [file.id],
      );
    }

    this.logger.log(`Indexed file ${file.id} → ${rows.length} chunks`);
    return rows.length;
  }

  // ── Search ────────────────────────────────────────────────────────────

  /**
   * Find files semantically similar to `query`. Restricted to the
   * caller's organization + folders they can read.
   */
  async searchSimilar(
    organizationId: string,
    query: string,
    actorUserId: string,
    opts: { limit?: number; folderId?: string | null } = {},
  ): Promise<
    Array<{
      fileId: string;
      ordinal: number;
      text: string;
      score: number;
      filename?: string;
      folderId?: string | null;
    }>
  > {
    if (!query.trim()) return [];

    await this.accessControl.assertResolvedAccess(actorUserId, {
      resource: 'system',
      action: 'read',
      organizationId,
    });

    const [queryVector] = await this.embeddings.embed([query]);
    const limit = Math.max(1, Math.min(opts.limit || 8, 32));

    if (this.vectorColumnReady) {
      // Fast path: pgvector cosine distance.
      const rows = (await this.dataSource.query(
        `SELECT id, file_id AS "fileId", ordinal, text, folder_id AS "folderId",
                metadata,
                1 - (embedding_vec <=> $1::vector) AS score
         FROM document_chunks
         WHERE organization_id = $2
           AND embedding_vec IS NOT NULL
         ORDER BY embedding_vec <=> $1::vector
         LIMIT $3`,
        [JSON.stringify(queryVector), organizationId, limit * 3],
      )) as Array<{
        id: string;
        fileId: string;
        ordinal: number;
        text: string;
        folderId: string | null;
        metadata: Record<string, unknown> | null;
        score: number;
      }>;

      return await this.filterByFolderAccess(
        rows,
        actorUserId,
        opts.folderId,
        limit,
      );
    }

    // Fallback path: load all chunks for the org and cosine-score in JS.
    // Fine until ~10k chunks; fast path takes over after that.
    const all = await this.chunksRepo.find({
      where: { organizationId },
      take: 5000,
    });
    const scored = all
      .map((row) => ({
        id: row.id,
        fileId: row.fileId,
        ordinal: row.ordinal,
        text: row.text,
        folderId: row.folderId,
        metadata: row.metadata,
        score: cosine(row.embedding, queryVector),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit * 3);

    return await this.filterByFolderAccess(
      scored,
      actorUserId,
      opts.folderId,
      limit,
    );
  }

  // ── Bootstrap ─────────────────────────────────────────────────────────

  /**
   * On boot, try to install pgvector and add a `vector(dim)` mirror
   * column. If the extension isn't permitted (e.g. unprivileged DB),
   * we silently fall back to JS-side cosine — the feature still works,
   * just slower.
   */
  private async ensurePgVector() {
    const dim = this.embeddings.dimensions;
    try {
      await this.dataSource.query(`CREATE EXTENSION IF NOT EXISTS vector`);
      await this.dataSource.query(
        `ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS embedding_vec vector(${dim})`,
      );
      // HNSW gives the best speed/recall trade-off on modern pgvector.
      await this.dataSource.query(
        `CREATE INDEX IF NOT EXISTS document_chunks_embedding_vec_hnsw
         ON document_chunks USING hnsw (embedding_vec vector_cosine_ops)`,
      );
      this.vectorColumnReady = true;
      this.logger.log(`pgvector ready (dim=${dim})`);
    } catch (err) {
      this.logger.warn(
        `pgvector bootstrap failed; falling back to JS cosine. ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      this.vectorColumnReady = false;
    }
  }

  /** Drop chunks the caller can't actually read because of folder ACLs. */
  private async filterByFolderAccess<
    T extends { fileId: string; folderId: string | null },
  >(
    rows: T[],
    actorUserId: string,
    folderFilter: string | null | undefined,
    limit: number,
  ): Promise<T[]> {
    const out: T[] = [];
    const filenameByFile = await this.loadFilenames(rows.map((r) => r.fileId));
    for (const row of rows) {
      if (folderFilter && row.folderId !== folderFilter) continue;
      if (row.folderId) {
        const perm = await this.foldersService.effectivePermission(
          row.folderId,
          actorUserId,
        );
        if (!perm) continue;
      }
      out.push({ ...row, filename: filenameByFile.get(row.fileId) ?? '' });
      if (out.length >= limit) break;
    }
    return out;
  }

  private async loadFilenames(fileIds: string[]) {
    const map = new Map<string, string>();
    if (fileIds.length === 0) return map;
    const rows = await this.dataSource.query(
      `SELECT id, filename FROM files WHERE id = ANY($1::uuid[])`,
      [Array.from(new Set(fileIds))],
    );
    for (const r of rows as Array<{ id: string; filename: string }>) {
      map.set(r.id, r.filename);
    }
    return map;
  }
}

/** Greedy chunker: split on paragraph boundaries up to ~`approxTokens` words. */
function chunkText(text: string, approxTokens: number): string[] {
  const paragraphs = text
    .split(/\n{2,}|\r\n\r\n/g)
    .map((p) => p.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  let current = '';
  let currentLen = 0;
  for (const para of paragraphs) {
    const wc = para.split(/\s+/).length;
    if (currentLen + wc > approxTokens && current) {
      chunks.push(current.trim());
      current = '';
      currentLen = 0;
    }
    current += (current ? '\n\n' : '') + para;
    currentLen += wc;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.length > 0 ? chunks : [text.slice(0, 8000)];
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let aNorm = 0;
  let bNorm = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    aNorm += a[i] * a[i];
    bNorm += b[i] * b[i];
  }
  const denom = Math.sqrt(aNorm) * Math.sqrt(bNorm);
  return denom === 0 ? 0 : dot / denom;
}
