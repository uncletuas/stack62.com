import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccessControlService } from '../../shared/access-control/access-control.service';
import { ActivityService } from '../activity/activity.service';
import { UpdateCoworkerDto } from './dto/update-coworker.dto';
import { CoworkerMemoryEntity } from './entities/coworker-memory.entity';
import {
  CoworkerEntity,
  DEFAULT_COWORKER_ROLE,
  DEFAULT_PERMISSIONS,
  type CoworkerPermissions,
  type CoworkerRole,
} from './entities/coworker.entity';

@Injectable()
export class CoworkerService {
  constructor(
    @InjectRepository(CoworkerEntity)
    private readonly coworkerRepo: Repository<CoworkerEntity>,
    private readonly accessControl: AccessControlService,
    private readonly activity: ActivityService,
  ) {}

  /** Returns the coworker config for the workspace, creating defaults if absent. */
  async getOrCreate(
    organizationId: string,
    workspaceId: string,
    actorUserId: string,
  ): Promise<CoworkerEntity> {
    await this.accessControl.assertResolvedAccess(actorUserId, {
      resource: 'organization',
      action: 'read',
      organizationId,
      workspaceId,
    });
    const existing = await this.coworkerRepo.findOne({
      where: { organizationId, workspaceId },
    });
    if (existing) {
      // Backfill permissions/role if older row was missing fields.
      existing.permissions = {
        ...DEFAULT_PERMISSIONS,
        ...(existing.permissions ?? {}),
      };
      if (!existing.role) existing.role = DEFAULT_COWORKER_ROLE;
      return existing;
    }
    return this.coworkerRepo.save(
      this.coworkerRepo.create({
        organizationId,
        workspaceId,
        name: 'Ada',
        description: null,
        model: null,
        voice: null,
        defaultAutopilot: false,
        permissions: DEFAULT_PERMISSIONS,
        role: DEFAULT_COWORKER_ROLE,
      }),
    );
  }

  async update(
    organizationId: string,
    workspaceId: string,
    actorUserId: string,
    dto: UpdateCoworkerDto,
  ): Promise<CoworkerEntity> {
    await this.accessControl.assertResolvedAccess(actorUserId, {
      resource: 'organization',
      action: 'update',
      organizationId,
      workspaceId,
    });
    const coworker = await this.getOrCreate(
      organizationId,
      workspaceId,
      actorUserId,
    );
    if (dto.name !== undefined) coworker.name = dto.name;
    if (dto.description !== undefined) coworker.description = dto.description;
    if (dto.model !== undefined) coworker.model = dto.model;
    if (dto.voice !== undefined) coworker.voice = dto.voice;
    if (dto.defaultAutopilot !== undefined)
      coworker.defaultAutopilot = dto.defaultAutopilot;
    if (dto.autonomousMode !== undefined)
      coworker.autonomousMode = dto.autonomousMode;
    if (dto.autonomousMaxActionLevel !== undefined)
      coworker.autonomousMaxActionLevel = dto.autonomousMaxActionLevel;
    if (dto.permissions) {
      coworker.permissions = {
        ...DEFAULT_PERMISSIONS,
        ...(coworker.permissions ?? {}),
        ...(dto.permissions as Partial<CoworkerPermissions>),
      };
    }
    if (dto.role !== undefined) coworker.role = dto.role;
    const saved = await this.coworkerRepo.save(coworker);
    await this.activity.log({
      organizationId,
      workspaceId,
      actorUserId,
      action: 'coworker.update',
      targetType: 'coworker',
      targetId: saved.id,
      origin: 'user',
      metadata: { fields: Object.keys(dto) },
    });
    return saved;
  }

  buildSystemPreamble(
    coworker: CoworkerEntity,
    autopilot: boolean,
    memories: CoworkerMemoryEntity[] = [],
  ): string {
    const lines: string[] = [];
    const role = coworker.role ?? DEFAULT_COWORKER_ROLE;
    lines.push(
      `You are ${coworker.name}, a coworker hired by this workspace, holding the "${role}" role. Your role caps what you can do — if a tool requires a higher role, decline and explain.`,
    );
    if (coworker.description) lines.push(coworker.description);
    if (coworker.voice) lines.push(`Tone and voice: ${coworker.voice}.`);
    if (memories.length > 0) {
      const preferences = memories.filter((m) => m.kind === 'preference');
      const facts = memories.filter((m) => m.kind === 'fact');
      const episodes = memories.filter((m) => m.kind === 'episode');
      const formatList = (items: CoworkerMemoryEntity[]) =>
        items
          .slice(0, 12)
          .map((m) => `- ${m.key ? `${m.key}: ` : ''}${m.text}`)
          .join('\n');
      lines.push('What you remember about this workspace:');
      if (preferences.length)
        lines.push(`Preferences:\n${formatList(preferences)}`);
      if (facts.length) lines.push(`Facts:\n${formatList(facts)}`);
      if (episodes.length)
        lines.push(`Recent episodes:\n${formatList(episodes)}`);
      lines.push(
        'Use these as background context. Do not repeat them back unless asked.',
      );
    }
    lines.push(
      autopilot
        ? 'Autopilot is ON: complete every reasonable request without asking for confirmation, except for irreversible destructive actions (deleting data, sending money). Be decisive.'
        : 'Autopilot is OFF: confirm before sending external messages, applying schema-changing plans, or making payments.',
    );
    const perms = coworker.permissions ?? DEFAULT_PERMISSIONS;
    const denied: string[] = [];
    if (!perms.canSendEmail) denied.push('sending email');
    if (!perms.canSendMessage) denied.push('sending chat / WhatsApp / SMS');
    if (!perms.canApplyPlans) denied.push('applying plans without approval');
    if (!perms.canSendPayments) denied.push('initiating payments');
    if (!perms.canCreateRecords) denied.push('creating records');
    if (denied.length) {
      lines.push(
        `You may NOT do the following without the user's explicit go-ahead in this turn: ${denied.join(', ')}.`,
      );
    }
    return lines.join('\n');
  }
}
