import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BackgroundJobEntity } from '../jobs/entities/background-job.entity';

/**
 * Engineering & Infrastructure Console reads. Restricted to engineers /
 * super admins at the controller. Surfaces queue health and recent jobs;
 * deeper infra controls (migrations, backups) are deliberately out of scope
 * for this first pass and shown as read-only status.
 */
@Injectable()
export class AdminInfraService {
  constructor(
    @InjectRepository(BackgroundJobEntity)
    private readonly jobs: Repository<BackgroundJobEntity>,
  ) {}

  /** Per-queue counts grouped by status — the queue-health widget. */
  async queueHealth() {
    const rows = await this.jobs
      .createQueryBuilder('j')
      .select('j.queueName', 'queue')
      .addSelect('j.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('j.queueName')
      .addGroupBy('j.status')
      .getRawMany<{ queue: string; status: string; count: string }>();

    const byQueue = new Map<string, Record<string, number>>();
    for (const r of rows) {
      const bucket = byQueue.get(r.queue) ?? {};
      bucket[r.status] = Number(r.count);
      byQueue.set(r.queue, bucket);
    }
    return [...byQueue.entries()].map(([queue, statuses]) => ({
      queue,
      statuses,
      total: Object.values(statuses).reduce((a, b) => a + b, 0),
    }));
  }

  async recentJobs(query: { status?: string; page?: number; pageSize?: number }) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 25));
    const qb = this.jobs.createQueryBuilder('j');
    if (query.status) qb.andWhere('j.status = :status', { status: query.status });
    const [rows, total] = await qb
      .orderBy('j.createdAt', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();
    return {
      items: rows.map((j) => ({
        id: j.id,
        queueName: j.queueName,
        jobType: j.jobType,
        status: j.status,
        progress: j.progress,
        organizationId: j.organizationId,
        errorMessage: j.errorMessage,
        startedAt: j.startedAt,
        completedAt: j.completedAt,
        createdAt: j.createdAt,
      })),
      total,
      page,
      pageSize,
    };
  }
}
