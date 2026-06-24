import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLogEntity } from '../audit/entities/audit-log.entity';

export interface AdminAuditQuery {
  organizationId?: string;
  action?: string;
  targetType?: string;
  origin?: string;
  actorUserId?: string;
  page?: number;
  pageSize?: number;
}

/**
 * Cross-tenant audit reads for the Audit & Compliance Center. Unlike the
 * tenant-scoped AuditService.findAll, this intentionally spans all orgs —
 * access is gated by PlatformRoleGuard.
 */
@Injectable()
export class AdminAuditService {
  constructor(
    @InjectRepository(AuditLogEntity)
    private readonly auditLogs: Repository<AuditLogEntity>,
  ) {}

  async list(query: AdminAuditQuery) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, query.pageSize ?? 50));
    const qb = this.buildQuery(query);
    const [rows, total] = await qb
      .orderBy('a.createdAt', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();
    return { items: rows, total, page, pageSize };
  }

  async exportCsv(query: AdminAuditQuery) {
    const rows = await this.buildQuery(query)
      .orderBy('a.createdAt', 'DESC')
      .take(5000)
      .getMany();
    return this.toCsv(rows);
  }

  private buildQuery(query: AdminAuditQuery) {
    const qb = this.auditLogs.createQueryBuilder('a');
    if (query.organizationId) {
      qb.andWhere('a.organizationId = :orgId', { orgId: query.organizationId });
    }
    if (query.action) qb.andWhere('a.action = :action', { action: query.action });
    if (query.targetType) {
      qb.andWhere('a.targetType = :t', { t: query.targetType });
    }
    if (query.origin) qb.andWhere('a.origin = :origin', { origin: query.origin });
    if (query.actorUserId) {
      qb.andWhere('a.actorUserId = :actor', { actor: query.actorUserId });
    }
    return qb;
  }

  private toCsv(rows: AuditLogEntity[]) {
    const columns = [
      'id',
      'createdAt',
      'organizationId',
      'actorUserId',
      'action',
      'targetType',
      'targetId',
      'origin',
      'metadata',
    ];
    const cell = (value: unknown) => {
      const v =
        value instanceof Date
          ? value.toISOString()
          : typeof value === 'object' && value !== null
            ? JSON.stringify(value)
            : (value ?? '');
      return `"${String(v).replace(/\r?\n/g, ' ').replace(/"/g, '""')}"`;
    };
    return [
      columns.join(','),
      ...rows.map((row) =>
        columns
          .map((c) => cell(row[c as keyof AuditLogEntity]))
          .join(','),
      ),
    ].join('\n');
  }
}
