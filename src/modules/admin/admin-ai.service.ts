import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, Repository } from 'typeorm';
import { AiRequestLogEntity } from '../ai/entities/ai-request-log.entity';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Read models for the AI Management Center. */
@Injectable()
export class AdminAiService {
  constructor(
    @InjectRepository(AiRequestLogEntity)
    private readonly aiLogs: Repository<AiRequestLogEntity>,
  ) {}

  async usageSummary() {
    const since7d = new Date(Date.now() - 7 * DAY_MS);
    const [total7d, failed7d] = await Promise.all([
      this.aiLogs.count({ where: { createdAt: MoreThan(since7d) } }),
      this.aiLogs.count({
        where: { status: 'failed', createdAt: MoreThan(since7d) },
      }),
    ]);

    const byProvider = await this.aiLogs
      .createQueryBuilder('l')
      .select('l.provider', 'provider')
      .addSelect('COUNT(*)', 'count')
      .where('l.createdAt > :since', { since: since7d })
      .groupBy('l.provider')
      .orderBy('count', 'DESC')
      .getRawMany<{ provider: string; count: string }>();

    const byModel = await this.aiLogs
      .createQueryBuilder('l')
      .select('l.model', 'model')
      .addSelect('COUNT(*)', 'count')
      .where('l.createdAt > :since', { since: since7d })
      .groupBy('l.model')
      .orderBy('count', 'DESC')
      .limit(10)
      .getRawMany<{ model: string; count: string }>();

    return {
      windowDays: 7,
      requests: total7d,
      failures: failed7d,
      successRatePct:
        total7d === 0
          ? 100
          : Math.round(((total7d - failed7d) / total7d) * 1000) / 10,
      byProvider: byProvider.map((r) => ({
        provider: r.provider,
        count: Number(r.count),
      })),
      byModel: byModel.map((r) => ({ model: r.model, count: Number(r.count) })),
    };
  }

  async listLogs(query: {
    status?: string;
    provider?: string;
    page?: number;
    pageSize?: number;
  }) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 25));
    const qb = this.aiLogs.createQueryBuilder('l');
    if (query.status) qb.andWhere('l.status = :status', { status: query.status });
    if (query.provider) {
      qb.andWhere('l.provider = :provider', { provider: query.provider });
    }
    const [rows, total] = await qb
      .orderBy('l.createdAt', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();
    return {
      items: rows.map((r) => ({
        id: r.id,
        provider: r.provider,
        model: r.model,
        taskType: r.taskType,
        status: r.status,
        organizationId: r.organizationId,
        actorUserId: r.actorUserId,
        errorMessage: r.errorMessage,
        promptPreview: r.promptPreview,
        createdAt: r.createdAt,
      })),
      total,
      page,
      pageSize,
    };
  }
}
