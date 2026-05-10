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

@Injectable()
export class ModelRouterService {
  constructor(private readonly configService: ConfigService) {}

  route(taskType: AiTaskType, requestedModel?: string | null) {
    if (requestedModel) return requestedModel;
    if (taskType === 'local_private') {
      return this.configService.get<string>('OLLAMA_MODEL', 'llama3.1');
    }
    if (
      taskType === 'system_generation' ||
      taskType === 'workflow_generation' ||
      taskType === 'email_draft'
    ) {
      return (
        this.configService.get<string>('OPENAI_MODEL') ||
        this.configService.get<string>('ANTHROPIC_MODEL') ||
        this.configService.get<string>('AI_DEFAULT_MODEL') ||
        'openai/gpt-4o'
      );
    }
    return (
      this.configService.get<string>('AI_DEFAULT_MODEL') ||
      this.configService.get<string>('OPENAI_MODEL') ||
      this.configService.get<string>('OPENROUTER_MODEL', 'openai/gpt-4o-mini')
    );
  }
}
