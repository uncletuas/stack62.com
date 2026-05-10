import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Embedding provider abstraction. Default uses OpenAI's
 * text-embedding-3-small via OpenRouter (cheapest production-grade
 * embedding API), but a custom OPENAI_EMBEDDING_BASE_URL can route to
 * any OpenAI-compatible endpoint (Ollama with `nomic-embed-text`, etc.)
 *
 * Required env (one of):
 *   - OPENROUTER_API_KEY (uses OpenRouter's /embeddings — auto)
 *   - OPENAI_API_KEY      (uses OpenAI directly — set OPENAI_EMBEDDING_BASE_URL=https://api.openai.com/v1)
 *
 * Optional env:
 *   - EMBEDDING_MODEL              (default: openai/text-embedding-3-small)
 *   - EMBEDDING_DIMENSIONS         (default: 1536)
 *   - OPENAI_EMBEDDING_BASE_URL    (default: https://openrouter.ai/api/v1)
 */
@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);

  constructor(private readonly configService: ConfigService) {}

  get dimensions(): number {
    return Number(this.configService.get('EMBEDDING_DIMENSIONS') || 1536);
  }

  isConfigured(): boolean {
    return Boolean(
      this.configService.get<string>('OPENROUTER_API_KEY') ||
        this.configService.get<string>('OPENAI_API_KEY'),
    );
  }

  /**
   * Embed a list of strings in one call. Falls back to a deterministic
   * hash-based pseudo-embedding when no API key is configured — that
   * keeps the search code path running for dev/CI but obviously gives
   * useless similarity. The fake never hits production because we
   * gate semantic-search routes on isConfigured().
   */
  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    if (!this.isConfigured()) {
      this.logger.warn(
        'Embeddings requested without an API key. Returning deterministic hash vectors (search will not be meaningful).',
      );
      return texts.map((t) => this.hashVector(t));
    }

    const apiKey =
      this.configService.get<string>('OPENROUTER_API_KEY') ||
      this.configService.get<string>('OPENAI_API_KEY');
    if (!apiKey) {
      throw new ServiceUnavailableException('No embedding provider configured.');
    }

    const baseUrl =
      this.configService.get<string>('OPENAI_EMBEDDING_BASE_URL') ||
      'https://openrouter.ai/api/v1';
    const model =
      this.configService.get<string>('EMBEDDING_MODEL') ||
      'openai/text-embedding-3-small';

    const response = await fetch(`${baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer':
          this.configService.get<string>('OPENROUTER_HTTP_REFERER') ||
          'https://stack62.com',
        'X-Title': 'Stack62 Embeddings',
      },
      body: JSON.stringify({
        model,
        input: texts,
      }),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      this.logger.error(`Embeddings call failed: ${text}`);
      throw new Error(`Embeddings call failed: ${response.status}`);
    }
    const json = (await response.json()) as {
      data?: Array<{ embedding: number[] }>;
    };
    const out = (json.data ?? []).map((d) => d.embedding);
    if (out.length !== texts.length) {
      throw new Error(
        `Embedding count mismatch: requested ${texts.length}, got ${out.length}.`,
      );
    }
    return out;
  }

  /**
   * Trivial deterministic vector for dev when no API key is set. Not a
   * real embedding — just a hash spread across `dimensions` floats so
   * search code can run without crashing.
   */
  private hashVector(text: string): number[] {
    const dims = this.dimensions;
    const out = new Array<number>(dims).fill(0);
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
      out[Math.abs(hash) % dims] += 1;
    }
    // Normalize so cosine works.
    const norm = Math.sqrt(out.reduce((s, v) => s + v * v, 0)) || 1;
    return out.map((v) => v / norm);
  }
}
