import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { PlatformRole } from '../platform-staff.constants';
import {
  OpsRequestEntity,
  OpsRequestType,
} from '../entities/ops-request.entity';
import { SettingsService } from '../settings/settings.service';

const SUPPORTED_TYPES: OpsRequestType[] = [
  'run_migrations',
  'rotate_secret',
  'custom_trigger',
];

// Types that demand a super_admin as the SECOND approver (break-glass tier).
const HIGH_RISK_TYPES: OpsRequestType[] = ['run_migrations'];

// Named safe triggers an operator can fire via an approved custom_trigger.
const TRIGGER_REGISTRY: Record<string, string> = {
  noop: 'No-op trigger (used to validate the approval pipeline).',
};

interface Actor {
  staffId: string;
  role: PlatformRole;
}

/**
 * Engineering operations with a request → approve → execute lifecycle. The
 * requester can never approve their own request (a real second pair of eyes),
 * and high-risk actions (DB migrations) require a super_admin approver. Every
 * transition is persisted on the request row and mirrored to the audit log by
 * the controller.
 */
@Injectable()
export class AdminOpsService {
  private readonly logger = new Logger(AdminOpsService.name);

  constructor(
    @InjectRepository(OpsRequestEntity)
    private readonly opsRepo: Repository<OpsRequestEntity>,
    private readonly dataSource: DataSource,
    private readonly settingsService: SettingsService,
  ) {}

  list(status?: string): Promise<OpsRequestEntity[]> {
    return this.opsRepo.find({
      where: status ? { status: status as OpsRequestEntity['status'] } : {},
      order: { createdAt: 'DESC' },
      take: 100,
    });
  }

  async createRequest(
    actor: Actor,
    type: OpsRequestType,
    payload: Record<string, unknown> | null,
    reason: string | null,
  ): Promise<OpsRequestEntity> {
    if (!SUPPORTED_TYPES.includes(type)) {
      throw new BadRequestException(`Unsupported ops type: ${type}`);
    }
    if (type === 'rotate_secret') {
      const key = payload?.key;
      const value = payload?.value;
      if (typeof key !== 'string' || typeof value !== 'string') {
        throw new BadRequestException(
          'rotate_secret requires payload { key, value }.',
        );
      }
    }
    if (type === 'custom_trigger') {
      const name = payload?.name;
      if (typeof name !== 'string' || !TRIGGER_REGISTRY[name]) {
        throw new BadRequestException(
          `custom_trigger requires a known payload.name. Known: ${Object.keys(
            TRIGGER_REGISTRY,
          ).join(', ')}`,
        );
      }
    }
    const request = this.opsRepo.create({
      type,
      status: 'pending',
      reason: reason ?? null,
      payload: payload ?? null,
      requestedByStaffId: actor.staffId,
    });
    return this.opsRepo.save(request);
  }

  async reject(actor: Actor, requestId: string): Promise<OpsRequestEntity> {
    const request = await this.loadPending(requestId);
    this.assertSecondApprover(actor, request);
    request.status = 'rejected';
    request.decidedByStaffId = actor.staffId;
    request.decidedAt = new Date();
    return this.opsRepo.save(request);
  }

  /** Approve AND execute. Result/error are recorded on the row. */
  async approveAndExecute(
    actor: Actor,
    requestId: string,
  ): Promise<OpsRequestEntity> {
    const request = await this.loadPending(requestId);
    this.assertSecondApprover(actor, request);
    if (
      HIGH_RISK_TYPES.includes(request.type) &&
      actor.role !== 'super_admin'
    ) {
      throw new ForbiddenException(
        'This action requires a Super Admin as the approver.',
      );
    }

    request.status = 'approved';
    request.decidedByStaffId = actor.staffId;
    request.decidedAt = new Date();
    await this.opsRepo.save(request);

    try {
      const result = await this.execute(request, actor);
      request.status = 'executed';
      request.executedAt = new Date();
      request.result = result;
    } catch (err) {
      request.status = 'failed';
      request.executedAt = new Date();
      request.errorMessage = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Ops request ${request.id} (${request.type}) failed: ${request.errorMessage}`,
      );
    }
    return this.opsRepo.save(request);
  }

  private async execute(
    request: OpsRequestEntity,
    actor: Actor,
  ): Promise<Record<string, unknown>> {
    switch (request.type) {
      case 'run_migrations': {
        const ran = await this.dataSource.runMigrations({ transaction: 'each' });
        return { migrations: ran.map((m) => m.name) };
      }
      case 'rotate_secret': {
        const key = String(request.payload?.key);
        const value = String(request.payload?.value);
        await this.settingsService.upsert(key, value, actor.staffId, {
          isSecret: true,
        });
        return { rotated: key };
      }
      case 'custom_trigger': {
        const name = String(request.payload?.name);
        // The registry is intentionally tiny; new safe triggers are added here.
        return { trigger: name, note: TRIGGER_REGISTRY[name] };
      }
      default:
        throw new BadRequestException('No executor for this ops type.');
    }
  }

  private async loadPending(requestId: string): Promise<OpsRequestEntity> {
    const request = await this.opsRepo.findOne({ where: { id: requestId } });
    if (!request) throw new NotFoundException('Ops request not found.');
    if (request.status !== 'pending') {
      throw new BadRequestException(
        `Request is already ${request.status}; only pending requests can be decided.`,
      );
    }
    return request;
  }

  private assertSecondApprover(actor: Actor, request: OpsRequestEntity): void {
    if (actor.staffId === request.requestedByStaffId) {
      throw new ForbiddenException(
        'You cannot approve or reject your own request — a different staff member must decide.',
      );
    }
  }

  knownTriggers(): Record<string, string> {
    return TRIGGER_REGISTRY;
  }
}
