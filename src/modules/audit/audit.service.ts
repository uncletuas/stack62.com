import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccessControlService } from '../../shared/access-control/access-control.service';
import { ListAuditLogsDto } from './dto/list-audit-logs.dto';
import {
  AuditLogEntity,
  AuditOrigin,
  AuditPayload,
} from './entities/audit-log.entity';

export interface CreateAuditLogInput {
  organizationId?: string | null;
  workspaceId?: string | null;
  systemId?: string | null;
  actorUserId?: string | null;
  action: string;
  targetType: string;
  targetId: string;
  origin?: AuditOrigin;
  beforeData?: AuditPayload | null;
  afterData?: AuditPayload | null;
  metadata?: Record<string, unknown> | null;
}

@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditLogEntity)
    private readonly auditRepository: Repository<AuditLogEntity>,
    private readonly accessControlService: AccessControlService,
    private readonly configService: ConfigService,
  ) {}

  async log(input: CreateAuditLogInput) {
    const audit = this.auditRepository.create({
      organizationId: input.organizationId ?? null,
      workspaceId: input.workspaceId ?? null,
      systemId: input.systemId ?? null,
      actorUserId: input.actorUserId ?? null,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      origin: input.origin ?? 'user',
      beforeData: input.beforeData ?? null,
      afterData: input.afterData ?? null,
      metadata: input.metadata ?? null,
    });

    return this.auditRepository.save(audit);
  }

  async findAll(filters: ListAuditLogsDto, actorUserId: string) {
    const queryBuilder = this.auditRepository.createQueryBuilder('audit');

    await this.accessControlService.applyTenantScopeToQueryBuilder(
      queryBuilder,
      'audit',
      actorUserId,
      {
        organizationField: 'organizationId',
        workspaceField: 'workspaceId',
        organizationId: filters.organizationId,
        workspaceId: filters.workspaceId,
      },
    );

    if (filters.systemId) {
      queryBuilder.andWhere('audit.systemId = :systemId', {
        systemId: filters.systemId,
      });
    }

    if (filters.action) {
      queryBuilder.andWhere('audit.action = :action', {
        action: filters.action,
      });
    }

    if (filters.targetType) {
      queryBuilder.andWhere('audit.targetType = :targetType', {
        targetType: filters.targetType,
      });
    }

    return queryBuilder.orderBy('audit.createdAt', 'DESC').take(200).getMany();
  }

  async exportCsv(filters: ListAuditLogsDto, actorUserId: string) {
    const queryBuilder = this.auditRepository.createQueryBuilder('audit');

    await this.accessControlService.applyTenantScopeToQueryBuilder(
      queryBuilder,
      'audit',
      actorUserId,
      {
        organizationField: 'organizationId',
        workspaceField: 'workspaceId',
        organizationId: filters.organizationId,
        workspaceId: filters.workspaceId,
      },
    );

    if (filters.systemId) {
      queryBuilder.andWhere('audit.systemId = :systemId', {
        systemId: filters.systemId,
      });
    }

    if (filters.action) {
      queryBuilder.andWhere('audit.action = :action', {
        action: filters.action,
      });
    }

    if (filters.targetType) {
      queryBuilder.andWhere('audit.targetType = :targetType', {
        targetType: filters.targetType,
      });
    }

    const rows = await queryBuilder
      .orderBy('audit.createdAt', 'DESC')
      .take(this.configService.get<number>('AUDIT_EXPORT_MAX_ROWS', 5000))
      .getMany();

    return this.toCsv(rows);
  }

  private toCsv(rows: AuditLogEntity[]) {
    const columns = [
      'id',
      'createdAt',
      'organizationId',
      'workspaceId',
      'systemId',
      'actorUserId',
      'action',
      'targetType',
      'targetId',
      'origin',
      'metadata',
    ];
    const lines = [
      columns.join(','),
      ...rows.map((row) =>
        columns
          .map((column) => this.csvCell(this.valueForColumn(row, column)))
          .join(','),
      ),
    ];
    return lines.join('\n');
  }

  private valueForColumn(row: AuditLogEntity, column: string) {
    const value = row[column as keyof AuditLogEntity];
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'object' && value !== null)
      return JSON.stringify(value);
    return value ?? '';
  }

  private csvCell(value: unknown) {
    const text = String(value).replace(/\r?\n/g, ' ');
    return `"${text.replace(/"/g, '""')}"`;
  }
}
