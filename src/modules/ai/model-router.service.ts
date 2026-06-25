import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type AiTaskType =
  | 'rewrite'
  | 'summary'
  | 'workspace_qa'
  | 'system_generation'
  | 'workflow_generation'
  | 'email_draft'
  | 'scheduled_report'
  | 'local_private'
  | 'default';

export type TaskComplexity = 'low' | 'medium' | 'high';

@Injectable()
export class ModelRouterService {
  constructor(private readonly configService: ConfigService) {}

  /**
   * Pick a model for a task. Selection is cost-aware:
   *   - an explicit `requestedModel` always wins;
   *   - `local_private` runs on the self-hosted model ($0);
   *   - otherwise the model scales with task type AND complexity — heavy tasks
   *     (generation, or an explicit `high` complexity) get the premium frontier
   *     model; everything else gets the cheap model to conserve budget.
   */
  route(
    taskType: AiTaskType,
    requestedModel?: string | null,
    complexity?: TaskComplexity,
  ) {
    if (requestedModel) return requestedModel;
    if (taskType === 'local_private') {
      return this.configService.get<string>('OLLAMA_MODEL', 'llama3.1');
    }

    const heavyTask =
      taskType === 'system_generation' ||
      taskType === 'workflow_generation' ||
      taskType === 'email_draft';
    const usePremium =
      complexity === 'high' || (heavyTask && complexity !== 'low');

    if (usePremium) {
      return (
        this.configService.get<string>('OPENAI_MODEL') ||
        this.configService.get<string>('ANTHROPIC_MODEL') ||
        this.configService.get<string>('AI_DEFAULT_MODEL') ||
        'openai/gpt-4o'
      );
    }
    // Cheap/default path keeps the existing provider slug ordering so the AI
    // gateway (OpenRouter) receives a model id it can route.
    return (
      this.configService.get<string>('AI_DEFAULT_MODEL') ||
      this.configService.get<string>('OPENAI_MODEL') ||
      this.configService.get<string>('OPENROUTER_MODEL', 'openai/gpt-4o-mini')
    );
  }
}
