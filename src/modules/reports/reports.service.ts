import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccessControlService } from '../../shared/access-control/access-control.service';
import { ActivityService } from '../activity/activity.service';
import { AuditService } from '../audit/audit.service';
import { ActivityLogEntity } from '../activity/entities/activity-log.entity';
import { DocumentsService } from '../documents/documents.service';
import { RuntimeRecordEntity } from '../records/entities/runtime-record.entity';
import { TaskEntity } from '../tasks/entities/task.entity';
import {
  CreateReportDto,
  GenerateReportDto,
  ListReportsDto,
  UpdateReportDto,
} from './dto/report.dto';
import { ReportEntity } from './entities/report.entity';

@Injectable()
export class ReportsService {
  constructor(
    @InjectRepository(ReportEntity)
    private readonly reportsRepository: Repository<ReportEntity>,
    @InjectRepository(TaskEntity)
    private readonly tasksRepository: Repository<TaskEntity>,
    @InjectRepository(RuntimeRecordEntity)
    private readonly recordsRepository: Repository<RuntimeRecordEntity>,
    @InjectRepository(ActivityLogEntity)
    private readonly activityRepository: Repository<ActivityLogEntity>,
    private readonly accessControlService: AccessControlService,
    private readonly activityService: ActivityService,
    private readonly auditService: AuditService,
    private readonly documentsService: DocumentsService,
  ) {}

  async create(payload: CreateReportDto, actorUserId: string) {
    await this.accessControlService.assertResolvedAccess(actorUserId, {
      resource: 'report',
      action: 'create',
      organizationId: payload.organizationId,
      workspaceId: payload.workspaceId,
      systemId: payload.systemId,
    });

    const report = await this.reportsRepository.save(
      this.reportsRepository.create({
        organizationId: payload.organizationId,
        workspaceId: payload.workspaceId ?? null,
        systemId: payload.systemId ?? null,
        createdByUserId: actorUserId,
        title: payload.title,
        summary: payload.summary ?? '',
        data: payload.data ?? {},
        sourceType: payload.sourceType ?? 'mixed',
      }),
    );
    await this.log('report.create', report, actorUserId);
    return report;
  }

  async findAll(filters: ListReportsDto, actorUserId: string) {
    const qb = this.reportsRepository.createQueryBuilder('report');
    await this.accessControlService.applyTenantScopeToQueryBuilder(
      qb,
      'report',
      actorUserId,
      {
        organizationField: 'organizationId',
        workspaceField: 'workspaceId',
        organizationId: filters.organizationId,
        workspaceId: filters.workspaceId,
      },
    );
    if (filters.systemId) qb.andWhere('report.systemId = :systemId', { systemId: filters.systemId });
    if (filters.status) qb.andWhere('report.status = :status', { status: filters.status });
    return qb.orderBy('report.createdAt', 'DESC').take(200).getMany();
  }

  async findOne(reportId: string, actorUserId: string) {
    const report = await this.reportsRepository.findOne({ where: { id: reportId } });
    if (!report) throw new NotFoundException('Report not found.');
    await this.accessControlService.assertResolvedAccess(actorUserId, {
      resource: 'report',
      action: 'read',
      organizationId: report.organizationId,
      workspaceId: report.workspaceId,
      systemId: report.systemId,
    });
    return report;
  }

  async generate(payload: GenerateReportDto, actorUserId: string) {
    await this.accessControlService.assertResolvedAccess(actorUserId, {
      resource: 'report',
      action: 'create',
      organizationId: payload.organizationId,
      workspaceId: payload.workspaceId,
      systemId: payload.systemId,
    });

    const data = await this.collectData(payload);
    const summary = this.summarize(payload.sourceType, data);
    const report = await this.reportsRepository.save(
      this.reportsRepository.create({
        organizationId: payload.organizationId,
        workspaceId: payload.workspaceId ?? null,
        systemId: payload.systemId ?? null,
        createdByUserId: actorUserId,
        title: payload.title,
        summary,
        data,
        sourceType: payload.sourceType,
        metadata: { filters: payload.filters ?? null, generatedBy: 'stack62' },
      }),
    );
    await this.log('report.generate', report, actorUserId);
    if (payload.saveAsDocument === 'true') {
      const document = await this.saveAsDocument(report.id, actorUserId);
      return { ...report, document };
    }
    return report;
  }

  async update(reportId: string, payload: UpdateReportDto, actorUserId: string) {
    const report = await this.findOne(reportId, actorUserId);
    await this.accessControlService.assertResolvedAccess(actorUserId, {
      resource: 'report',
      action: 'update',
      organizationId: report.organizationId,
      workspaceId: report.workspaceId,
      systemId: report.systemId,
    });

    const beforeData = { ...report };
    report.title = payload.title ?? report.title;
    report.summary = payload.summary ?? report.summary;
    report.data = payload.data ?? report.data;
    report.status = payload.status ?? report.status;
    const updated = await this.reportsRepository.save(report);

    await this.activityService.log({
      organizationId: updated.organizationId,
      workspaceId: updated.workspaceId,
      systemId: updated.systemId,
      actorUserId,
      action: 'report.update',
      targetType: 'report',
      targetId: updated.id,
      origin: 'user',
      metadata: { title: updated.title },
    });
    await this.auditService.log({
      organizationId: updated.organizationId,
      workspaceId: updated.workspaceId,
      systemId: updated.systemId,
      actorUserId,
      action: 'report.update',
      targetType: 'report',
      targetId: updated.id,
      beforeData,
      afterData: updated,
    });
    return updated;
  }

  async archive(reportId: string, actorUserId: string) {
    return this.update(reportId, { status: 'archived' }, actorUserId);
  }

  async saveAsDocument(reportId: string, actorUserId: string) {
    const report = await this.findOne(reportId, actorUserId);
    const content = this.renderReportMarkdown(report);
    const document = await this.documentsService.create(
      {
        organizationId: report.organizationId,
        workspaceId: report.workspaceId ?? undefined,
        systemId: report.systemId ?? undefined,
        title: report.title,
        content,
        format: 'markdown',
        metadata: { sourceReportId: report.id, sourceType: report.sourceType },
      },
      actorUserId,
    );

    report.metadata = {
      ...(report.metadata ?? {}),
      savedDocumentId: document.id,
    };
    await this.reportsRepository.save(report);
    await this.log('report.save_document', report, actorUserId);
    return document;
  }

  private async collectData(payload: GenerateReportDto) {
    const where = {
      organizationId: payload.organizationId,
      workspaceId: payload.workspaceId,
      systemId: payload.systemId,
    };
    const tasks =
      payload.sourceType === 'tasks' || payload.sourceType === 'mixed'
        ? await this.tasksRepository.find({ where, take: 500, order: { updatedAt: 'DESC' } })
        : [];
    const records =
      payload.sourceType === 'records' || payload.sourceType === 'mixed'
        ? await this.recordsRepository.find({ where, take: 500, order: { updatedAt: 'DESC' } })
        : [];
    const activity =
      payload.sourceType === 'activity' || payload.sourceType === 'mixed'
        ? await this.activityRepository.find({ where, take: 500, order: { createdAt: 'DESC' } })
        : [];
    return {
      counts: {
        tasks: tasks.length,
        records: records.length,
        activity: activity.length,
        completedTasks: tasks.filter((t) => ['done', 'completed'].includes(t.status)).length,
        openTasks: tasks.filter((t) => !['done', 'completed', 'cancelled'].includes(t.status)).length,
      },
      tasks: tasks.slice(0, 50),
      records: records.slice(0, 50),
      activity: activity.slice(0, 80),
    };
  }

  private summarize(sourceType: string, data: Record<string, unknown>) {
    const counts = data.counts as Record<string, number>;
    return [
      `${sourceType} report generated from current workspace data.`,
      `Tasks: ${counts.tasks ?? 0} (${counts.openTasks ?? 0} open, ${counts.completedTasks ?? 0} completed).`,
      `Records: ${counts.records ?? 0}. Activity events: ${counts.activity ?? 0}.`,
    ].join(' ');
  }

  private async log(action: string, report: ReportEntity, actorUserId: string) {
    await this.activityService.log({
      organizationId: report.organizationId,
      workspaceId: report.workspaceId,
      systemId: report.systemId,
      actorUserId,
      action,
      targetType: 'report',
      targetId: report.id,
      origin: 'user',
      metadata: { title: report.title, sourceType: report.sourceType },
    });
    await this.auditService.log({
      organizationId: report.organizationId,
      workspaceId: report.workspaceId,
      systemId: report.systemId,
      actorUserId,
      action,
      targetType: 'report',
      targetId: report.id,
      afterData: report,
    });
  }

  private renderReportMarkdown(report: ReportEntity) {
    const counts = (report.data?.counts ?? {}) as Record<string, unknown>;
    return [
      `# ${report.title}`,
      '',
      report.summary,
      '',
      '## Metrics',
      '',
      ...Object.entries(counts).map(([key, value]) => `- ${key}: ${value}`),
      '',
      '## Data',
      '',
      '```json',
      JSON.stringify(report.data, null, 2),
      '```',
    ].join('\n');
  }
}
