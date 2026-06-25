import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CodexService } from '../ai/codex.service';

export interface AnthropicTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | {
      type: 'tool_use';
      id: string;
      name: string;
      input: Record<string, unknown>;
    }
  | {
      type: 'tool_result';
      tool_use_id: string;
      content: string;
      is_error?: boolean;
    };

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

export interface AnthropicCompletion {
  id: string;
  role: 'assistant';
  model: string;
  content: AnthropicContentBlock[];
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence';
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

interface CompletionRequest {
  system?: string;
  messages: AnthropicMessage[];
  tools?: AnthropicTool[];
  maxTokens?: number;
  temperature?: number;
  model?: string;
  apiKey?: string | null;
}

interface FetchAttempt {
  url: string;
  body: Record<string, unknown>;
  headers: Record<string, string>;
  label: 'anthropic' | 'openrouter';
}

const MAX_RETRIES = 2;
const TIMEOUT_MS = 60_000;
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

@Injectable()
export class AnthropicClient {
  private readonly logger = new Logger(AnthropicClient.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly codexService: CodexService,
  ) {}

  isConfigured(): boolean {
    return Boolean(
      this.configService.get<string>('ANTHROPIC_API_KEY') ||
      this.configService.get<string>('OPENROUTER_API_KEY'),
    );
  }

  resolveModel(model?: string | null): string {
    return (
      model ||
      this.configService.get<string>('STACK62_ENGINE_MODEL') ||
      'claude-sonnet-4-5'
    );
  }

  async complete(req: CompletionRequest): Promise<AnthropicCompletion> {
    const codexModel = CodexService.parseModel(this.resolveModel(req.model));
    if (codexModel !== null) {
      return this.completeViaCodex(req, codexModel);
    }

    const directKey =
      req.apiKey || this.configService.get<string>('ANTHROPIC_API_KEY') || null;

    if (directKey) {
      return this.completeViaAnthropic(req, directKey);
    }
    const orKey = this.configService.get<string>('OPENROUTER_API_KEY');
    if (orKey) {
      return this.completeViaOpenRouter(req, orKey);
    }
    throw new BadRequestException(
      'No AI provider configured. Set ANTHROPIC_API_KEY or OPENROUTER_API_KEY.',
    );
  }

  private async completeViaCodex(
    req: CompletionRequest,
    model: string | null,
  ): Promise<AnthropicCompletion> {
    const messages: Array<{
      role: 'user' | 'assistant' | 'system';
      content: string;
    }> = [];
    if (req.system) {
      messages.push({
        role: 'system',
        content: [
          req.system,
          req.tools?.length
            ? 'Stack62 tools are available in the production API engine. In this Codex test bridge, answer with the best final response you can. Do not invent completed tool actions.'
            : '',
        ]
          .filter(Boolean)
          .join('\n\n'),
      });
    }
    for (const message of req.messages) {
      messages.push({
        role: message.role,
        content: stringifyMessageContent(message.content),
      });
    }

    const text = await this.codexService.complete(messages, model);
    return {
      id: `codex-${Date.now().toString(36)}`,
      role: 'assistant',
      model: `codex:${model ?? 'default'}`,
      content: [{ type: 'text', text }],
      stop_reason: 'end_turn',
    };
  }

  private async completeViaAnthropic(
    req: CompletionRequest,
    apiKey: string,
  ): Promise<AnthropicCompletion> {
    return this.fetchWithRetry({
      url: 'https://api.anthropic.com/v1/messages',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: this.buildBody(req),
      label: 'anthropic',
    });
  }

  private async completeViaOpenRouter(
    req: CompletionRequest,
    apiKey: string,
  ): Promise<AnthropicCompletion> {
    const model = this.resolveModel(req.model);
    const slug = model.startsWith('anthropic/') ? model : `anthropic/${model}`;
    return this.fetchWithRetry({
      url: 'https://openrouter.ai/api/v1/messages',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://stack62.app',
        'X-Title': 'Stack62 Engine',
        'anthropic-version': '2023-06-01',
      },
      body: { ...this.buildBody(req), model: slug },
      label: 'openrouter',
    });
  }

  private buildBody(req: CompletionRequest): Record<string, unknown> {
    const envMax = Number(
      this.configService.get<string>('STACK62_ENGINE_MAX_TOKENS') ?? '',
    );
    const body: Record<string, unknown> = {
      model: this.resolveModel(req.model),
      max_tokens:
        req.maxTokens ?? (Number.isFinite(envMax) && envMax > 0 ? envMax : 512),
      messages: req.messages,
    };
    if (req.system) body.system = req.system;
    if (req.tools && req.tools.length) body.tools = req.tools;
    if (typeof req.temperature === 'number') body.temperature = req.temperature;
    return body;
  }

  private async fetchWithRetry(
    attempt: FetchAttempt,
  ): Promise<AnthropicCompletion> {
    let lastError: Error | null = null;
    for (let i = 0; i <= MAX_RETRIES; i++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const res = await fetch(attempt.url, {
          method: 'POST',
          headers: attempt.headers,
          body: JSON.stringify(attempt.body),
          signal: controller.signal,
        });
        clearTimeout(timer);
        const text = await res.text();
        let data: unknown;
        try {
          data = text ? JSON.parse(text) : null;
        } catch {
          data = text;
        }
        if (!res.ok) {
          if (RETRYABLE_STATUS.has(res.status) && i < MAX_RETRIES) {
            const delay = backoff(i);
            this.logger.warn(
              `${attempt.label} ${res.status} (retry ${i + 1}/${MAX_RETRIES} in ${delay}ms)`,
            );
            await sleep(delay);
            continue;
          }
          this.logger.error(
            `${attempt.label} ${res.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`,
          );
          const message =
            (data && typeof data === 'object' && 'error' in data
              ? (data as { error?: { message?: string } }).error?.message
              : null) ?? `${attempt.label} ${res.status} ${res.statusText}`;
          throw new BadRequestException(message);
        }
        return data as AnthropicCompletion;
      } catch (err) {
        clearTimeout(timer);
        if (err instanceof BadRequestException) throw err;
        lastError = err instanceof Error ? err : new Error(String(err));
        const cause = (lastError as Error & { cause?: unknown }).cause;
        const isAbort = lastError.name === 'AbortError';
        const isNetwork =
          lastError.message?.includes('fetch failed') ||
          lastError.message?.includes('ECONNRESET') ||
          isAbort;
        if (isNetwork && i < MAX_RETRIES) {
          const delay = backoff(i);
          this.logger.warn(
            `${attempt.label} ${isAbort ? 'timeout' : 'network'} (retry ${i + 1}/${MAX_RETRIES} in ${delay}ms)`,
          );
          await sleep(delay);
          continue;
        }
        this.logger.error(
          `${attempt.label} fetch failed: ${lastError.message}${
            cause
              ? ` (cause: ${typeof cause === 'object' ? JSON.stringify(cause, Object.getOwnPropertyNames(cause)) : String(cause)})`
              : ''
          }`,
        );
        throw new BadRequestException(
          `Could not reach ${attempt.label}: ${lastError.message}`,
        );
      }
    }
    throw new BadRequestException(
      `Could not reach ${attempt.label}: ${lastError?.message ?? 'unknown error'}`,
    );
  }
}

function backoff(attempt: number): number {
  return Math.min(2_000, 250 * 2 ** attempt) + Math.floor(Math.random() * 100);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stringifyMessageContent(
  content: string | AnthropicContentBlock[],
): string {
  if (typeof content === 'string') return content;
  return content
    .map((block) => {
      if (block.type === 'text') return block.text;
      if (block.type === 'tool_use') {
        return `[tool call: ${block.name} ${JSON.stringify(block.input)}]`;
      }
      return `[tool result: ${block.content}]`;
    })
    .join('\n');
}
