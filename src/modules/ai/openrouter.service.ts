import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiChangePlan } from './schemas/change-plan.schema';
import { ClaudeCodeService } from './claude-code.service';
import { CodexService } from './codex.service';

interface OpenRouterPlanRequest {
  prompt: string;
  systemId?: string | null;
  context?: Record<string, unknown> | null;
  fallbackPlan: AiChangePlan;
  /** Optional per-org API key (BYOK). Falls back to env key if absent. */
  orgApiKey?: string | null;
  /** Model slug override: request → org preferred → env default */
  model?: string | null;
}

interface OpenRouterChatResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
}

@Injectable()
export class OpenRouterService {
  private readonly logger = new Logger(OpenRouterService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly claudeCodeService: ClaudeCodeService,
    private readonly codexService: CodexService,
  ) {}

  isEnabled() {
    return Boolean(
      this.configService.get<string>('OPENROUTER_API_KEY') &&
      this.configService.get<boolean>('AI_ENABLE_REMOTE_PLANNER', true),
    );
  }

  async isAvailableForModel(
    orgApiKey: string | null,
    model: string | null,
  ): Promise<{ available: boolean; reason?: string; resolvedModel: string }> {
    const requestedOrDefault =
      model ||
      this.configService.get<string>('AI_DEFAULT_MODEL') ||
      this.configService.get<string>('OPENROUTER_MODEL', 'openai/gpt-4o-mini');
    const claudeAlias = ClaudeCodeService.parseModel(requestedOrDefault);
    if (claudeAlias !== null) {
      const { available } = await this.claudeCodeService.isAvailable();
      return {
        available,
        reason: available
          ? undefined
          : 'Claude Code CLI not available on this server. Install `@anthropic-ai/claude-code` and run `claude login` on the backend host.',
        resolvedModel: `claude-code:${claudeAlias}`,
      };
    }

    const codexModel = CodexService.parseModel(requestedOrDefault);
    if (codexModel !== null) {
      const { available } = await this.codexService.isAvailable();
      return {
        available,
        reason: available
          ? undefined
          : 'Codex CLI not available on this server. Install Codex and run `codex login` on the backend host.',
        resolvedModel: `codex:${codexModel}`,
      };
    }

    const resolvedKey =
      orgApiKey || this.configService.get<string>('OPENROUTER_API_KEY');
    if (!resolvedKey) {
      return {
        available: false,
        reason:
          'No AI provider configured. Add an OpenRouter API key in Settings → Organization, or select a Claude Code model if the CLI is installed.',
        resolvedModel: requestedOrDefault,
      };
    }

    return {
      available: true,
      resolvedModel: requestedOrDefault,
    };
  }

  async generatePlan({
    prompt,
    systemId,
    context,
    fallbackPlan,
    orgApiKey,
    model: requestModel,
  }: OpenRouterPlanRequest): Promise<AiChangePlan | null> {
    if (!this.configService.get<boolean>('AI_ENABLE_REMOTE_PLANNER', true)) {
      return null;
    }

    const requestedOrDefault =
      requestModel ||
      this.configService.get<string>('AI_DEFAULT_MODEL') ||
      this.configService.get<string>('OPENROUTER_MODEL', 'openai/gpt-4o-mini');

    // Route claude-code:* models to the local Claude Code CLI instead of OpenRouter.
    const claudeAlias = ClaudeCodeService.parseModel(requestedOrDefault);
    if (claudeAlias !== null) {
      try {
        const raw = await this.claudeCodeService.complete(
          this.buildPlanMessages(prompt, systemId, context, fallbackPlan),
          claudeAlias,
        );
        return this.extractJson(raw) as AiChangePlan;
      } catch (err) {
        this.logger.warn(
          `Claude Code planning failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        return null;
      }
    }

    const codexModel = CodexService.parseModel(requestedOrDefault);
    if (codexModel !== null) {
      try {
        const raw = await this.codexService.complete(
          this.buildPlanMessages(prompt, systemId, context, fallbackPlan),
          codexModel,
        );
        return this.extractJson(raw) as AiChangePlan;
      } catch (err) {
        this.logger.warn(
          `Codex planning failed; using Stack62 deterministic planner fallback: ${err instanceof Error ? err.message : String(err)}`,
        );
        return fallbackPlan;
      }
    }

    const resolvedKey =
      orgApiKey || this.configService.get<string>('OPENROUTER_API_KEY');
    if (!resolvedKey) {
      return null;
    }

    const apiKey = resolvedKey;
    const baseUrl = this.configService.get<string>(
      'OPENROUTER_BASE_URL',
      'https://openrouter.ai/api/v1',
    );
    // Model priority: per-request → env default.
    // (claude-code:* was already handled above.)
    const model = requestedOrDefault;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'X-Title': this.configService.get<string>(
        'OPENROUTER_APP_NAME',
        'Stack62 Studio Engine',
      ),
    };

    const referer = this.configService.get<string>('OPENROUTER_HTTP_REFERER');
    if (referer) {
      headers['HTTP-Referer'] = referer;
    }

    const requestBody = {
      model,
      temperature: 0.2,
      messages: this.buildPlanMessages(prompt, systemId, context, fallbackPlan),
    };

    try {
      const response = await fetch(
        `${baseUrl.replace(/\/$/, '')}/chat/completions`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify(requestBody),
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.warn(
          `OpenRouter planning request failed with status ${response.status}: ${errorText}`,
        );
        return null;
      }

      const data = (await response.json()) as OpenRouterChatResponse;
      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        this.logger.warn(
          'OpenRouter returned no content for planning request.',
        );
        return null;
      }

      const parsed = this.extractJson(content);
      return parsed as AiChangePlan;
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unknown OpenRouter planning failure.';
      this.logger.warn(`OpenRouter planning failed: ${message}`);
      return null;
    }
  }

  async complete(
    messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
    orgApiKey?: string | null,
    requestModel?: string | null,
  ): Promise<string> {
    const requestedOrDefault =
      requestModel ||
      this.configService.get<string>('AI_DEFAULT_MODEL') ||
      this.configService.get<string>('OPENROUTER_MODEL', 'openai/gpt-4o-mini');
    // Route claude-code:* models to the local Claude Code CLI instead of OpenRouter.
    const claudeAlias = ClaudeCodeService.parseModel(requestedOrDefault);
    if (claudeAlias !== null) {
      return this.claudeCodeService.complete(messages, claudeAlias);
    }

    const codexModel = CodexService.parseModel(requestedOrDefault);
    if (codexModel !== null) {
      return this.codexService.complete(messages, codexModel);
    }

    const resolvedKey =
      orgApiKey || this.configService.get<string>('OPENROUTER_API_KEY');
    if (!resolvedKey) return '[AI disabled: no API key configured]';

    const apiKey = resolvedKey;
    const baseUrl = this.configService.get<string>(
      'OPENROUTER_BASE_URL',
      'https://openrouter.ai/api/v1',
    );
    const model = requestedOrDefault;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'X-Title': this.configService.get<string>(
        'OPENROUTER_APP_NAME',
        'Stack62 Studio Engine',
      ),
    };
    const referer = this.configService.get<string>('OPENROUTER_HTTP_REFERER');
    if (referer) headers['HTTP-Referer'] = referer;

    const response = await fetch(
      `${baseUrl.replace(/\/$/, '')}/chat/completions`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ model, temperature: 0.7, messages }),
      },
    );

    if (!response.ok)
      throw new Error(
        `OpenRouter error ${response.status}: ${await response.text()}`,
      );
    const data = (await response.json()) as OpenRouterChatResponse;
    return data.choices?.[0]?.message?.content ?? '';
  }

  private buildPlanMessages(
    prompt: string,
    systemId: string | null | undefined,
    context: Record<string, unknown> | null | undefined,
    fallbackPlan: AiChangePlan,
  ): Array<{ role: 'system' | 'user'; content: string }> {
    const isUpdate = Boolean(systemId);
    return [
      {
        role: 'system',
        content: [
          'You are Stack62 Studio Engine, an AI that designs detailed business management systems.',
          'Generate a complete, specific plan based EXACTLY on what the user asks for.',
          "Be thorough: include all relevant modules, entities, and fields for the user's domain.",
          'Field names and structure should be specific to the business (e.g., a clinic needs Patients, Appointments, Prescriptions — not generic "Records").',
          'Return ONLY valid JSON. No markdown fences, no explanation, no commentary — just the JSON object.',
          isUpdate
            ? 'This updates an existing system. Only include what needs to change.'
            : 'Create a complete new system from scratch.',
        ].join(' '),
      },
      {
        role: 'user',
        content: JSON.stringify(
          {
            userRequest: prompt,
            systemId: systemId ?? null,
            context: context ?? null,
            exampleValidPlan: fallbackPlan,
            outputFormat: {
              intent: isUpdate ? 'update_system' : 'create_system',
              name: 'FILL: short descriptive name for this system',
              description: 'FILL: what this system manages',
              industryType: 'FILL: industry sector',
              governanceMode: 'standard',
              visibility: 'private',
              summary: 'FILL: 2-3 sentences describing what was planned',
              riskLevel: 'low | medium | high',
              modules: [
                {
                  name: 'FILL: module name',
                  key: 'FILL: kebab-case-key',
                  description: 'FILL: what this module covers',
                  kind: 'custom',
                  config: {},
                  entities: [
                    {
                      name: 'FILL: entity name (plural noun)',
                      key: 'FILL: kebab-case-key',
                      description: 'FILL: what records this entity stores',
                      config: {},
                      fields: [
                        {
                          name: 'FILL: field label',
                          key: 'FILL: kebab-case-key',
                          dataType:
                            'text | number | boolean | date | datetime | email | phone | url | textarea | select | relation',
                          required: false,
                          config: null,
                        },
                      ],
                    },
                  ],
                },
              ],
              views: [
                {
                  name: 'FILL: view name',
                  type: 'table',
                  entityKey: 'FILL: entity key',
                  config: {},
                },
              ],
              dashboards: [
                { name: 'FILL: dashboard name', scope: 'system', widgets: [] },
              ],
              workflows: [],
              permissionPolicies: [],
              artifacts: [],
            },
          },
          null,
          2,
        ),
      },
    ];
  }

  private extractJson(content: string): unknown {
    const fencedMatch = content.match(/```json\s*([\s\S]*?)```/i);
    if (fencedMatch?.[1]) {
      return JSON.parse(fencedMatch[1]);
    }

    const firstBrace = content.indexOf('{');
    const lastBrace = content.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return JSON.parse(content.slice(firstBrace, lastBrace + 1));
    }

    return JSON.parse(content);
  }
}
