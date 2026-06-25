import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccessControlService } from '../../shared/access-control/access-control.service';
import { ActivityService } from '../activity/activity.service';
import { UpdateEmailAgentDto } from './dto/update-email-agent.dto';
import { EmailAgentConfigEntity } from './entities/email-agent-config.entity';
import {
  type BusinessHours,
  DEFAULT_BUSINESS_HOURS,
} from './entities/whatsapp-agent-config.entity';

/**
 * Owns the per-workspace email-assistant configuration and the schedule logic
 * deciding whether the coworker may reply right now. Mirrors WhatsAppAgentService.
 */
@Injectable()
export class EmailAgentService {
  constructor(
    @InjectRepository(EmailAgentConfigEntity)
    private readonly configRepo: Repository<EmailAgentConfigEntity>,
    private readonly accessControl: AccessControlService,
    private readonly activity: ActivityService,
  ) {}

  async getOrCreate(
    organizationId: string,
    workspaceId: string,
    actorUserId: string,
  ): Promise<EmailAgentConfigEntity> {
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
  ): Promise<EmailAgentConfigEntity | null> {
    return this.configRepo.findOne({ where: { organizationId, workspaceId } });
  }

  async update(
    actorUserId: string,
    dto: UpdateEmailAgentDto,
  ): Promise<EmailAgentConfigEntity> {
    await this.accessControl.assertResolvedAccess(actorUserId, {
      resource: 'organization',
      action: 'update',
      organizationId: dto.organizationId,
      workspaceId: dto.workspaceId,
    });
    const config = await this.loadOrCreate(dto.organizationId, dto.workspaceId);
    if (dto.enabled !== undefined) config.enabled = dto.enabled;
    if (dto.autoSend !== undefined) config.autoSend = dto.autoSend;
    if (dto.responseSchedule !== undefined)
      config.responseSchedule = dto.responseSchedule;
    if (dto.businessHours !== undefined)
      config.businessHours = dto.businessHours;
    if (dto.tone !== undefined) config.tone = dto.tone;
    if (dto.identityName !== undefined) config.identityName = dto.identityName;
    if (dto.identityRole !== undefined) config.identityRole = dto.identityRole;
    if (dto.signature !== undefined) config.signature = dto.signature;
    if (dto.businessInfo !== undefined) config.businessInfo = dto.businessInfo;
    if (dto.maxAutoRepliesPerDay !== undefined)
      config.maxAutoRepliesPerDay = dto.maxAutoRepliesPerDay;
    const saved = await this.configRepo.save(config);
    await this.activity.log({
      organizationId: dto.organizationId,
      workspaceId: dto.workspaceId,
      actorUserId,
      action: 'coworker.email_agent.update',
      targetType: 'email_agent_config',
      targetId: saved.id,
      origin: 'user',
      metadata: { enabled: saved.enabled, autoSend: saved.autoSend },
    });
    return saved;
  }

  isWithinSchedule(
    config: EmailAgentConfigEntity,
    now: Date = new Date(),
  ): boolean {
    if (config.responseSchedule === 'always') return true;
    const hours = config.businessHours ?? DEFAULT_BUSINESS_HOURS;
    const open = this.isWithinBusinessHours(hours, now);
    return config.responseSchedule === 'business_hours' ? open : !open;
  }

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
      const minutesNow = (Number(hourStr) % 24) * 60 + Number(minStr);
      const startMinutes = this.toMinutes(hours.start);
      const endMinutes = this.toMinutes(hours.end);
      if (endMinutes <= startMinutes) {
        return minutesNow >= startMinutes || minutesNow < endMinutes;
      }
      return minutesNow >= startMinutes && minutesNow < endMinutes;
    } catch {
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
        enabled: false,
        autoSend: false,
        responseSchedule: 'always',
        businessHours: DEFAULT_BUSINESS_HOURS,
        tone: 'Warm, helpful, and professional. Clear and concise.',
        maxAutoRepliesPerDay: 20,
      }),
    );
  }
}
