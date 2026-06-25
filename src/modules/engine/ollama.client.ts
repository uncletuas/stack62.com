import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AnthropicTool } from './anthropic.client';

/**
 * Thin client for a locally-hosted Ollama instance. Supports two call shapes:
 *
 *   - `complete(...)` — plain chat completion (text in, text out). Used for
 *     the small intent classifier and Tier-1 tool selection JSON answers.
 *
 *   - `completeWithTools(...)` — tool-calling shim. We don't use Ollama's
 *     native `tools` field (Llama 3.x supports it, but the schemas are noisy
 *     across model versions). Instead we instruct the model to emit a single
 *     JSON object describing one optional tool call and a final user-facing
 *     text. The engine parses that and dispatches accordingly.
 *
 * Connection is configured via `OLLAMA_BASE_URL` (default
 * http://localhost:11434) and `OLLAMA_MODEL` (default `llama3.1`). When
 * Ollama isn't reachable, callers fall back to higher tiers — the classifier
 * never blocks chat.
 */

export interface OllamaToolPlan {
  /** Optional tool call. If null, no tool action is needed. */
  tool: { name: string; input: Record<string, unknown> } | null;
  /** Final user-visible reply (always present). */
  reply: string;
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

const DEFAULT_BASE_URL = 'http://localhost:11434';
const DEFAULT_MODEL = 'llama3.1';
const DEFAULT_TIMEOUT_MS = 30_000;

@Injectable()
export class OllamaClient {
  private readonly logger = new Logger(OllamaClient.name);
  private healthCheckedAt = 0;
  private healthy = false;

  constructor(private readonly configService: ConfigService) {}

  baseUrl(): string {
    // Self-hosted endpoint (vLLM / TGI / Together / etc) wins over a
    // local Ollama box. Both are fine — the API shape is selected via
    // mode() below.
    return (
      this.configService.get<string>('SELF_HOSTED_LLM_URL') ||
      this.configService.get<string>('OLLAMA_BASE_URL') ||
      DEFAULT_BASE_URL
    );
  }

  model(): string {
    return (
      this.configService.get<string>('SELF_HOSTED_LLM_MODEL') ||
      this.configService.get<string>('OLLAMA_MODEL') ||
      DEFAULT_MODEL
    );
  }

  /** "openai" → vLLM / TGI / OpenRouter-compatible. "ollama" → native Ollama. */
  private mode(): 'openai' | 'ollama' {
    if (this.configService.get<string>('SELF_HOSTED_LLM_URL')) return 'openai';
    return 'ollama';
  }

  private apiKey(): string | undefined {
    return (
      this.configService.get<string>('SELF_HOSTED_LLM_API_KEY') || undefined
    );
  }

  /**
   * Returns true if Ollama answers `/api/tags` within 1.5 seconds. Cached
   * for 15s so chat hot-path doesn't re-probe on every request.
   */
  async isAvailable(): Promise<boolean> {
    const now = Date.now();
    if (now - this.healthCheckedAt < 15_000) return this.healthy;
    this.healthCheckedAt = now;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1500);
    const probePath = this.mode() === 'openai' ? '/v1/models' : '/api/tags';
    const headers: Record<string, string> = {};
    const key = this.apiKey();
    if (key) headers.Authorization = `Bearer ${key}`;
    try {
      const res = await fetch(`${this.baseUrl()}${probePath}`, {
        signal: ctrl.signal,
        headers,
      });
      this.healthy = res.ok;
    } catch {
      this.healthy = false;
    } finally {
      clearTimeout(t);
    }
    return this.healthy;
  }

  async complete(
    messages: ChatMessage[],
    opts?: { json?: boolean },
  ): Promise<string> {
    const mode = this.mode();
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), DEFAULT_TIMEOUT_MS);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    const key = this.apiKey();
    if (key) headers.Authorization = `Bearer ${key}`;

    try {
      if (mode === 'openai') {
        const body: Record<string, unknown> = {
          model: this.model(),
          messages,
          stream: false,
        };
        if (opts?.json) {
          body.response_format = { type: 'json_object' };
        }
        const res = await fetch(`${this.baseUrl()}/v1/chat/completions`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(
            `Self-hosted LLM ${res.status}: ${text || res.statusText}`,
          );
        }
        const data = (await res.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        return data.choices?.[0]?.message?.content ?? '';
      }

      const body: Record<string, unknown> = {
        model: this.model(),
        messages,
        stream: false,
      };
      if (opts?.json) body.format = 'json';
      const res = await fetch(`${this.baseUrl()}/api/chat`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Ollama ${res.status}: ${text || res.statusText}`);
      }
      const data = (await res.json()) as { message?: { content?: string } };
      return data.message?.content ?? '';
    } finally {
      clearTimeout(t);
    }
  }

  /**
   * Run a small-model agent loop with the supplied tool catalog. The model is
   * coached to respond as a single JSON object describing one tool call OR a
   * direct reply. The engine handles the dispatch loop — this client returns
   * one decision per call.
   */
  async planToolCall(input: {
    system: string;
    history: ChatMessage[];
    prompt: string;
    tools: AnthropicTool[];
  }): Promise<OllamaToolPlan> {
    const toolCatalog = input.tools
      .map(
        (t) =>
          `- ${t.name}: ${t.description}\n  schema: ${JSON.stringify(
            t.input_schema,
          )}`,
      )
      .join('\n');

    const guidance = [
      input.system,
      '',
      'You are operating inside Stack62 as a small local model. You can either:',
      '1. Pick ONE tool to run from the catalog below, OR',
      '2. Answer directly when no tool is needed.',
      '',
      'Reply with ONLY a JSON object in this exact shape:',
      '{ "tool": { "name": "<tool>", "input": { ... } } | null, "reply": "<user-visible text>" }',
      'If you do not know which tool fits, set "tool" to null and ask the user.',
      'Do NOT invent tools. Use only names from the catalog.',
      '',
      'Available tools:',
      toolCatalog || '(no tools available)',
    ].join('\n');

    const messages: ChatMessage[] = [
      { role: 'system', content: guidance },
      ...input.history,
      { role: 'user', content: input.prompt },
    ];

    const raw = await this.complete(messages, { json: true });
    return this.parsePlan(raw);
  }

  private parsePlan(raw: string): OllamaToolPlan {
    const fallback: OllamaToolPlan = {
      tool: null,
      reply: raw.trim() || 'Sorry, I could not parse that.',
    };
    if (!raw) return fallback;
    const trimmed = raw.trim();
    // Strip code fences if present.
    const stripped = trimmed
      .replace(/^```(?:json)?/i, '')
      .replace(/```$/i, '')
      .trim();
    try {
      const data = JSON.parse(stripped) as OllamaToolPlan;
      if (typeof data.reply !== 'string') data.reply = '';
      if (
        data.tool &&
        (typeof data.tool !== 'object' ||
          typeof (data.tool as { name?: unknown }).name !== 'string')
      ) {
        data.tool = null;
      }
      if (data.tool && !data.tool.input) data.tool.input = {};
      return data;
    } catch {
      this.logger.warn(
        `Ollama returned non-JSON tool plan: ${stripped.slice(0, 200)}`,
      );
      return fallback;
    }
  }
}
