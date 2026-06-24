import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import {
  AnnouncementEntity,
  type AnnouncementChannel,
  type AnnouncementStatus,
} from './entities/announcement.entity';

/** Content & Communication Management. */
@Injectable()
export class AdminContentService {
  constructor(
    @InjectRepository(AnnouncementEntity)
    private readonly announcements: Repository<AnnouncementEntity>,
    private readonly audit: AuditService,
  ) {}

  list(query: { status?: string; channel?: string }) {
    const where: FindOptionsWhere<AnnouncementEntity> = {};
    if (query.status) where.status = query.status as AnnouncementStatus;
    if (query.channel) where.channel = query.channel as AnnouncementChannel;
    return this.announcements.find({
      where,
      order: { createdAt: 'DESC' },
      take: 200,
    });
  }

  async create(
    input: {
      title: string;
      body: string;
      channel?: AnnouncementChannel;
      audience?: Record<string, unknown> | null;
      scheduledFor?: string | null;
    },
    actorUserId: string,
  ) {
    const scheduledFor = input.scheduledFor ? new Date(input.scheduledFor) : null;
    const announcement = await this.announcements.save(
      this.announcements.create({
        title: input.title,
        body: input.body,
        channel: input.channel ?? 'in_app',
        audience: input.audience ?? { all: true },
        scheduledFor,
        status: scheduledFor ? 'scheduled' : 'draft',
        createdByUserId: actorUserId,
      }),
    );
    await this.audit.log({
      actorUserId,
      action: 'admin.content.announcement_create',
      targetType: 'announcement',
      targetId: announcement.id,
      origin: 'user',
    });
    return announcement;
  }

  async update(
    id: string,
    patch: {
      title?: string;
      body?: string;
      status?: AnnouncementStatus;
      scheduledFor?: string | null;
    },
    actorUserId: string,
  ) {
    const a = await this.announcements.findOne({ where: { id } });
    if (!a) throw new NotFoundException('Announcement not found.');
    if (patch.title !== undefined) a.title = patch.title;
    if (patch.body !== undefined) a.body = patch.body;
    if (patch.scheduledFor !== undefined) {
      a.scheduledFor = patch.scheduledFor ? new Date(patch.scheduledFor) : null;
    }
    if (patch.status) {
      a.status = patch.status;
      if (patch.status === 'sent') a.sentAt = a.sentAt ?? new Date();
    }
    await this.announcements.save(a);
    await this.audit.log({
      actorUserId,
      action: 'admin.content.announcement_update',
      targetType: 'announcement',
      targetId: id,
      origin: 'user',
      afterData: { ...patch },
    });
    return a;
  }
}
