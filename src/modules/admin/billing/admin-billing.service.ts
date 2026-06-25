import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PlanEntity } from '../../billing/entities/plan.entity';
import {
  SubscriptionEntity,
  SubscriptionInterval,
  SubscriptionStatus,
} from '../../billing/entities/subscription.entity';

/** Fields an operator may edit on a plan without touching code. */
export interface UpdatePlanInput {
  name?: string;
  tagline?: string;
  monthlyPriceCents?: number;
  yearlyPriceCents?: number;
  currency?: string;
  maxMembers?: number;
  monthlyAiRequests?: number;
  maxActiveSystems?: number;
  storageGb?: number;
  maxWorkflows?: number;
  auditRetentionDays?: number;
  isPublished?: boolean;
}

@Injectable()
export class AdminBillingService {
  constructor(
    @InjectRepository(PlanEntity)
    private readonly plansRepo: Repository<PlanEntity>,
    @InjectRepository(SubscriptionEntity)
    private readonly subscriptionsRepo: Repository<SubscriptionEntity>,
  ) {}

  listPlans(): Promise<PlanEntity[]> {
    return this.plansRepo.find({ order: { sortOrder: 'ASC' } });
  }

  /**
   * Edit a plan's pricing/limits. Stamps customizedAt so the boot-time seed
   * stops reverting it to SEED_PLANS (see BillingService.seedPlans).
   */
  async updatePlan(planId: string, input: UpdatePlanInput): Promise<PlanEntity> {
    const plan = await this.plansRepo.findOne({ where: { id: planId } });
    if (!plan) throw new NotFoundException('Plan not found.');

    const numericKeys: (keyof UpdatePlanInput)[] = [
      'monthlyPriceCents',
      'yearlyPriceCents',
      'maxMembers',
      'monthlyAiRequests',
      'maxActiveSystems',
      'storageGb',
      'maxWorkflows',
      'auditRetentionDays',
    ];
    for (const key of numericKeys) {
      if (input[key] !== undefined) {
        (plan as unknown as Record<string, unknown>)[key] = Number(input[key]);
      }
    }
    if (input.name !== undefined) plan.name = input.name;
    if (input.tagline !== undefined) plan.tagline = input.tagline;
    if (input.currency !== undefined) plan.currency = input.currency;
    if (input.isPublished !== undefined) plan.isPublished = input.isPublished;

    plan.customizedAt = new Date();
    return this.plansRepo.save(plan);
  }

  async listSubscriptions(limit = 100) {
    const subs = await this.subscriptionsRepo.find({
      order: { updatedAt: 'DESC' },
      take: limit,
    });
    const plans = await this.plansRepo.find();
    const planById = new Map(plans.map((p) => [p.id, p]));
    return subs.map((s) => ({
      id: s.id,
      organizationId: s.organizationId,
      planTier: planById.get(s.planId)?.tier ?? 'unknown',
      planName: planById.get(s.planId)?.name ?? 'unknown',
      status: s.status,
      interval: s.interval,
      seats: s.seats,
      currentPeriodEnd: s.currentPeriodEnd,
      cancelAtPeriodEnd: s.cancelAtPeriodEnd,
    }));
  }

  /** Manually move an org onto a plan (e.g. comped enterprise, fix a botched upgrade). */
  async overrideSubscription(
    organizationId: string,
    input: {
      planTier: string;
      status?: SubscriptionStatus;
      interval?: SubscriptionInterval;
      seats?: number;
    },
  ): Promise<SubscriptionEntity> {
    const plan = await this.plansRepo.findOne({
      where: { tier: input.planTier as PlanEntity['tier'] },
    });
    if (!plan) throw new NotFoundException('Plan tier not found.');

    let sub = await this.subscriptionsRepo.findOne({
      where: { organizationId },
    });
    if (!sub) {
      sub = this.subscriptionsRepo.create({ organizationId });
    }
    sub.planId = plan.id;
    sub.status = input.status ?? 'active';
    sub.interval = input.interval ?? sub.interval ?? 'monthly';
    sub.seats = Math.max(1, input.seats ?? sub.seats ?? 1);
    sub.metadata = {
      ...(sub.metadata ?? {}),
      lastAdminOverrideAt: new Date().toISOString(),
    };
    return this.subscriptionsRepo.save(sub);
  }
}
