import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLogEntity } from '../audit/entities/audit-log.entity';
import { ListAdminAuditDto } from './dto/list-admin-audit.dto';

/**
 * Cross-tenant view over the existing `audit_logs` table for the admin console.
 * Reuses the same table customers' actions are written to (and where staff
 * actions land with origin='system'), but WITHOUT the tenant scoping the
 * customer AuditService applies — staff legitimately see every organization.
 * The capability check (`audit.read`) on the controller is the access boundary.
 */
@Injectable()
export class AdminAuditService {
  constructor(
    @InjectRepository(AuditLogEntity)
    private readonly auditRepository: Repository<AuditLogEntity>,
  ) {}

  async find(filters: ListAdminAuditDto): Promise<AuditLogEntity[]> {
    return this.buildQuery(filters)
      .orderBy('audit.createdAt', 'DESC')
      .take(filters.limit ?? 200)
      .getMany();
  }

  async exportCsv(filters: ListAdminAuditDto): Promise<string> {
    const rows = await this.buildQuery(filters)
      .orderBy('audit.createdAt', 'DESC')
      .take(5000)
      .getMany();
    return this.toCsv(rows);
  }

  private buildQuery(filters: ListAdminAuditDto) {
    const qb = this.auditRepository.createQueryBuilder('audit');
    if (filters.organizationId) {
      qb.andWhere('audit.organizationId = :organizationId', {
        organizationId: filters.organizationId,
      });
    }
    if (filters.actorUserId) {
      qb.andWhere('audit.actorUserId = :actorUserId', {
        actorUserId: filters.actorUserId,
      });
    }
    if (filters.action) {
      qb.andWhere('audit.action ILIKE :action', {
        action: `%${filters.action}%`,
      });
    }
    if (filters.targetType) {
      qb.andWhere('audit.targetType = :targetType', {
        targetType: filters.targetType,
      });
    }
    if (filters.origin) {
      qb.andWhere('audit.origin = :origin', { origin: filters.origin });
    }
    return qb;
  }

  private toCsv(rows: AuditLogEntity[]): string {
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

  private valueForColumn(row: AuditLogEntity, column: string): unknown {
    const value = row[column as keyof AuditLogEntity];
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'object' && value !== null) return JSON.stringify(value);
    return value ?? '';
  }

  private csvCell(value: unknown): string {
    const text = String(value).replace(/\r?\n/g, ' ');
    return `"${text.replace(/"/g, '""')}"`;
  }
}
