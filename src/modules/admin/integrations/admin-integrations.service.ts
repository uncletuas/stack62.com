import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IntegrationConnectionEntity } from '../../integrations/entities/integration-connection.entity';
import { WebhookEventEntity } from '../../integrations/entities/webhook-event.entity';

/**
 * API & Integration Management — cross-tenant view over integration
 * connections and webhook activity. Read-only; `integrations.read` gates it.
 */
@Injectable()
export class AdminIntegrationsService {
  constructor(
    @InjectRepository(IntegrationConnectionEntity)
    private readonly connections: Repository<IntegrationConnectionEntity>,
    @InjectRepository(WebhookEventEntity)
    private readonly webhooks: Repository<WebhookEventEntity>,
  ) {}

  /** Connection counts grouped by provider + status — the providers grid. */
  async providers() {
    const rows = await this.connections
      .createQueryBuilder('c')
      .select('c.provider_key', 'provider')
      .addSelect('c.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('c.provider_key')
      .addGroupBy('c.status')
      .getRawMany<{ provider: string; status: string; count: string }>();

    const map = new Map<string, Record<string, number>>();
    for (const r of rows) {
      const bucket = map.get(r.provider) ?? {};
      bucket[r.status] = Number(r.count);
      map.set(r.provider, bucket);
    }
    return [...map.entries()].map(([provider, statuses]) => ({
      provider,
      statuses,
      total: Object.values(statuses).reduce((a, b) => a + b, 0),
    }));
  }

  async connectionsList(query: { provider?: string; limit?: number }) {
    const qb = this.connections.createQueryBuilder('c');
    if (query.provider) qb.andWhere('c.provider_key = :p', { p: query.provider });
    const rows = await qb
      .orderBy('c.createdAt', 'DESC')
      .take(Math.min(query.limit ?? 100, 200))
      .getMany();
    return rows.map((c) => ({
      id: c.id,
      providerKey: c.providerKey,
      name: c.name,
      status: c.status,
      organizationId: c.organizationId,
      lastCheckedAt: c.lastCheckedAt,
      createdAt: c.createdAt,
    }));
  }

  /** Recent webhook deliveries + a small status rollup. */
  async webhookFeed(limit = 50) {
    const rows = await this.webhooks.find({
      order: { createdAt: 'DESC' },
      take: Math.min(limit, 200),
    });
    const byStatus = await this.webhooks
      .createQueryBuilder('w')
      .select('w.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('w.status')
      .getRawMany<{ status: string; count: string }>();
    return {
      byStatus: byStatus.map((r) => ({
        status: r.status,
        count: Number(r.count),
      })),
      events: rows.map((w) => ({
        id: w.id,
        providerKey: w.providerKey,
        eventType: w.eventType,
        status: w.status,
        organizationId: w.organizationId,
        errorMessage: w.errorMessage,
        createdAt: w.createdAt,
      })),
    };
  }
}
