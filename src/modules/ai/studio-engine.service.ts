import { Injectable } from '@nestjs/common';
import { AiChangeRequestEntity } from './entities/ai-change-request.entity';
import { OpenRouterService } from './openrouter.service';
import { AiPlannerService } from './ai-planner.service';
import { AiChangePlan } from './schemas/change-plan.schema';
import { StudioArtifactService } from './studio-artifact.service';
import { OrganizationsService } from '../organizations/organizations.service';

@Injectable()
export class StudioEngineService {
  constructor(
    private readonly aiPlannerService: AiPlannerService,
    private readonly openRouterService: OpenRouterService,
    private readonly studioArtifactService: StudioArtifactService,
    private readonly organizationsService: OrganizationsService,
  ) {}

  async generatePlanForRequest(request: AiChangeRequestEntity): Promise<{
    plan: AiChangePlan;
    chatMessage: string;
    resolvedModel: string;
    orgApiKey: string | null;
  }> {
    const org = await this.organizationsService.findById(
      request.organizationId,
    );
    const orgApiKey = org?.openrouterApiKey ?? null;
    const requestModel =
      typeof request.metadata?._model === 'string'
        ? request.metadata._model
        : null;
    const model = requestModel ?? org?.preferredModel ?? null;

    // Check provider before doing any work — fail loudly rather than silently returning a template.
    const availability = await this.openRouterService.isAvailableForModel(
      orgApiKey,
      model,
    );
    if (!availability.available) {
      throw new Error(availability.reason ?? 'AI provider not available.');
    }

    // Build the schema shape as an example for the AI to follow.
    const examplePlan = this.aiPlannerService.buildPlan(
      request.prompt,
      request.systemId,
      {
        generateArtifacts: request.generateArtifacts,
        context: request.metadata,
      },
    );

    // Ask the AI to generate the real plan.
    const plan = await this.openRouterService.generatePlan({
      prompt: request.prompt,
      systemId: request.systemId,
      context: request.metadata,
      fallbackPlan: examplePlan,
      orgApiKey,
      model,
    });

    if (!plan) {
      throw new Error(
        `AI model "${availability.resolvedModel}" failed to return a valid plan. Check your API key and model configuration.`,
      );
    }

    const chatMessage = await this.generateChatMessage(
      request,
      plan,
      orgApiKey,
      model,
    );

    return {
      plan,
      chatMessage,
      resolvedModel: availability.resolvedModel,
      orgApiKey,
    };
  }

  async generateChatMessage(
    request: AiChangeRequestEntity,
    plan: AiChangePlan,
    orgApiKey: string | null,
    model: string | null,
  ): Promise<string> {
    const moduleNames = (plan.modules ?? [])
      .map((m) => m.name)
      .filter(Boolean)
      .join(', ');
    const isCreate = plan.intent === 'create_system';
    const systemName = isCreate
      ? (((plan as unknown as Record<string, unknown>).name as
          | string
          | undefined) ?? 'system')
      : 'existing system';

    try {
      const response = await this.openRouterService.complete(
        [
          {
            role: 'system',
            content:
              'You are an assistant for Stack62, a platform where companies build internal business systems. ' +
              'Given a user request and plan summary, write a concise 2–3 sentence conversational reply ' +
              'explaining what you have planned to build or change. ' +
              'Be specific about the modules. No markdown, no lists, no bullet points.',
          },
          {
            role: 'user',
            content: [
              `User request: "${request.prompt}"`,
              `Action: ${isCreate ? `Creating new system "${systemName}"` : `Updating ${systemName}`}`,
              `Modules: ${moduleNames || 'none'}`,
              `Risk level: ${plan.riskLevel}`,
            ].join('\n'),
          },
        ],
        orgApiKey,
        model,
      );
      return response?.trim() || plan.summary;
    } catch {
      return plan.summary;
    }
  }

  async generateArtifactsForRequest(
    request: AiChangeRequestEntity,
    planId: string,
    plan: AiChangePlan,
  ) {
    return this.studioArtifactService.generateFromPlan({
      request,
      planId,
      plan,
    });
  }

  validatePlan(plan: AiChangePlan) {
    return this.aiPlannerService.validatePlan(plan);
  }
}
