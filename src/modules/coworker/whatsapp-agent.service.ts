import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccessControlService } from '../../shared/access-control/access-control.service';
import { ActivityService } from '../activity/activity.service';
import { UpdateWhatsAppAgentDto } from './dto/update-whatsapp-agent.dto';
import {
  type BusinessHours,
  DEFAULT_BUSINESS_HOURS,
  WhatsAppAgentConfigEntity,
} from './entities/whatsapp-agent-config.entity';

/**
 * Owns the per-workspace WhatsApp auto-reply configuration and the schedule
 * logic that decides whether the coworker is allowed to reply right now.
 */
@Injectable()
export class WhatsAppAgentService {
  constructor(
    @InjectRepository(WhatsAppAgentConfigEntity)
    private readonly configRepo: Repository<WhatsAppAgentConfigEntity>,
    private readonly accessControl: AccessControlService,
    private readonly activity: ActivityService,
  ) {}

  async getOrCreate(
    organizationId: string,
    workspaceId: string,
    actorUserId: string,
  ): Promise<WhatsAppAgentConfigEntity> {
    await this.accessControl.assertResolvedAccess(actorUserId, {
      resource: 'organization',
      action: 'read',
      organizationId,
      workspaceId,
    });
    return this.loadOrCreate(organizationId, workspaceId);
  }

  /** Internal load (no access check) for the responder. */
  async getForResponder(
    organizationId: string,
    workspaceId: string,
  ): Promise<WhatsAppAgentConfigEntity | null> {
    return this.configRepo.findOne({
      where: { organizationId, workspaceId },
    });
  }

  async update(
    actorUserId: string,
    dto: UpdateWhatsAppAgentDto,
  ): Promise<WhatsAppAgentConfigEntity> {
    await this.accessControl.assertResolvedAccess(actorUserId, {
      resource: 'organization',
      action: 'update',
      organizationId: dto.organizationId,
      workspaceId: dto.workspaceId,
    });
    const config = await this.loadOrCreate(dto.organizationId, dto.workspaceId);
    if (dto.autoReplyEnabled !== undefined)
      config.autoReplyEnabled = dto.autoReplyEnabled;
    if (dto.responseSchedule !== undefined)
      config.responseSchedule = dto.responseSchedule;
    if (dto.businessHours !== undefined)
      config.businessHours = dto.businessHours;
    if (dto.tone !== undefined) config.tone = dto.tone;
    if (dto.responseDelaySeconds !== undefined)
      config.responseDelaySeconds = dto.responseDelaySeconds;
    if (dto.identityName !== undefined) config.identityName = dto.identityName;
    if (dto.identityRole !== undefined) config.identityRole = dto.identityRole;
    if (dto.signature !== undefined) config.signature = dto.signature;
    if (dto.businessInfo !== undefined) config.businessInfo = dto.businessInfo;
    if (dto.awayMessage !== undefined) config.awayMessage = dto.awayMessage;
    if (dto.maxAutoRepliesPerDay !== undefined)
      config.maxAutoRepliesPerDay = dto.maxAutoRepliesPerDay;
    const saved = await this.configRepo.save(config);
    await this.activity.log({
      organizationId: dto.organizationId,
      workspaceId: dto.workspaceId,
      actorUserId,
      action: 'coworker.whatsapp_agent.update',
      targetType: 'whatsapp_agent_config',
      targetId: saved.id,
      origin: 'user',
      metadata: { autoReplyEnabled: saved.autoReplyEnabled },
    });
    return saved;
  }

  /**
   * Whether the coworker is allowed to auto-reply at `now`, given the schedule.
   * Returns `withinWindow` (used to decide reply vs. away-message).
   */
  isWithinSchedule(
    config: WhatsAppAgentConfigEntity,
    now: Date = new Date(),
  ): boolean {
    if (config.responseSchedule === 'always') return true;
    const hours = config.businessHours ?? DEFAULT_BUSINESS_HOURS;
    const open = this.isWithinBusinessHours(hours, now);
    return config.responseSchedule === 'business_hours' ? open : !open;
  }

  /** True if `now` falls inside the configured business-hours window. */
  private isWithinBusinessHours(hours: BusinessHours, now: Date): boolean {
    try {
      const fmt = new Intl.DateTimeFormat('en-US', {
        timeZone: hours.timezone,
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
      const parts = fmt.formatToParts(now);
      const weekdayStr =
        parts.find((p) => p.type === 'weekday')?.value ?? 'Mon';
      const hourStr = parts.find((p) => p.type === 'hour')?.value ?? '00';
      const minStr = parts.find((p) => p.type === 'minute')?.value ?? '00';
      const weekdayMap: Record<string, number> = {
        Sun: 0,
        Mon: 1,
        Tue: 2,
        Wed: 3,
        Thu: 4,
        Fri: 5,
        Sat: 6,
      };
      const day = weekdayMap[weekdayStr] ?? 1;
      if (!hours.days.includes(day)) return false;
      // "24" can appear for midnight in some runtimes; normalize to 0.
      const minutesNow = (Number(hourStr) % 24) * 60 + Number(minStr);
      const startMinutes = this.toMinutes(hours.start);
      const endMinutes = this.toMinutes(hours.end);
      if (endMinutes <= startMinutes) {
        // Overnight window (e.g. 22:00–06:00).
        return minutesNow >= startMinutes || minutesNow < endMinutes;
      }
      return minutesNow >= startMinutes && minutesNow < endMinutes;
    } catch {
      // Bad timezone string etc. — fail open so messages still get answered.
      return true;
    }
  }

  private toMinutes(hhmm: string): number {
    const [h, m] = hhmm.split(':').map((v) => Number(v));
    return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
  }

  private async loadOrCreate(organizationId: string, workspaceId: string) {
    const existing = await this.configRepo.findOne({
      where: { organizationId, workspaceId },
    });
    if (existing) return existing;
    return this.configRepo.save(
      this.configRepo.create({
        organizationId,
        workspaceId,
        autoReplyEnabled: false,
        responseSchedule: 'always',
        businessHours: DEFAULT_BUSINESS_HOURS,
        tone: 'Warm, helpful, and professional. Keep replies short and clear.',
        responseDelaySeconds: 5,
        maxAutoRepliesPerDay: 0,
      }),
    );
  }
}
