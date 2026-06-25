import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Repository } from 'typeorm';
import {
  AnnouncementEntity,
  type AnnouncementChannel,
  type AnnouncementStatus,
} from '../entities/announcement.entity';

/** Content & Communication Management — announcements / campaigns. */
@Injectable()
export class AdminContentService {
  constructor(
    @InjectRepository(AnnouncementEntity)
    private readonly announcements: Repository<AnnouncementEntity>,
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
    staffId: string,
  ) {
    const scheduledFor = input.scheduledFor ? new Date(input.scheduledFor) : null;
    return this.announcements.save(
      this.announcements.create({
        title: input.title,
        body: input.body,
        channel: input.channel ?? 'in_app',
        audience: input.audience ?? { all: true },
        scheduledFor,
        status: scheduledFor ? 'scheduled' : 'draft',
        createdByStaffId: staffId,
      }),
    );
  }

  async update(
    id: string,
    patch: {
      title?: string;
      body?: string;
      status?: AnnouncementStatus;
      scheduledFor?: string | null;
    },
  ) {
    const row = await this.announcements.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Announcement not found.');
    if (patch.title !== undefined) row.title = patch.title;
    if (patch.body !== undefined) row.body = patch.body;
    if (patch.scheduledFor !== undefined) {
      row.scheduledFor = patch.scheduledFor ? new Date(patch.scheduledFor) : null;
    }
    if (patch.status) {
      row.status = patch.status;
      if (patch.status === 'sent') row.sentAt = row.sentAt ?? new Date();
    }
    return this.announcements.save(row);
  }
}
