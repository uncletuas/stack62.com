import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { EmbeddingService } from '../semantic-search/embedding.service';
import { AiResponseCacheEntity } from './entities/ai-response-cache.entity';

export interface CacheableReply {
  kind: 'reply';
  reply: string;
}

export interface CacheableTool {
  kind: 'tool';
  toolName: string;
  toolInput: Record<string, unknown>;
}

export type CacheableResult = CacheableReply | CacheableTool;

export interface CacheHit {
  result: CacheableResult;
  score: number;
  source: 'exact' | 'semantic';
}

/**
 * Semantic response/intent cache. Sits in front of the paid frontier tier:
 * before escalating, the engine asks the cache whether a prior *local* or
 * read-only resolution of a near-identical prompt exists for this org. A hit
 * replays at $0.
 *
 * Embeddings come from the local model (self-hosted Ollama by default), so a
 * cache lookup costs nothing but a local vector call — far cheaper than a
 * frontier completion.
 */
@Injectable()
export class ResponseCacheService {
  private readonly logger = new Logger(ResponseCacheService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly embeddings: EmbeddingService,
    @InjectRepository(AiResponseCacheEntity)
    private readonly cacheRepo: Repository<AiResponseCacheEntity>,
  ) {}

  private enabled(): boolean {
    return (
      this.configService.get<string>('AI_RESPONSE_CACHE_ENABLED') !== 'false' &&
      this.configService.get<string>('AI_RESPONSE_CACHE_ENABLED') !== '0'
    );
  }

  private threshold(): number {
    const raw = Number(
      this.configService.get('AI_RESPONSE_CACHE_THRESHOLD') ?? 0.92,
    );
    return Number.isFinite(raw) ? raw : 0.92;
  }

  private ttlHours(): number {
    const raw = Number(
      this.configService.get('AI_RESPONSE_CACHE_TTL_HOURS') ?? 168,
    );
    return Number.isFinite(raw) && raw > 0 ? raw : 168;
  }

  /**
   * Look up a near-identical prior resolution. Returns null on miss, when the
   * cache is disabled, or when embeddings aren't configured (the local model
   * is unreachable). Never throws — the engine treats a failure as a miss.
   */
  async lookup(
    organizationId: string,
    workspaceId: string | null,
    prompt: string,
  ): Promise<CacheHit | null> {
    if (!this.enabled()) return null;
    const normalized = normalizePrompt(prompt);
    if (!normalized) return null;

    try {
      // Exact-match fast path — no embedding needed.
      const hash = hashPrompt(normalized);
      const now = new Date();
      const exact = await this.cacheRepo.findOne({
        where: { organizationId, promptHash: hash },
      });
      if (exact && exact.expiresAt > now) {
        await this.bumpHit(exact.id);
        return { result: toResult(exact), score: 1, source: 'exact' };
      }

      // Semantic path — embed locally and cosine-search the org's cache.
      if (!this.embeddings.isConfigured()) return null;
      const [vector] = await this.embeddings.embed([normalized]);
      if (!vector) return null;

      const rows = await this.cacheRepo.find({
        where: { organizationId },
        order: { updatedAt: 'DESC' },
        take: 500,
      });
      let best: { row: AiResponseCacheEntity; score: number } | null = null;
      for (const row of rows) {
        if (row.expiresAt <= now) continue;
        const score = cosine(vector, row.embedding);
        if (!best || score > best.score) best = { row, score };
      }
      if (best && best.score >= this.threshold()) {
        await this.bumpHit(best.row.id);
        return {
          result: toResult(best.row),
          score: best.score,
          source: 'semantic',
        };
      }
      return null;
    } catch (err) {
      this.logger.warn(
        `Response-cache lookup failed (treating as miss): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
  }

  /**
   * Persist a safe-to-replay resolution. Upserts on the normalized hash so a
   * prompt asked repeatedly keeps one row. Best-effort — never throws into the
   * hot path.
   */
  async store(
    organizationId: string,
    workspaceId: string | null,
    prompt: string,
    result: CacheableResult,
  ): Promise<void> {
    if (!this.enabled()) return;
    const normalized = normalizePrompt(prompt);
    if (!normalized) return;

    try {
      if (!this.embeddings.isConfigured()) return;
      const [vector] = await this.embeddings.embed([normalized]);
      if (!vector) return;

      const hash = hashPrompt(normalized);
      const expiresAt = new Date(Date.now() + this.ttlHours() * 3600 * 1000);
      const existing = await this.cacheRepo.findOne({
        where: { organizationId, promptHash: hash },
      });
      const row = this.cacheRepo.create({
        organizationId,
        workspaceId: workspaceId ?? null,
        promptHash: hash,
        promptText: normalized,
        embedding: vector,
        kind: result.kind,
        reply: result.kind === 'reply' ? result.reply : null,
        toolName: result.kind === 'tool' ? result.toolName : null,
        toolInput: result.kind === 'tool' ? result.toolInput : null,
        expiresAt,
      });
      // save() upserts by primary key — reuse the existing row's id so a
      // repeated prompt keeps a single cache entry.
      if (existing) row.id = existing.id;
      await this.cacheRepo.save(row);
    } catch (err) {
      this.logger.warn(
        `Response-cache store failed (ignored): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /** Drop the org's cache — call when underlying data changes materially. */
  async invalidateOrg(organizationId: string): Promise<void> {
    await this.cacheRepo.delete({ organizationId }).catch(() => undefined);
  }

  /** Lightweight stats for an org — entries cached and total replay hits. */
  async stats(
    organizationId: string,
  ): Promise<{ entries: number; totalHits: number }> {
    const rows = await this.cacheRepo.find({
      where: { organizationId },
      select: { hitCount: true },
    });
    return {
      entries: rows.length,
      totalHits: rows.reduce((sum, r) => sum + (r.hitCount ?? 0), 0),
    };
  }

  /** Housekeeping: remove expired rows. Safe to call on a timer. */
  async purgeExpired(): Promise<number> {
    const res = await this.cacheRepo
      .delete({ expiresAt: LessThan(new Date()) })
      .catch(() => ({ affected: 0 }));
    return res.affected ?? 0;
  }

  private async bumpHit(id: string): Promise<void> {
    await this.cacheRepo
      .increment({ id }, 'hitCount', 1)
      .catch(() => undefined);
  }
}

function toResult(row: AiResponseCacheEntity): CacheableResult {
  if (row.kind === 'tool' && row.toolName) {
    return {
      kind: 'tool',
      toolName: row.toolName,
      toolInput: row.toolInput ?? {},
    };
  }
  return { kind: 'reply', reply: row.reply ?? '' };
}

function normalizePrompt(prompt: string): string {
  return prompt.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 4000);
}

function hashPrompt(normalized: string): string {
  return createHash('sha256').update(normalized).digest('hex').slice(0, 64);
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
