import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AnthropicClient, type AnthropicCompletion } from '../anthropic.client';
import { OpenAiAdapter, type LlmCompletionRequest } from './openai.adapter';

/**
 * Provider-agnostic entry point for the engine's agentic tool-loop. Selects the
 * frontier provider per AI_PROVIDER and routes around it:
 *
 *   - AI_PROVIDER=openai + OPENAI_API_KEY  → OpenAI (owner's primary choice).
 *   - claude-code:* / codex:* model alias  → local CLI via AnthropicClient.
 *   - anything else                        → AnthropicClient (Anthropic /
 *                                            OpenRouter), preserving prior
 *                                            behaviour for existing deploys.
 *
 * Both paths return the same AnthropicCompletion shape, so the engine loop is
 * unchanged.
 */
@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly anthropic: AnthropicClient,
    private readonly openai: OpenAiAdapter,
  ) {}

  private openAiPrimary(): boolean {
    return (
      this.configService.get<string>('AI_PROVIDER') === 'openai' &&
      this.openai.isConfigured()
    );
  }

  /** Resolve the default model for the active provider. */
  resolveModel(model?: string | null): string {
    if (model) return model;
    if (this.openAiPrimary()) return this.openai.resolveModel();
    return this.anthropic.resolveModel();
  }

  async complete(req: LlmCompletionRequest): Promise<AnthropicCompletion> {
    const model = req.model ?? this.resolveModel();
    // Local CLI aliases are always handled by the Anthropic client.
    const isLocalAlias = /^(claude-code:|codex:)/i.test(model);
    if (!isLocalAlias && this.openAiPrimary()) {
      // The org BYOK key is an OpenRouter/Anthropic key — don't forward it to
      // OpenAI. The adapter falls back to the platform OPENAI_API_KEY.
      return this.openai.complete({ ...req, model, apiKey: null });
    }
    return this.anthropic.complete({
      system: req.system,
      messages: req.messages,
      tools: req.tools,
      maxTokens: req.maxTokens,
      temperature: req.temperature,
      model,
      apiKey: req.apiKey,
    });
  }
}
