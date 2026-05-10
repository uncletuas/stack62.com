import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccessControlService } from '../../shared/access-control/access-control.service';
import { ActivityService } from '../activity/activity.service';
import {
  CreateCoworkerMemoryDto,
  ListCoworkerMemoriesDto,
  UpdateCoworkerMemoryDto,
} from './dto/coworker-memory.dto';
import { CoworkerMemoryEntity } from './entities/coworker-memory.entity';

@Injectable()
export class CoworkerMemoryService {
  constructor(
    @InjectRepository(CoworkerMemoryEntity)
    private readonly memoriesRepo: Repository<CoworkerMemoryEntity>,
    private readonly accessControl: AccessControlService,
    private readonly activity: ActivityService,
  ) {}

  async list(filters: ListCoworkerMemoriesDto, actorUserId: string) {
    if (!filters.organizationId || !filters.workspaceId) {
      return [];
    }
    await this.accessControl.assertResolvedAccess(actorUserId, {
      resource: 'coworker',
      action: 'read',
      organizationId: filters.organizationId,
      workspaceId: filters.workspaceId,
      systemId: filters.systemId ?? null,
    });
    return this.memoriesRepo.find({
      where: {
        organizationId: filters.organizationId,
        workspaceId: filters.workspaceId,
        ...(filters.systemId !== undefined
          ? { systemId: filters.systemId }
          : {}),
        ...(filters.kind ? { kind: filters.kind } : {}),
      },
      order: { updatedAt: 'DESC' },
    });
  }

  async create(payload: CreateCoworkerMemoryDto, actorUserId: string) {
    await this.accessControl.assertResolvedAccess(actorUserId, {
      resource: 'coworker',
      action: 'update',
      organizationId: payload.organizationId,
      workspaceId: payload.workspaceId,
      systemId: payload.systemId ?? null,
    });
    const saved = await this.memoriesRepo.save(
      this.memoriesRepo.create({
        organizationId: payload.organizationId,
        workspaceId: payload.workspaceId,
        systemId: payload.systemId ?? null,
        kind: payload.kind ?? 'fact',
        key: payload.key ?? null,
        text: payload.text,
        source: payload.source ?? 'user',
        createdByUserId: actorUserId,
        metadata: null,
      }),
    );
    await this.activity.log({
      organizationId: saved.organizationId,
      workspaceId: saved.workspaceId,
      systemId: saved.systemId,
      actorUserId,
      action: 'coworker_memory.create',
      targetType: 'coworker_memory',
      targetId: saved.id,
      origin: 'user',
      metadata: { kind: saved.kind, key: saved.key },
    });
    return saved;
  }

  async update(
    id: string,
    payload: UpdateCoworkerMemoryDto,
    actorUserId: string,
  ) {
    const entry = await this.memoriesRepo.findOne({ where: { id } });
    if (!entry) throw new NotFoundException('Memory not found.');
    await this.accessControl.assertResolvedAccess(actorUserId, {
      resource: 'coworker',
      action: 'update',
      organizationId: entry.organizationId,
      workspaceId: entry.workspaceId,
      systemId: entry.systemId,
    });
    if (payload.kind !== undefined) entry.kind = payload.kind;
    if (payload.key !== undefined) entry.key = payload.key;
    if (payload.text !== undefined) entry.text = payload.text;
    return this.memoriesRepo.save(entry);
  }

  async remove(id: string, actorUserId: string) {
    const entry = await this.memoriesRepo.findOne({ where: { id } });
    if (!entry) throw new NotFoundException('Memory not found.');
    await this.accessControl.assertResolvedAccess(actorUserId, {
      resource: 'coworker',
      action: 'update',
      organizationId: entry.organizationId,
      workspaceId: entry.workspaceId,
      systemId: entry.systemId,
    });
    await this.memoriesRepo.delete({ id });
    await this.activity.log({
      organizationId: entry.organizationId,
      workspaceId: entry.workspaceId,
      systemId: entry.systemId,
      actorUserId,
      action: 'coworker_memory.delete',
      targetType: 'coworker_memory',
      targetId: id,
      origin: 'user',
      metadata: { kind: entry.kind, key: entry.key },
    });
    return { id };
  }

  /**
   * Returns memories scoped to a system (and the workspace fallbacks) to
   * inject into the Coworker's system preamble. Caps result size to keep
   * the prompt small.
   */
  async forSystemPrompt(
    organizationId: string,
    workspaceId: string,
    systemId: string | null,
    limit = 20,
  ): Promise<CoworkerMemoryEntity[]> {
    if (!organizationId || !workspaceId) return [];
    const qb = this.memoriesRepo.createQueryBuilder('m');
    qb.where('m.organization_id = :organizationId', { organizationId });
    qb.andWhere('m.workspace_id = :workspaceId', { workspaceId });
    if (systemId) {
      qb.andWhere('(m.system_id = :systemId OR m.system_id IS NULL)', {
        systemId,
      });
    } else {
      qb.andWhere('m.system_id IS NULL');
    }
    qb.orderBy(`CASE m.kind WHEN 'preference' THEN 0 WHEN 'fact' THEN 1 ELSE 2 END`, 'ASC');
    qb.addOrderBy('m.updated_at', 'DESC');
    qb.limit(limit);
    return qb.getMany();
  }

}
