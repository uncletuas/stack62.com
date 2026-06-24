import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Like, Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { AuditLogEntity } from '../audit/entities/audit-log.entity';
import { IpRuleEntity, type IpRuleKind } from './entities/ip-rule.entity';
import {
  SecurityIncidentEntity,
  type IncidentStatus,
} from './entities/security-incident.entity';

/** Security Center: login activity, IP rules, and incidents. */
@Injectable()
export class AdminSecurityService {
  constructor(
    @InjectRepository(AuditLogEntity)
    private readonly auditLogs: Repository<AuditLogEntity>,
    @InjectRepository(IpRuleEntity)
    private readonly ipRules: Repository<IpRuleEntity>,
    @InjectRepository(SecurityIncidentEntity)
    private readonly incidents: Repository<SecurityIncidentEntity>,
    private readonly audit: AuditService,
  ) {}

  /** Recent authentication events, derived from the audit trail. */
  async loginEvents(limit = 50) {
    const rows = await this.auditLogs.find({
      where: { action: Like('auth.%') },
      order: { createdAt: 'DESC' },
      take: Math.min(Math.max(limit, 1), 200),
    });
    return rows.map((r) => ({
      id: r.id,
      action: r.action,
      actorUserId: r.actorUserId,
      organizationId: r.organizationId,
      metadata: r.metadata,
      createdAt: r.createdAt,
    }));
  }

  // ── IP rules ──────────────────────────────────────────────────────────
  listIpRules() {
    return this.ipRules.find({ order: { createdAt: 'DESC' } });
  }

  async createIpRule(
    input: { cidr: string; kind: IpRuleKind; reason?: string | null },
    actorUserId: string,
  ) {
    const rule = await this.ipRules.save(
      this.ipRules.create({
        cidr: input.cidr,
        kind: input.kind,
        reason: input.reason ?? null,
        createdByUserId: actorUserId,
      }),
    );
    await this.audit.log({
      actorUserId,
      action: 'admin.security.ip_rule_create',
      targetType: 'ip_rule',
      targetId: rule.id,
      origin: 'user',
      afterData: { cidr: rule.cidr, kind: rule.kind },
    });
    return rule;
  }

  async deleteIpRule(id: string, actorUserId: string) {
    const rule = await this.ipRules.findOne({ where: { id } });
    if (!rule) throw new NotFoundException('IP rule not found.');
    await this.ipRules.remove(rule);
    await this.audit.log({
      actorUserId,
      action: 'admin.security.ip_rule_delete',
      targetType: 'ip_rule',
      targetId: id,
      origin: 'user',
    });
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

  async updateIncidentStatus(
    id: string,
    status: IncidentStatus,
    actorUserId: string,
  ) {
    const incident = await this.incidents.findOne({ where: { id } });
    if (!incident) throw new NotFoundException('Incident not found.');
    incident.status = status;
    if (status === 'closed' || status === 'mitigated') {
      incident.resolvedAt = incident.resolvedAt ?? new Date();
    }
    await this.incidents.save(incident);
    await this.audit.log({
      actorUserId,
      action: 'admin.security.incident_update',
      targetType: 'security_incident',
      targetId: id,
      origin: 'user',
      afterData: { status },
    });
    return incident;
  }
}
