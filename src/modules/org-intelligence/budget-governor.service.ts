import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiSpendCounterEntity } from './entities/ai-spend-counter.entity';
import { estimateCostUsd, isFrontierModel } from './model-pricing';

export interface BudgetState {
  /** Monthly cap in USD. 0 means unlimited. */
  limitUsd: number;
  /** Estimated month-to-date frontier spend in USD. */
  spentUsd: number;
  /** spent / limit, or 0 when unlimited. */
  ratio: number;
  /** At/over the hard cap — frontier calls should be blocked/downgraded. */
  overBudget: boolean;
  /** Past the warning ratio (default 0.8) — prefer cheaper models. */
  nearLimit: boolean;
}

/**
 * Enforces a per-org monthly frontier spend cap. The engine consults this
 * before paying for a completion and records what it spent afterwards. As an
 * org approaches its cap the governor recommends the downgrade ladder:
 * frontier → cheap frontier → local model.
 *
 * When AI_MONTHLY_BUDGET_USD is 0 (default) budgeting is disabled and every
 * call is allowed — the governor still records spend for reporting.
 */
@Injectable()
export class BudgetGovernorService {
  private readonly logger = new Logger(BudgetGovernorService.name);

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(AiSpendCounterEntity)
    private readonly spendRepo: Repository<AiSpendCounterEntity>,
  ) {}

  private limitUsd(): number {
    const raw = Number(this.configService.get('AI_MONTHLY_BUDGET_USD') ?? 0);
    return Number.isFinite(raw) && raw > 0 ? raw : 0;
  }

  private warnRatio(): number {
    const raw = Number(this.configService.get('AI_BUDGET_WARN_RATIO') ?? 0.8);
    return Number.isFinite(raw) && raw > 0 && raw < 1 ? raw : 0.8;
  }

  private period(date = new Date()): string {
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  /** Current budget state for an org. Never throws — failure ⇒ unlimited. */
  async getState(organizationId: string): Promise<BudgetState> {
    const limitUsd = this.limitUsd();
    let spentUsd = 0;
    try {
      const row = await this.spendRepo.findOne({
        where: { organizationId, period: this.period() },
      });
      if (row) spentUsd = Number(row.costMicros) / 1_000_000;
    } catch (err) {
      this.logger.warn(
        `Budget read failed (treating as unlimited): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    const ratio = limitUsd > 0 ? spentUsd / limitUsd : 0;
    return {
      limitUsd,
      spentUsd,
      ratio,
      overBudget: limitUsd > 0 && spentUsd >= limitUsd,
      nearLimit: limitUsd > 0 && ratio >= this.warnRatio(),
    };
  }

  /**
   * Choose the model to use for a frontier turn given the org's budget and a
   * preferred model. Over budget ⇒ no frontier (returns null, caller should
   * fall back to local / a budget notice). Near limit ⇒ the cheap model.
   * Otherwise the preferred model.
   */
  async chooseModel(
    organizationId: string,
    preferred: string,
  ): Promise<{
    model: string | null;
    state: BudgetState;
    downgraded: boolean;
  }> {
    const state = await this.getState(organizationId);
    // Non-frontier (local/unknown) models are free — never gated.
    if (!isFrontierModel(preferred)) {
      return { model: preferred, state, downgraded: false };
    }
    if (state.overBudget) {
      return { model: null, state, downgraded: true };
    }
    if (state.nearLimit) {
      const cheap = this.configService.get<string>('OPENAI_MODEL_CHEAP');
      if (cheap && cheap !== preferred) {
        return { model: cheap, state, downgraded: true };
      }
    }
    return { model: preferred, state, downgraded: false };
  }

  /** Record the estimated cost of a completion. Best-effort. */
  async recordSpend(
    organizationId: string,
    model: string,
    inputTokens: number,
    outputTokens: number,
  ): Promise<void> {
    const cost = estimateCostUsd(model, inputTokens, outputTokens);
    const micros = Math.round(cost * 1_000_000);
    const period = this.period();
    try {
      // Ensure the row exists, then increment with atomic SQL so concurrent
      // engine turns accumulate rather than clobber each other.
      const existing = await this.spendRepo.findOne({
        where: { organizationId, period },
      });
      if (!existing) {
        await this.spendRepo
          .insert({
            organizationId,
            period,
            costMicros: '0',
            inputTokens: '0',
            outputTokens: '0',
            callCount: 0,
          })
          // A racing insert already created it — ignore the unique violation.
          .catch(() => undefined);
      }
      await this.spendRepo
        .createQueryBuilder()
        .update(AiSpendCounterEntity)
        .set({
          costMicros: () => `cost_micros + ${micros}`,
          inputTokens: () =>
            `input_tokens + ${Math.max(0, Math.round(inputTokens))}`,
          outputTokens: () =>
            `output_tokens + ${Math.max(0, Math.round(outputTokens))}`,
          callCount: () => `call_count + 1`,
        })
        .where('organization_id = :organizationId AND period = :period', {
          organizationId,
          period,
        })
        .execute();
    } catch (err) {
      this.logger.warn(
        `recordSpend failed (ignored): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
