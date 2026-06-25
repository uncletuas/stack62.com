import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  AnthropicCompletion,
  AnthropicContentBlock,
  AnthropicMessage,
  AnthropicTool,
} from '../anthropic.client';

export interface LlmCompletionRequest {
  system?: string;
  messages: AnthropicMessage[];
  tools?: AnthropicTool[];
  maxTokens?: number;
  temperature?: number;
  model?: string;
  apiKey?: string | null;
}

interface OpenAiToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface OpenAiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: OpenAiToolCall[];
  tool_call_id?: string;
}

const TIMEOUT_MS = 60_000;
const MAX_RETRIES = 2;
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

/**
 * OpenAI Chat Completions adapter that speaks the same in/out shape as
 * AnthropicClient (AnthropicCompletion with text + tool_use blocks). This lets
 * the engine's agentic tool-loop run on OpenAI without changing the loop: it
 * translates Anthropic-style messages/tools to OpenAI's function-calling format
 * on the way in, and normalizes the response back on the way out.
 */
@Injectable()
export class OpenAiAdapter {
  private readonly logger = new Logger(OpenAiAdapter.name);

  constructor(private readonly configService: ConfigService) {}

  isConfigured(): boolean {
    return Boolean(this.configService.get<string>('OPENAI_API_KEY'));
  }

  resolveModel(model?: string | null): string {
    return model || this.configService.get<string>('OPENAI_MODEL') || 'gpt-4o';
  }

  async complete(req: LlmCompletionRequest): Promise<AnthropicCompletion> {
    const apiKey =
      req.apiKey || this.configService.get<string>('OPENAI_API_KEY');
    if (!apiKey) {
      throw new BadRequestException('OPENAI_API_KEY is not configured.');
    }
    const baseUrl = this.configService
      .get<string>('OPENAI_BASE_URL', 'https://api.openai.com/v1')
      .replace(/\/$/, '');
    const model = this.resolveModel(req.model);

    const messages = this.toOpenAiMessages(req.system, req.messages);
    const body: Record<string, unknown> = {
      model,
      messages,
      max_tokens: req.maxTokens ?? this.defaultMaxTokens(),
    };
    if (typeof req.temperature === 'number') body.temperature = req.temperature;
    if (req.tools?.length) {
      body.tools = req.tools.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.input_schema,
        },
      }));
      body.tool_choice = 'auto';
    }

    const data = await this.fetchWithRetry(
      `${baseUrl}/chat/completions`,
      apiKey,
      body,
    );
    return this.fromOpenAiResponse(data, model);
  }

  private defaultMaxTokens(): number {
    const envMax = Number(
      this.configService.get<string>('STACK62_ENGINE_MAX_TOKENS') ?? '',
    );
    return Number.isFinite(envMax) && envMax > 0 ? envMax : 1024;
  }

  /** Translate Anthropic-style messages into OpenAI chat messages. */
  private toOpenAiMessages(
    system: string | undefined,
    messages: AnthropicMessage[],
  ): OpenAiMessage[] {
    const out: OpenAiMessage[] = [];
    if (system) out.push({ role: 'system', content: system });

    for (const msg of messages) {
      if (typeof msg.content === 'string') {
        out.push({ role: msg.role, content: msg.content });
        continue;
      }

      if (msg.role === 'assistant') {
        const text = msg.content
          .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
          .map((b) => b.text)
          .join('\n');
        const toolCalls: OpenAiToolCall[] = msg.content
          .filter(
            (
              b,
            ): b is {
              type: 'tool_use';
              id: string;
              name: string;
              input: Record<string, unknown>;
            } => b.type === 'tool_use',
          )
          .map((b) => ({
            id: b.id,
            type: 'function',
            function: {
              name: b.name,
              arguments: JSON.stringify(b.input ?? {}),
            },
          }));
        out.push({
          role: 'assistant',
          content: text || null,
          ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
        });
        continue;
      }

      // role === 'user': may carry tool_result blocks (one OpenAI 'tool'
      // message each) and/or plain text.
      const toolResults = msg.content.filter(
        (
          b,
        ): b is {
          type: 'tool_result';
          tool_use_id: string;
          content: string;
          is_error?: boolean;
        } => b.type === 'tool_result',
      );
      for (const tr of toolResults) {
        out.push({
          role: 'tool',
          tool_call_id: tr.tool_use_id,
          content:
            typeof tr.content === 'string'
              ? tr.content
              : JSON.stringify(tr.content),
        });
      }
      const text = msg.content
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
        .map((b) => b.text)
        .join('\n');
      if (text) out.push({ role: 'user', content: text });
    }
    return out;
  }

  /** Normalize an OpenAI response back into AnthropicCompletion shape. */
  private fromOpenAiResponse(
    data: unknown,
    model: string,
  ): AnthropicCompletion {
    const d = data as {
      id?: string;
      choices?: Array<{
        message?: {
          content?: string | null;
          tool_calls?: OpenAiToolCall[];
        };
        finish_reason?: string;
      }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const choice = d.choices?.[0];
    const message = choice?.message;
    const content: AnthropicContentBlock[] = [];
    if (message?.content) {
      content.push({ type: 'text', text: message.content });
    }
    for (const call of message?.tool_calls ?? []) {
      let input: Record<string, unknown> = {};
      try {
        input = call.function.arguments
          ? (JSON.parse(call.function.arguments) as Record<string, unknown>)
          : {};
      } catch {
        input = {};
      }
      content.push({
        type: 'tool_use',
        id: call.id,
        name: call.function.name,
        input,
      });
    }

    const hasToolUse = (message?.tool_calls?.length ?? 0) > 0;
    const stop_reason: AnthropicCompletion['stop_reason'] = hasToolUse
      ? 'tool_use'
      : mapFinishReason(choice?.finish_reason);

    return {
      id: d.id ?? `openai-${Date.now().toString(36)}`,
      role: 'assistant',
      model,
      content: content.length ? content : [{ type: 'text', text: '' }],
      stop_reason,
      usage: d.usage
        ? {
            input_tokens: d.usage.prompt_tokens ?? 0,
            output_tokens: d.usage.completion_tokens ?? 0,
          }
        : undefined,
    };
  }

  private async fetchWithRetry(
    url: string,
    apiKey: string,
    body: Record<string, unknown>,
  ): Promise<unknown> {
    let lastError: Error | null = null;
    for (let i = 0; i <= MAX_RETRIES; i++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        clearTimeout(timer);
        const text = await res.text();
        const data: unknown = text ? JSON.parse(text) : null;
        if (!res.ok) {
          // Quota exhaustion is permanent until the user upgrades — don't
          // retry, and never surface the raw OpenAI billing copy to users.
          if (isQuotaError(res.status, data)) {
            throw new BadRequestException(QUOTA_MESSAGE);
          }
          if (RETRYABLE_STATUS.has(res.status) && i < MAX_RETRIES) {
            await sleep(backoff(i));
            continue;
          }
          const msg =
            (data && typeof data === 'object' && 'error' in data
              ? (data as { error?: { message?: string } }).error?.message
              : null) ?? `OpenAI ${res.status} ${res.statusText}`;
          throw new BadRequestException(msg);
        }
        return data;
      } catch (err) {
        clearTimeout(timer);
        if (err instanceof BadRequestException) throw err;
        lastError = err instanceof Error ? err : new Error(String(err));
        const isAbort = lastError.name === 'AbortError';
        if (
          (isAbort || lastError.message?.includes('fetch failed')) &&
          i < MAX_RETRIES
        ) {
          await sleep(backoff(i));
          continue;
        }
        this.logger.error(`OpenAI fetch failed: ${lastError.message}`);
        throw new BadRequestException(
          `Could not reach OpenAI: ${lastError.message}`,
        );
      }
    }
    throw new BadRequestException(
      `Could not reach OpenAI: ${lastError?.message ?? 'unknown error'}`,
    );
  }
}

const QUOTA_MESSAGE =
  "You've hit your usage limit. Upgrade your plan to continue working.";

/**
 * Detect OpenAI quota-exhaustion responses (HTTP 429 with an
 * `insufficient_quota` error code/type, or the matching billing copy) so we can
 * show a friendly upgrade prompt instead of the raw provider message.
 */
function isQuotaError(status: number, data: unknown): boolean {
  if (status !== 429 && status !== 403) return false;
  if (!data || typeof data !== 'object' || !('error' in data)) return false;
  const error = (data as { error?: { code?: string; type?: string; message?: string } })
    .error;
  if (!error) return false;
  const code = (error.code ?? '').toLowerCase();
  const type = (error.type ?? '').toLowerCase();
  const message = (error.message ?? '').toLowerCase();
  return (
    code === 'insufficient_quota' ||
    type === 'insufficient_quota' ||
    message.includes('exceeded your current quota')
  );
}

function mapFinishReason(
  reason: string | undefined,
): AnthropicCompletion['stop_reason'] {
  switch (reason) {
    case 'length':
      return 'max_tokens';
    case 'tool_calls':
      return 'tool_use';
    case 'stop':
    default:
      return 'end_turn';
  }
}

function backoff(attempt: number): number {
  return Math.min(2_000, 250 * 2 ** attempt) + Math.floor(Math.random() * 100);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
