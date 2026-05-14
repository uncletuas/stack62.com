import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccessControlService } from '../../shared/access-control/access-control.service';

export interface StreamGenerationInput {
  organizationId: string;
  workspaceId?: string | null;
  systemId?: string | null;
  prompt: string;
  /** Affects the system prompt; UI uses it to pick the rendering surface. */
  outputKind: 'text' | 'markdown' | 'csv' | 'json' | 'code';
  /** Optional language hint for `code` outputs. */
  language?: string;
  /** Optional context — e.g. previous draft to revise. */
  priorContent?: string;
  /** Caller. Audit + access control. */
  actorUserId: string;
}

export type StreamGenerationEvent =
  | { type: 'started'; outputKind: StreamGenerationInput['outputKind'] }
  | { type: 'delta'; text: string }
  | { type: 'completed'; fullText: string; tokens: number }
  | { type: 'error'; message: string };

/**
 * Streaming document generation. Wraps OpenRouter chat-completions with
 * `stream: true` and re-emits delta tokens as Server-Sent Events.
 *
 * The Coworker uses this when the user asks for a document, spreadsheet,
 * email, or short snippet — the UI subscribes to the stream and types
 * the output into the editor in real time. Cosmetic but it makes the
 * AI feel native instead of "result appears after a wait."
 */
@Injectable()
export class StreamingGenerationService {
  private readonly logger = new Logger(StreamingGenerationService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly accessControl: AccessControlService,
  ) {}

  async *stream(
    input: StreamGenerationInput,
  ): AsyncGenerator<StreamGenerationEvent, void, void> {
    await this.accessControl.assertResolvedAccess(input.actorUserId, {
      resource: 'organization',
      action: 'read',
      organizationId: input.organizationId,
    });

    if (!input.prompt?.trim()) {
      throw new BadRequestException('Prompt is required.');
    }

    const apiKey = this.configService.get<string>('OPENROUTER_API_KEY');
    if (!apiKey) {
      throw new ServiceUnavailableException(
        'Streaming generation needs OPENROUTER_API_KEY.',
      );
    }
    const model =
      this.configService.get<string>('STREAM_GENERATION_MODEL') ||
      this.configService.get<string>('OPENROUTER_MODEL') ||
      'anthropic/claude-3.5-sonnet';

    yield { type: 'started', outputKind: input.outputKind };

    const systemPrompt = buildSystemPrompt(input);
    const userPrompt = input.priorContent
      ? `Revise the following:\n\n${input.priorContent}\n\nInstructions:\n${input.prompt}`
      : input.prompt;

    const body = JSON.stringify({
      model,
      stream: true,
      temperature: input.outputKind === 'json' ? 0 : 0.4,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });

    const response = await fetch(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer':
            this.configService.get<string>('OPENROUTER_HTTP_REFERER') ||
            'https://stack62.com',
          'X-Title': 'Stack62 Streaming Generation',
        },
        body,
      },
    );
    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => '');
      this.logger.error(`Streaming call failed: ${text}`);
      yield { type: 'error', message: `Provider error ${response.status}` };
      return;
    }

    let buffer = '';
    let fullText = '';
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // OpenRouter / OpenAI SSE: each `data:` line is a chunk. Some lines
        // are `:` keepalives — skip those.
        let nlIdx;
        while ((nlIdx = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nlIdx).trim();
          buffer = buffer.slice(nlIdx + 1);
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data) as {
              choices?: Array<{ delta?: { content?: string | null } }>;
            };
            const delta = parsed.choices?.[0]?.delta?.content;
            if (typeof delta === 'string' && delta.length > 0) {
              fullText += delta;
              yield { type: 'delta', text: delta };
            }
          } catch {
            /* malformed line — skip */
          }
        }
      }
    } catch (err) {
      yield {
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      };
      return;
    }

    yield {
      type: 'completed',
      fullText,
      tokens: Math.ceil(fullText.length / 4), // rough estimate
    };
  }
}

function buildSystemPrompt(input: StreamGenerationInput): string {
  switch (input.outputKind) {
    case 'markdown':
      return 'You produce well-formatted Markdown documents. Use headers, bullet lists, tables, and emphasis where appropriate. Do NOT wrap your output in code fences. Just emit the Markdown.';
    case 'csv':
      return 'You produce a CSV table. First line is the header row. Use commas as separators. Quote fields containing commas, newlines, or quotes (RFC 4180). Do NOT wrap in code fences.';
    case 'json':
      return 'You produce a single valid JSON document. No prose, no code fences, no comments. Just JSON.';
    case 'code':
      return `You produce source code${
        input.language ? ` in ${input.language}` : ''
      }. Emit only the code — no prose, no fences, no commentary.`;
    case 'text':
    default:
      return 'You produce a clear, professional plain-text document. No Markdown syntax, no code fences. Use blank lines between paragraphs.';
  }
}
