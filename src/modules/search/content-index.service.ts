import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ContentChunkEntity, ContentChunkSourceType } from './entities/content-chunk.entity';

export interface IndexContentInput {
  organizationId: string;
  workspaceId?: string | null;
  systemId?: string | null;
  sourceType: ContentChunkSourceType;
  sourceId: string;
  sourceTitle: string;
  text: string;
  metadata?: Record<string, unknown> | null;
}

const EMBEDDING_DIM = 128;
const CHUNK_SIZE = 1200;
const CHUNK_OVERLAP = 180;

@Injectable()
export class ContentIndexService {
  constructor(
    @InjectRepository(ContentChunkEntity)
    private readonly chunksRepository: Repository<ContentChunkEntity>,
  ) {}

  async index(input: IndexContentInput) {
    const clean = normalizeText(input.text);
    await this.chunksRepository.delete({
      sourceType: input.sourceType,
      sourceId: input.sourceId,
    });
    if (!clean) return [];

    const chunks = splitIntoChunks(clean);
    const rows = chunks.map((content, index) =>
      this.chunksRepository.create({
        organizationId: input.organizationId,
        workspaceId: input.workspaceId ?? null,
        systemId: input.systemId ?? null,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        sourceTitle: input.sourceTitle,
        chunkIndex: index,
        content,
        embedding: embedText(content),
        metadata: input.metadata ?? null,
      }),
    );
    return this.chunksRepository.save(rows);
  }

  async search(input: {
    organizationId: string;
    workspaceId?: string | null;
    systemId?: string | null;
    query: string;
    limit?: number;
  }) {
    const qb = this.chunksRepository.createQueryBuilder('chunk');
    qb.where('chunk.organizationId = :organizationId', {
      organizationId: input.organizationId,
    });
    if (input.workspaceId) {
      qb.andWhere('chunk.workspaceId = :workspaceId', {
        workspaceId: input.workspaceId,
      });
    }
    if (input.systemId) {
      qb.andWhere('chunk.systemId = :systemId', { systemId: input.systemId });
    }

    const rows = await qb.orderBy('chunk.updatedAt', 'DESC').take(1500).getMany();
    const qEmbedding = embedText(input.query);
    const qTokens = tokenize(input.query);

    return rows
      .map((row) => ({
        row,
        score:
          cosine(qEmbedding, row.embedding ?? []) +
          keywordScore(qTokens, row.content),
      }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, input.limit ?? 12)
      .map((item) => ({
        id: item.row.id,
        sourceType: item.row.sourceType,
        sourceId: item.row.sourceId,
        sourceTitle: item.row.sourceTitle,
        chunkIndex: item.row.chunkIndex,
        content: item.row.content,
        score: Number(item.score.toFixed(4)),
        metadata: item.row.metadata,
      }));
  }
}

export function normalizeText(text: string) {
  return text.replace(/\u0000/g, '').replace(/[ \t]+/g, ' ').trim();
}

function splitIntoChunks(text: string) {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(text.length, start + CHUNK_SIZE);
    chunks.push(text.slice(start, end).trim());
    if (end >= text.length) break;
    start = Math.max(0, end - CHUNK_OVERLAP);
  }
  return chunks.filter(Boolean);
}

function embedText(text: string) {
  const vector = Array.from({ length: EMBEDDING_DIM }, () => 0);
  for (const token of tokenize(text)) {
    const index = hashToken(token) % EMBEDDING_DIM;
    vector[index] += 1;
  }
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => Number((value / magnitude).toFixed(6)));
}

function tokenize(text: string) {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((token) => token.length > 2);
}

function hashToken(token: string) {
  let hash = 2166136261;
  for (let i = 0; i < token.length; i += 1) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

function cosine(a: number[], b: number[]) {
  if (a.length === 0 || b.length === 0) return 0;
  let dot = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    dot += a[i] * b[i];
  }
  return dot;
}

function keywordScore(tokens: string[], content: string) {
  const haystack = content.toLowerCase();
  if (tokens.length === 0) return 0;
  const hits = tokens.filter((token) => haystack.includes(token)).length;
  return hits / tokens.length;
}
