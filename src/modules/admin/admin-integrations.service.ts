import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IntegrationConnectionEntity } from '../integrations/entities/integration-connection.entity';

/** Cross-tenant view of integration connections for the API & Integrations module. */
@Injectable()
export class AdminIntegrationsService {
  constructor(
    @InjectRepository(IntegrationConnectionEntity)
    private readonly connections: Repository<IntegrationConnectionEntity>,
  ) {}

  /** Connection counts grouped by provider + status — the providers grid. */
  async providerSummary() {
    const rows = await this.connections
      .createQueryBuilder('c')
      .select('c.providerKey', 'provider')
      .addSelect('c.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('c.providerKey')
      .addGroupBy('c.status')
      .getRawMany<{ provider: string; status: string; count: string }>();

    const byProvider = new Map<string, Record<string, number>>();
    for (const r of rows) {
      const bucket = byProvider.get(r.provider) ?? {};
      bucket[r.status] = Number(r.count);
      byProvider.set(r.provider, bucket);
    }
    return [...byProvider.entries()].map(([provider, statuses]) => ({
      provider,
      statuses,
      total: Object.values(statuses).reduce((a, b) => a + b, 0),
    }));
  }

  async listConnections(query: { provider?: string; page?: number; pageSize?: number }) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 25));
    const qb = this.connections.createQueryBuilder('c');
    if (query.provider) {
      qb.andWhere('c.providerKey = :p', { p: query.provider });
    }
    const [rows, total] = await qb
      .orderBy('c.createdAt', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();
    return {
      items: rows.map((c) => ({
        id: c.id,
        providerKey: c.providerKey,
        status: c.status,
        organizationId: c.organizationId,
        createdAt: c.createdAt,
      })),
      total,
      page,
      pageSize,
    };
  }
}
