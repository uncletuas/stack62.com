import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiRequestLogEntity } from './entities/ai-request-log.entity';
import { ModelRouterService, type AiTaskType } from './model-router.service';
import { OpenRouterService } from './openrouter.service';

export interface AiGatewayCompleteInput {
  organizationId?: string | null;
  workspaceId?: string | null;
  actorUserId?: string | null;
  taskType?: AiTaskType;
  model?: string | null;
  orgApiKey?: string | null;
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  metadata?: Record<string, unknown> | null;
}

@Injectable()
export class AiGatewayService {
  constructor(
    private readonly configService: ConfigService,
    private readonly openRouterService: OpenRouterService,
    private readonly modelRouter: ModelRouterService,
    @InjectRepository(AiRequestLogEntity)
    private readonly aiRequestLogsRepository: Repository<AiRequestLogEntity>,
  ) {}

  async complete(input: AiGatewayCompleteInput) {
    const taskType = input.taskType ?? 'default';
    const model = this.modelRouter.route(taskType, input.model);
    const provider = this.resolveProvider(taskType);
    const promptPreview = input.messages
      .map((message) => `${message.role}: ${message.content}`)
      .join('\n')
      .slice(0, 2000);

    try {
      const response = await this.openRouterService.complete(
        input.messages,
        input.orgApiKey,
        model,
      );
      await this.aiRequestLogsRepository.save(
        this.aiRequestLogsRepository.create({
          organizationId: input.organizationId ?? null,
          workspaceId: input.workspaceId ?? null,
          actorUserId: input.actorUserId ?? null,
          provider,
          model,
          taskType,
          status: 'succeeded',
          promptPreview,
          responsePreview: response.slice(0, 2000),
          metadata: input.metadata ?? null,
        }),
      );
      return response;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'AI request failed.';
      await this.aiRequestLogsRepository.save(
        this.aiRequestLogsRepository.create({
          organizationId: input.organizationId ?? null,
          workspaceId: input.workspaceId ?? null,
          actorUserId: input.actorUserId ?? null,
          provider,
          model,
          taskType,
          status: 'failed',
          promptPreview,
          responsePreview: null,
          errorMessage: message,
          metadata: input.metadata ?? null,
        }),
      );
      throw err;
    }
  }

  private resolveProvider(taskType: AiTaskType) {
    if (taskType === 'local_private') return 'ollama';
    return this.configService.get<string>('AI_PROVIDER', 'openrouter');
  }
}
