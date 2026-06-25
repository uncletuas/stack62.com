import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLogEntity } from '../../audit/entities/audit-log.entity';
import { IpRuleEntity, type IpRuleKind } from '../entities/ip-rule.entity';
import {
  SecurityIncidentEntity,
  type IncidentStatus,
} from '../entities/security-incident.entity';

/**
 * Security Center — login/auth activity (derived from the audit trail),
 * IP allow/block rules, and incident tracking. `security.read` / `security.edit`
 * gate the controller.
 */
@Injectable()
export class AdminSecurityService {
  constructor(
    @InjectRepository(AuditLogEntity)
    private readonly audit: Repository<AuditLogEntity>,
    @InjectRepository(IpRuleEntity)
    private readonly ipRules: Repository<IpRuleEntity>,
    @InjectRepository(SecurityIncidentEntity)
    private readonly incidents: Repository<SecurityIncidentEntity>,
  ) {}

  async overview() {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [logins24h, openIncidents, blockRules, allowRules] = await Promise.all([
      this.audit
        .createQueryBuilder('a')
        .where('a.action ILIKE :p', { p: 'auth.%' })
        .andWhere('a.created_at >= :since', { since })
        .getCount(),
      this.incidents.count({ where: { status: 'open' } }),
      this.ipRules.count({ where: { kind: 'block' } }),
      this.ipRules.count({ where: { kind: 'allow' } }),
    ]);
    return {
      authEvents24h: logins24h,
      openIncidents,
      ipRules: { block: blockRules, allow: allowRules },
    };
  }

  /** Recent authentication / security-relevant events from the audit trail. */
  async events(limit = 60) {
    const rows = await this.audit
      .createQueryBuilder('a')
      .where('a.action ILIKE :auth', { auth: 'auth.%' })
      .orWhere('a.action ILIKE :sec', { sec: 'security.%' })
      .orderBy('a.createdAt', 'DESC')
      .take(Math.min(limit, 200))
      .getMany();
    return rows.map((a) => ({
      id: a.id,
      action: a.action,
      actorUserId: a.actorUserId,
      organizationId: a.organizationId,
      origin: a.origin,
      createdAt: a.createdAt,
    }));
  }

  // ── IP rules ──────────────────────────────────────────────────────────
  listIpRules() {
    return this.ipRules.find({ order: { createdAt: 'DESC' } });
  }

  createIpRule(
    input: { cidr: string; kind: IpRuleKind; reason?: string | null },
    staffId: string,
  ) {
    return this.ipRules.save(
      this.ipRules.create({
        cidr: input.cidr,
        kind: input.kind,
        reason: input.reason ?? null,
        createdByStaffId: staffId,
      }),
    );
  }

  async deleteIpRule(id: string) {
    const rule = await this.ipRules.findOne({ where: { id } });
    if (!rule) throw new NotFoundException('IP rule not found.');
    await this.ipRules.remove(rule);
    return { id, deleted: true };
  }

  // ── Incidents ─────────────────────────────────────────────────────────
  listIncidents(query: { status?: string }) {
    const where = query.status ? { status: query.status as IncidentStatus } : {};
    return this.incidents.find({
      where,
      order: { createdAt: 'DESC' },
      take: 200,
    });
  }

  createIncident(
    input: {
      title: string;
      detail?: string;
      severity?: 'low' | 'medium' | 'high' | 'critical';
    },
    staffId: string,
  ) {
    return this.incidents.save(
      this.incidents.create({
        title: input.title,
        detail: input.detail ?? null,
        severity: input.severity ?? 'medium',
        status: 'open',
        source: 'manual',
        createdByStaffId: staffId,
      }),
    );
  }

  async setIncidentStatus(id: string, status: IncidentStatus) {
    const incident = await this.incidents.findOne({ where: { id } });
    if (!incident) throw new NotFoundException('Incident not found.');
    incident.status = status;
    if (status === 'closed' || status === 'mitigated') {
      incident.resolvedAt = incident.resolvedAt ?? new Date();
    }
    return this.incidents.save(incident);
  }
}
