import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';
import { AccessControlService } from '../../shared/access-control/access-control.service';
import { AiGatewayService } from '../ai/ai-gateway.service';
import { DocumentEntity } from '../documents/entities/document.entity';
import { FileEntity } from '../files/entities/file.entity';
import { OrganizationsService } from '../organizations/organizations.service';
import { RuntimeRecordEntity } from '../records/entities/runtime-record.entity';
import { ScheduleEntity } from '../schedules/entities/schedule.entity';
import { SystemEntity } from '../systems/entities/system.entity';
import { TaskEntity } from '../tasks/entities/task.entity';
import {
  WorkspaceQuestionDto,
  WorkspaceSearchDto,
} from './dto/workspace-search.dto';
import { ContentIndexService } from './content-index.service';

@Injectable()
export class SearchService {
  constructor(
    @InjectRepository(DocumentEntity)
    private readonly documentsRepository: Repository<DocumentEntity>,
    @InjectRepository(FileEntity)
    private readonly filesRepository: Repository<FileEntity>,
    @InjectRepository(RuntimeRecordEntity)
    private readonly recordsRepository: Repository<RuntimeRecordEntity>,
    @InjectRepository(ScheduleEntity)
    private readonly schedulesRepository: Repository<ScheduleEntity>,
    @InjectRepository(SystemEntity)
    private readonly systemsRepository: Repository<SystemEntity>,
    @InjectRepository(TaskEntity)
    private readonly tasksRepository: Repository<TaskEntity>,
    private readonly contentIndexService: ContentIndexService,
    @Inject(forwardRef(() => AiGatewayService))
    private readonly aiGatewayService: AiGatewayService,
    private readonly organizationsService: OrganizationsService,
    private readonly accessControl: AccessControlService,
  ) {}

  async workspace(query: WorkspaceSearchDto, actorUserId: string) {
    await this.accessControl.assertResolvedAccess(actorUserId, {
      resource: 'workspace',
      action: 'read',
      organizationId: query.organizationId,
      workspaceId: query.workspaceId,
    });

    const q = `%${query.q}%`;
    const scope = {
      organizationId: query.organizationId,
      workspaceId: query.workspaceId,
    };
    const [chunks, documents, files, records, schedules, systems, tasks] =
      await Promise.all([
        this.contentIndexService.search({
          organizationId: query.organizationId,
          workspaceId: query.workspaceId,
          query: query.q,
          limit: 20,
        }),
        this.documentsRepository.find({
          where: [
            { ...scope, title: ILike(q) },
            { ...scope, content: ILike(q) },
          ],
          take: 20,
          order: { updatedAt: 'DESC' },
        }),
        this.filesRepository.find({
          where: { ...scope, filename: ILike(q) },
          take: 20,
          order: { updatedAt: 'DESC' },
        }),
        this.recordsRepository.find({
          where: scope,
          take: 20,
          order: { updatedAt: 'DESC' },
        }),
        this.schedulesRepository.find({
          where: { ...scope, title: ILike(q) },
          take: 20,
          order: { startsAt: 'DESC' },
        }),
        this.systemsRepository.find({
          where: [
            { ...scope, name: ILike(q) },
            { ...scope, description: ILike(q) },
          ],
          take: 20,
          order: { updatedAt: 'DESC' },
        }),
        this.tasksRepository.find({
          where: [
            { ...scope, title: ILike(q) },
            { ...scope, description: ILike(q) },
          ],
          take: 20,
          order: { updatedAt: 'DESC' },
        }),
      ]);

    return {
      query: query.q,
      chunks,
      documents: documents.map((item) => ({
        id: item.id,
        title: item.title,
        type: 'document',
        updatedAt: item.updatedAt,
      })),
      files: files.map((item) => ({
        id: item.id,
        title: item.filename,
        type: 'file',
        updatedAt: item.updatedAt,
      })),
      records: records
        .filter((item) =>
          JSON.stringify(item.data ?? {}).toLowerCase().includes(query.q.toLowerCase()),
        )
        .map((item) => ({
          id: item.id,
          title: String(item.data?.name ?? item.data?.title ?? item.id),
          type: 'record',
          updatedAt: item.updatedAt,
        })),
      schedules: schedules.map((item) => ({
        id: item.id,
        title: item.title,
        type: 'schedule',
        updatedAt: item.updatedAt,
      })),
      systems: systems.map((item) => ({
        id: item.id,
        title: item.name,
        type: 'system',
        updatedAt: item.updatedAt,
      })),
      tasks: tasks.map((item) => ({
        id: item.id,
        title: item.title,
        type: 'task',
        updatedAt: item.updatedAt,
      })),
    };
  }

  async askWorkspace(body: WorkspaceQuestionDto, actorUserId: string) {
    await this.accessControl.assertResolvedAccess(actorUserId, {
      resource: 'workspace',
      action: 'read',
      organizationId: body.organizationId,
      workspaceId: body.workspaceId,
      systemId: body.systemId,
    });

    const citations = await this.contentIndexService.search({
      organizationId: body.organizationId,
      workspaceId: body.workspaceId,
      systemId: body.systemId,
      query: body.question,
      limit: 8,
    });

    if (citations.length === 0) {
      return {
        answer:
          'I could not find matching indexed workspace content for that question yet.',
        citations: [],
      };
    }

    const org = await this.organizationsService.findById(body.organizationId);
    const context = citations
      .map(
        (item, index) =>
          `[${index + 1}] ${item.sourceTitle} (${item.sourceType}, chunk ${item.chunkIndex + 1})\n${item.content}`,
      )
      .join('\n\n');

    const answer = await this.aiGatewayService.complete({
      organizationId: body.organizationId,
      workspaceId: body.workspaceId ?? null,
      actorUserId,
      taskType: 'workspace_qa',
      orgApiKey: org?.openrouterApiKey ?? null,
      model: org?.preferredModel ?? null,
      messages: [
        {
          role: 'system',
          content:
            'Answer using only the provided Stack62 workspace context. Cite sources inline using [1], [2], etc. If the context is insufficient, say so plainly.',
        },
        {
          role: 'user',
          content: `Question: ${body.question}\n\nWorkspace context:\n${context}`,
        },
      ],
      metadata: { citationCount: citations.length },
    });

    return {
      answer,
      citations: citations.map((item, index) => ({
        index: index + 1,
        sourceType: item.sourceType,
        sourceId: item.sourceId,
        sourceTitle: item.sourceTitle,
        chunkIndex: item.chunkIndex,
        excerpt: item.content.slice(0, 500),
        score: item.score,
      })),
    };
  }
}
