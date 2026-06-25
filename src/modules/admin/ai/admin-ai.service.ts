import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiRequestLogEntity } from '../../ai/entities/ai-request-log.entity';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * AI Management Center — read-only platform view over `ai_request_logs`:
 * usage volume, success rate, provider/model mix, and a recent request feed.
 * Cross-tenant; the `ai.read` capability on the controller is the boundary.
 */
@Injectable()
export class AdminAiService {
  constructor(
    @InjectRepository(AiRequestLogEntity)
    private readonly logs: Repository<AiRequestLogEntity>,
  ) {}

  async usage() {
    const since = new Date(Date.now() - 7 * DAY_MS);

    const [requests, failures] = await Promise.all([
      this.logs
        .createQueryBuilder('l')
        .where('l.created_at >= :since', { since })
        .getCount(),
      this.logs
        .createQueryBuilder('l')
        .where('l.created_at >= :since', { since })
        .andWhere('l.status = :s', { s: 'failed' })
        .getCount(),
    ]);

    const byProvider = await this.logs
      .createQueryBuilder('l')
      .select('l.provider', 'provider')
      .addSelect('COUNT(*)', 'count')
      .where('l.created_at >= :since', { since })
      .groupBy('l.provider')
      .orderBy('count', 'DESC')
      .getRawMany<{ provider: string; count: string }>();

    const byModel = await this.logs
      .createQueryBuilder('l')
      .select('l.model', 'model')
      .addSelect('COUNT(*)', 'count')
      .where('l.created_at >= :since', { since })
      .groupBy('l.model')
      .orderBy('count', 'DESC')
      .limit(10)
      .getRawMany<{ model: string; count: string }>();

    const byTask = await this.logs
      .createQueryBuilder('l')
      .select('l.task_type', 'taskType')
      .addSelect('COUNT(*)', 'count')
      .where('l.created_at >= :since', { since })
      .groupBy('l.task_type')
      .orderBy('count', 'DESC')
      .getRawMany<{ taskType: string; count: string }>();

    return {
      windowDays: 7,
      requests,
      failures,
      successRatePct:
        requests === 0
          ? 100
          : Math.round(((requests - failures) / requests) * 1000) / 10,
      providers: byProvider.map((r) => ({
        provider: r.provider,
        count: Number(r.count),
      })),
      models: byModel.map((r) => ({ model: r.model, count: Number(r.count) })),
      tasks: byTask.map((r) => ({ taskType: r.taskType, count: Number(r.count) })),
    };
  }

  async recent(query: { provider?: string; status?: string; limit?: number }) {
    const qb = this.logs.createQueryBuilder('l');
    if (query.provider) qb.andWhere('l.provider = :p', { p: query.provider });
    if (query.status) qb.andWhere('l.status = :s', { s: query.status });
    const rows = await qb
      .orderBy('l.createdAt', 'DESC')
      .take(Math.min(query.limit ?? 100, 200))
      .getMany();
    return rows.map((r) => ({
      id: r.id,
      provider: r.provider,
      model: r.model,
      taskType: r.taskType,
      status: r.status,
      organizationId: r.organizationId,
      errorMessage: r.errorMessage,
      createdAt: r.createdAt,
    }));
  }
}
