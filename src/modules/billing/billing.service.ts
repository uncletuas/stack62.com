import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ActivityService } from '../activity/activity.service';
import { AccessControlService } from '../../shared/access-control/access-control.service';
import { PlanEntity, PlanTier } from './entities/plan.entity';
import {
  SubscriptionEntity,
  SubscriptionInterval,
} from './entities/subscription.entity';
import {
  UsageCounterEntity,
  UsageMetric,
} from './entities/usage-counter.entity';
import { SEED_PLANS } from './plans.seed';

@Injectable()
export class BillingService implements OnModuleInit {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    @InjectRepository(PlanEntity)
    private readonly plansRepo: Repository<PlanEntity>,
    @InjectRepository(SubscriptionEntity)
    private readonly subscriptionsRepo: Repository<SubscriptionEntity>,
    @InjectRepository(UsageCounterEntity)
    private readonly countersRepo: Repository<UsageCounterEntity>,
    private readonly activityService: ActivityService,
    private readonly accessControl: AccessControlService,
  ) {}

  async onModuleInit() {
    await this.seedPlans();
  }

  // ── Plan catalog ─────────────────────────────────────────────────────

  async listPublishedPlans(): Promise<PlanEntity[]> {
    return this.plansRepo.find({
      where: { isPublished: true },
      order: { sortOrder: 'ASC' },
    });
  }

  async findPlanByTier(tier: PlanTier): Promise<PlanEntity | null> {
    return this.plansRepo.findOne({ where: { tier } });
  }

  // ── Subscription state ────────────────────────────────────────────────

  /**
   * Returns the org's current subscription, creating a free-plan default
   * if none exists yet (this is normal for orgs created before the
   * billing module shipped).
   */
  async getOrCreateForOrg(organizationId: string): Promise<{
    subscription: SubscriptionEntity;
    plan: PlanEntity;
  }> {
    let sub = await this.subscriptionsRepo.findOne({
      where: { organizationId },
    });
    if (!sub) {
      const free = await this.findPlanByTier('free');
      if (!free) {
        throw new NotFoundException(
          'Free plan missing — billing seed has not run.',
        );
      }
      sub = await this.subscriptionsRepo.save(
        this.subscriptionsRepo.create({
          organizationId,
          planId: free.id,
          status: 'active',
          interval: 'monthly',
          seats: 1,
        }),
      );
    }
    const plan = await this.plansRepo.findOne({ where: { id: sub.planId } });
    if (!plan) throw new NotFoundException('Plan not found.');
    return { subscription: sub, plan };
  }

  async fetchOrgSummary(organizationId: string, actorUserId: string) {
    await this.accessControl.assertResolvedAccess(actorUserId, {
      resource: 'organization',
      action: 'read',
      organizationId,
    });
    const { subscription, plan } = await this.getOrCreateForOrg(organizationId);
    const usage = await this.fetchUsageSnapshot(organizationId);
    return { subscription, plan, usage };
  }

  /**
   * Stub for Stripe Checkout. The real wire-up needs:
   *   - STRIPE_SECRET_KEY env
   *   - Plans seeded with stripeMonthlyPriceId / stripeYearlyPriceId
   *   - A POST /v1/billing/webhook endpoint validating signatures
   *
   * For now: optimistically updates the subscription to the chosen plan
   * so the rest of the app can flex with the new limits during dev.
   * The operator must replace this with a real Stripe Checkout session
   * before launch.
   */
  async startCheckout(input: {
    organizationId: string;
    actorUserId: string;
    targetTier: PlanTier;
    interval: SubscriptionInterval;
    seats: number;
  }): Promise<{ checkoutUrl: string | null; status: string }> {
    await this.accessControl.assertResolvedAccess(input.actorUserId, {
      resource: 'organization',
      action: 'update',
      organizationId: input.organizationId,
    });
    const plan = await this.findPlanByTier(input.targetTier);
    if (!plan) throw new NotFoundException('Plan not found.');

    if (input.targetTier === 'free') {
      // Downgrade to free is allowed without going through Stripe.
      await this.applyPlanChange(
        input.organizationId,
        plan,
        input.interval,
        input.seats,
        input.actorUserId,
        'downgrade_to_free',
      );
      return { checkoutUrl: null, status: 'downgraded_to_free' };
    }

    if (input.targetTier === 'enterprise') {
      // Enterprise is sales-led — return a contact link instead of a
      // Checkout URL. The frontend handles this branch.
      return { checkoutUrl: 'mailto:sales@stack62.com', status: 'contact_sales' };
    }

    // TODO(stripe): replace this dev-only path with a real Stripe
    // Checkout session create call once STRIPE_SECRET_KEY and the price
    // IDs on PlanEntity are populated.
    this.logger.warn(
      `[stub] Stripe not wired — auto-applying plan ${plan.tier} for org ${input.organizationId}.`,
    );
    await this.applyPlanChange(
      input.organizationId,
      plan,
      input.interval,
      input.seats,
      input.actorUserId,
      'stub_apply_plan',
    );
    return { checkoutUrl: null, status: 'stub_applied' };
  }

  private async applyPlanChange(
    organizationId: string,
    plan: PlanEntity,
    interval: SubscriptionInterval,
    seats: number,
    actorUserId: string,
    action: string,
  ) {
    let sub = await this.subscriptionsRepo.findOne({
      where: { organizationId },
    });
    if (!sub) {
      sub = this.subscriptionsRepo.create({ organizationId });
    }
    sub.planId = plan.id;
    sub.interval = interval;
    sub.seats = Math.max(1, seats);
    sub.status = 'active';
    sub.currentPeriodStart = new Date();
    sub.currentPeriodEnd = new Date(
      Date.now() +
        (interval === 'yearly' ? 365 : 30) * 24 * 60 * 60 * 1000,
    );
    sub.cancelAtPeriodEnd = false;
    await this.subscriptionsRepo.save(sub);
    await this.activityService.log({
      organizationId,
      actorUserId,
      action: `billing.${action}`,
      targetType: 'subscription',
      targetId: sub.id,
      origin: 'user',
      metadata: { planTier: plan.tier, interval, seats },
    });
  }

  // ── Usage / quota gating ──────────────────────────────────────────────

  async incrementUsage(
    organizationId: string,
    metric: UsageMetric,
    delta = 1,
  ): Promise<number> {
    const period = currentPeriod();
    let row = await this.countersRepo.findOne({
      where: { organizationId, metric, period },
    });
    if (!row) {
      row = this.countersRepo.create({
        organizationId,
        metric,
        period,
        count: 0,
      });
    }
    row.count += delta;
    await this.countersRepo.save(row);
    return row.count;
  }

  /**
   * Throws ForbiddenException with a structured payload when the org has
   * exhausted its quota for `metric`. Callers should use this at the top
   * of any AI-credit-consuming controller path.
   */
  async assertWithinQuota(
    organizationId: string,
    metric: UsageMetric,
  ): Promise<void> {
    const { plan } = await this.getOrCreateForOrg(organizationId);
    const cap = capForMetric(plan, metric);
    if (cap === -1) return; // unlimited
    const period = capIsLifetime(plan, metric) ? 'lifetime' : currentPeriod();
    const row = await this.countersRepo.findOne({
      where: { organizationId, metric, period },
    });
    const current = row?.count ?? 0;
    if (current >= cap) {
      throw new ForbiddenException({
        statusCode: 402,
        code: 'BILLING_QUOTA_EXHAUSTED',
        metric,
        plan: plan.tier,
        used: current,
        cap,
        upgradePath: '/pricing',
        message:
          plan.tier === 'free'
            ? 'You have used your free trial of this feature. Upgrade to Stack62 Starter to keep going.'
            : `Your ${plan.name} plan allows ${cap} ${metric.replace(/_/g, ' ')} this period — you've used ${current}. Upgrade for more.`,
      });
    }
  }

  async fetchUsageSnapshot(
    organizationId: string,
  ): Promise<Record<UsageMetric, { used: number; cap: number }>> {
    const { plan } = await this.getOrCreateForOrg(organizationId);
    const metrics: UsageMetric[] = [
      'ai_requests',
      'plan_apply',
      'document_generate',
      'system_deploy',
      'workflow_run',
    ];
    const snapshot = {} as Record<UsageMetric, { used: number; cap: number }>;
    for (const metric of metrics) {
      const period = capIsLifetime(plan, metric) ? 'lifetime' : currentPeriod();
      const row = await this.countersRepo.findOne({
        where: { organizationId, metric, period },
      });
      snapshot[metric] = {
        used: row?.count ?? 0,
        cap: capForMetric(plan, metric),
      };
    }
    return snapshot;
  }

  // ── Seeding ──────────────────────────────────────────────────────────

  private async seedPlans() {
    for (const seed of SEED_PLANS) {
      const existing = await this.plansRepo.findOne({
        where: { tier: seed.tier },
      });
      if (existing) {
        // Update the catalog every boot so changes here propagate without
        // a manual migration. Stripe price IDs are preserved when set by
        // the operator.
        const update: Partial<PlanEntity> = { ...seed };
        if (existing.stripeMonthlyPriceId) {
          update.stripeMonthlyPriceId = existing.stripeMonthlyPriceId;
        }
        if (existing.stripeYearlyPriceId) {
          update.stripeYearlyPriceId = existing.stripeYearlyPriceId;
        }
        await this.plansRepo.save({ ...existing, ...update });
      } else {
        await this.plansRepo.save(this.plansRepo.create(seed));
      }
    }
  }
}

function currentPeriod(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function capForMetric(plan: PlanEntity, metric: UsageMetric): number {
  switch (metric) {
    case 'ai_requests':
      return plan.monthlyAiRequests;
    case 'plan_apply':
      return plan.tier === 'free' ? 1 : plan.monthlyAiRequests;
    case 'document_generate':
      return plan.tier === 'free' ? 1 : plan.monthlyAiRequests;
    case 'system_deploy':
      return plan.maxActiveSystems;
    case 'workflow_run':
      return plan.tier === 'free' ? 5 : -1;
  }
}

function capIsLifetime(plan: PlanEntity, metric: UsageMetric): boolean {
  // Free plan: 1-of-each is a lifetime trial, not a monthly grant.
  if (plan.tier === 'free') {
    return metric !== 'workflow_run';
  }
  return false;
}
