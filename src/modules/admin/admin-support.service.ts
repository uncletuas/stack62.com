import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import {
  SupportTicketEntity,
  type SupportTicketPriority,
  type SupportTicketStatus,
} from './entities/support-ticket.entity';

/** Support & Customer Operations Center. */
@Injectable()
export class AdminSupportService {
  constructor(
    @InjectRepository(SupportTicketEntity)
    private readonly tickets: Repository<SupportTicketEntity>,
    private readonly audit: AuditService,
  ) {}

  async list(query: { status?: string; priority?: string; page?: number; pageSize?: number }) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 25));
    const qb = this.tickets.createQueryBuilder('t');
    if (query.status) qb.andWhere('t.status = :status', { status: query.status });
    if (query.priority) {
      qb.andWhere('t.priority = :priority', { priority: query.priority });
    }
    const [rows, total] = await qb
      .orderBy('t.createdAt', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();
    return { items: rows, total, page, pageSize };
  }

  /** Open/SLA/CSAT counters for the support dashboard cards. */
  async stats() {
    const [open, pending, resolved, breached] = await Promise.all([
      this.tickets.count({ where: { status: 'open' } }),
      this.tickets.count({ where: { status: 'pending' } }),
      this.tickets.count({ where: { status: 'resolved' } }),
      this.tickets
        .createQueryBuilder('t')
        .where("t.status NOT IN ('resolved','closed')")
        .andWhere('t.firstResponseAt IS NULL')
        .andWhere(
          "t.createdAt < NOW() - (t.slaMinutes || ' minutes')::interval",
        )
        .getCount(),
    ]);
    const csatRow = await this.tickets
      .createQueryBuilder('t')
      .select('AVG(t.csatScore)', 'avg')
      .where('t.csatScore IS NOT NULL')
      .getRawOne<{ avg: string | null }>();
    return {
      open,
      pending,
      resolved,
      slaBreached: breached,
      avgCsat: csatRow?.avg ? Math.round(Number(csatRow.avg) * 100) / 100 : null,
    };
  }

  async create(
    input: {
      subject: string;
      body?: string;
      priority?: SupportTicketPriority;
      organizationId?: string;
      requesterUserId?: string;
    },
    actorUserId: string,
  ) {
    const ticket = await this.tickets.save(
      this.tickets.create({
        subject: input.subject,
        body: input.body ?? null,
        priority: input.priority ?? 'normal',
        organizationId: input.organizationId ?? null,
        requesterUserId: input.requesterUserId ?? null,
        status: 'open',
      }),
    );
    await this.audit.log({
      actorUserId,
      action: 'admin.support.ticket_create',
      targetType: 'support_ticket',
      targetId: ticket.id,
      origin: 'user',
    });
    return ticket;
  }

  async update(
    id: string,
    patch: {
      status?: SupportTicketStatus;
      priority?: SupportTicketPriority;
      assigneeUserId?: string | null;
      csatScore?: number | null;
    },
    actorUserId: string,
  ) {
    const ticket = await this.tickets.findOne({ where: { id } });
    if (!ticket) throw new NotFoundException('Ticket not found.');
    if (patch.status) {
      ticket.status = patch.status;
      if (patch.status === 'resolved' || patch.status === 'closed') {
        ticket.resolvedAt = ticket.resolvedAt ?? new Date();
      }
    }
    if (patch.priority) ticket.priority = patch.priority;
    if (patch.assigneeUserId !== undefined) {
      ticket.assigneeUserId = patch.assigneeUserId;
      ticket.firstResponseAt = ticket.firstResponseAt ?? new Date();
    }
    if (patch.csatScore !== undefined) ticket.csatScore = patch.csatScore;
    await this.tickets.save(ticket);
    await this.audit.log({
      actorUserId,
      action: 'admin.support.ticket_update',
      targetType: 'support_ticket',
      targetId: id,
      origin: 'user',
      afterData: { ...patch },
    });
    return ticket;
  }
}
