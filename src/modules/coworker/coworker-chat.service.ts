import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccessControlService } from '../../shared/access-control/access-control.service';
import { ActivityService } from '../activity/activity.service';
import { EngineService } from '../engine/engine.service';
import { CoworkerChatDto, ListCoworkerMessagesDto } from './dto/chat.dto';
import { CoworkerMessageEntity } from './entities/coworker-message.entity';
import { JobsService } from './jobs.service';

@Injectable()
export class CoworkerChatService {
  constructor(
    @InjectRepository(CoworkerMessageEntity)
    private readonly messagesRepository: Repository<CoworkerMessageEntity>,
    private readonly accessControl: AccessControlService,
    private readonly activityService: ActivityService,
    @Inject(forwardRef(() => EngineService))
    private readonly engineService: EngineService,
    private readonly jobsService: JobsService,
  ) {}

  async listMessages(query: ListCoworkerMessagesDto, actorUserId: string) {
    await this.accessControl.assertResolvedAccess(actorUserId, {
      resource: 'coworker',
      action: 'read',
      organizationId: query.organizationId,
      workspaceId: query.workspaceId,
    });

    return this.messagesRepository.find({
      where: {
        organizationId: query.organizationId,
        workspaceId: query.workspaceId,
        conversationId: query.conversationId ?? 'default',
      },
      order: { createdAt: 'ASC' },
      take: 200,
    });
  }

  /**
   * Returns distinct chat conversations within a workspace, ordered by most
   * recent activity. Each item carries a title (first user message snippet),
   * the message count, and the last update timestamp so the UI can render
   * "chat history" without loading every message.
   */
  async listConversations(
    organizationId: string,
    workspaceId: string,
    actorUserId: string,
  ) {
    await this.accessControl.assertResolvedAccess(actorUserId, {
      resource: 'coworker',
      action: 'read',
      organizationId,
      workspaceId,
    });
    const rows = await this.messagesRepository
      .createQueryBuilder('m')
      .select('m.conversationId', 'conversationId')
      .addSelect('COUNT(*)', 'count')
      .addSelect('MAX(m.createdAt)', 'lastAt')
      .addSelect(
        `(array_agg(m.content ORDER BY m.createdAt ASC)
            FILTER (WHERE m.role = 'user'))[1]`,
        'firstUserMessage',
      )
      .where('m.organizationId = :organizationId', { organizationId })
      .andWhere('m.workspaceId = :workspaceId', { workspaceId })
      .groupBy('m.conversationId')
      .orderBy('"lastAt"', 'DESC')
      .limit(50)
      .getRawMany<{
        conversationId: string;
        count: string;
        lastAt: Date;
        firstUserMessage: string | null;
      }>();

    return rows.map((row) => ({
      conversationId: row.conversationId,
      messageCount: Number(row.count),
      lastAt:
        row.lastAt instanceof Date ? row.lastAt.toISOString() : row.lastAt,
      title: this.deriveTitle(row.conversationId, row.firstUserMessage),
    }));
  }

  private deriveTitle(conversationId: string, firstUserMessage: string | null) {
    if (firstUserMessage) {
      const trimmed = firstUserMessage.trim().replace(/\s+/g, ' ');
      return trimmed.length > 80 ? `${trimmed.slice(0, 77)}…` : trimmed;
    }
    return conversationId === 'default' ? 'Default chat' : conversationId;
  }

  async getContext(
    organizationId: string,
    workspaceId: string,
    actorUserId: string,
  ) {
    await this.accessControl.assertResolvedAccess(actorUserId, {
      resource: 'coworker',
      action: 'read',
      organizationId,
      workspaceId,
    });
    const jobs = await this.jobsService.list(
      { organizationId, workspaceId },
      actorUserId,
    );
    const recentMessages = await this.messagesRepository.find({
      where: { organizationId, workspaceId, conversationId: 'default' },
      order: { createdAt: 'DESC' },
      take: 10,
    });
    return {
      organizationId,
      workspaceId,
      activeJobs: jobs.filter((job) =>
        ['scheduled', 'running', 'pending'].includes(job.status),
      ),
      recentMessages: recentMessages.reverse(),
      suggestedActions: [
        'Create a system',
        'Summarize recent activity',
        'Generate a report',
        'Create tasks from a document',
      ],
    };
  }

  async chat(payload: CoworkerChatDto, actorUserId: string) {
    await this.accessControl.assertResolvedAccess(actorUserId, {
      resource: 'coworker',
      action: 'manage_ai',
      organizationId: payload.organizationId,
      workspaceId: payload.workspaceId,
      systemId: payload.systemId,
    });

    const conversationId = payload.conversationId ?? 'default';
    await this.messagesRepository.save(
      this.messagesRepository.create({
        organizationId: payload.organizationId,
        workspaceId: payload.workspaceId,
        conversationId,
        actorUserId,
        role: 'user',
        content: payload.prompt,
        metadata: { systemId: payload.systemId ?? null },
      }),
    );

    const history = (
      await this.messagesRepository.find({
        where: {
          organizationId: payload.organizationId,
          workspaceId: payload.workspaceId,
          conversationId,
        },
        order: { createdAt: 'DESC' },
        take: 12,
      })
    )
      .reverse()
      .filter(
        (message) => message.role === 'user' || message.role === 'assistant',
      )
      .map((message) => ({
        role: message.role as 'user' | 'assistant',
        content: message.content,
      }));

    const toolCalls: Array<Record<string, unknown>> = [];
    let answer = '';
    let routedTier: number | null = null;
    let routedReason: string | null = null;
    for await (const event of this.engineService.run({
      ctx: {
        organizationId: payload.organizationId,
        workspaceId: payload.workspaceId,
        systemId: payload.systemId ?? null,
        actorUserId,
        autopilot: payload.autopilot,
      },
      prompt: payload.prompt,
      history,
      systemHint: payload.systemHint,
      model: payload.model,
      autopilot: payload.autopilot,
    })) {
      if (event.type === 'message.complete') answer = event.text;
      if (event.type === 'tool.call' || event.type === 'tool.result') {
        toolCalls.push(event as unknown as Record<string, unknown>);
      }
      if (event.type === 'session.routed') {
        routedTier = event.tier;
        routedReason = event.reason;
      }
      if (event.type === 'session.error') {
        answer = answer || event.message;
      }
    }

    const assistantMessage = await this.messagesRepository.save(
      this.messagesRepository.create({
        organizationId: payload.organizationId,
        workspaceId: payload.workspaceId,
        conversationId,
        actorUserId: null,
        role: 'assistant',
        content: answer || 'I handled the request.',
        toolCalls,
        metadata: {
          model: payload.model ?? null,
          routerTier: routedTier,
          routerReason: routedReason,
        },
      }),
    );

    await this.activityService.log({
      organizationId: payload.organizationId,
      workspaceId: payload.workspaceId,
      systemId: payload.systemId ?? null,
      actorUserId,
      action: 'coworker.chat',
      targetType: 'coworker_message',
      targetId: assistantMessage.id,
      origin: 'ai',
      metadata: { conversationId, toolCallCount: toolCalls.length },
    });

    return {
      conversationId,
      message: assistantMessage,
      toolCalls,
    };
  }
}
