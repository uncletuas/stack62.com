import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import {
  PlatformConfigEntity,
  type PlatformConfigCategory,
} from './entities/platform-config.entity';

const SECRET_MASK = '••••••••';

/**
 * URL & Configuration Management Center. Values are versioned and the prior
 * value is retained for a one-step rollback. Secret values are masked in
 * responses.
 */
@Injectable()
export class AdminConfigService {
  constructor(
    @InjectRepository(PlatformConfigEntity)
    private readonly configs: Repository<PlatformConfigEntity>,
    private readonly audit: AuditService,
  ) {}

  async list(query: { category?: string }) {
    const where = query.category
      ? { category: query.category as PlatformConfigCategory }
      : {};
    const rows = await this.configs.find({
      where,
      order: { category: 'ASC', key: 'ASC' },
    });
    return rows.map((r) => this.present(r));
  }

  async upsert(
    input: {
      key: string;
      value: string | null;
      category?: PlatformConfigCategory;
      description?: string | null;
      isSecret?: boolean;
    },
    actorUserId: string,
  ) {
    let row = await this.configs.findOne({ where: { key: input.key } });
    if (row) {
      row.previousValue = row.value;
      row.value = input.value;
      row.version += 1;
      if (input.category) row.category = input.category;
      if (input.description !== undefined) row.description = input.description;
      if (input.isSecret !== undefined) row.isSecret = input.isSecret;
      row.updatedByUserId = actorUserId;
    } else {
      row = this.configs.create({
        key: input.key,
        value: input.value,
        category: input.category ?? 'general',
        description: input.description ?? null,
        isSecret: input.isSecret ?? false,
        version: 1,
        updatedByUserId: actorUserId,
      });
    }
    await this.configs.save(row);
    await this.audit.log({
      actorUserId,
      action: 'admin.config.upsert',
      targetType: 'platform_config',
      targetId: row.id,
      origin: 'user',
      // Never write a secret value into the audit trail.
      afterData: { key: row.key, version: row.version },
    });
    return this.present(row);
  }

  /** Roll a value back to its immediately-previous version. */
  async rollback(key: string, actorUserId: string) {
    const row = await this.configs.findOne({ where: { key } });
    if (!row) throw new NotFoundException('Config key not found.');
    if (row.previousValue === null) {
      throw new NotFoundException('No previous value to roll back to.');
    }
    const current = row.value;
    row.value = row.previousValue;
    row.previousValue = current;
    row.version += 1;
    row.updatedByUserId = actorUserId;
    await this.configs.save(row);
    await this.audit.log({
      actorUserId,
      action: 'admin.config.rollback',
      targetType: 'platform_config',
      targetId: row.id,
      origin: 'user',
      afterData: { key: row.key, version: row.version },
    });
    return this.present(row);
  }

  private present(row: PlatformConfigEntity) {
    return {
      id: row.id,
      key: row.key,
      value: row.isSecret ? (row.value ? SECRET_MASK : null) : row.value,
      category: row.category,
      description: row.description,
      isSecret: row.isSecret,
      version: row.version,
      updatedByUserId: row.updatedByUserId,
      updatedAt: row.updatedAt,
    };
  }
}
