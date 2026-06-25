import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as crypto from 'node:crypto';
import { Repository } from 'typeorm';
import {
  PaymentStatus,
  PaymentTransactionEntity,
} from './entities/payment-transaction.entity';

/**
 * Persists real payments from the Paystack webhook so collected revenue is
 * queryable. Verifies the webhook signature (HMAC-SHA512 of the raw body with
 * the Paystack secret key) before trusting any event, and upserts by reference
 * so retries are idempotent.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @InjectRepository(PaymentTransactionEntity)
    private readonly txRepo: Repository<PaymentTransactionEntity>,
    private readonly configService: ConfigService,
  ) {}

  verifyPaystackSignature(rawBody: Buffer | undefined, signature?: string): boolean {
    const secret = this.configService.get<string>('PAYSTACK_SECRET_KEY');
    if (!secret || !rawBody || !signature) return false;
    const expected = crypto
      .createHmac('sha512', secret)
      .update(rawBody)
      .digest('hex');
    // Constant-time compare; lengths must match or timingSafeEqual throws.
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  /** Upsert a transaction from a Paystack event payload. */
  async recordPaystackEvent(event: {
    event?: string;
    data?: {
      reference?: string;
      amount?: number;
      currency?: string;
      status?: string;
      channel?: string;
      paid_at?: string;
      customer?: { email?: string };
      metadata?: Record<string, unknown>;
    };
  }): Promise<void> {
    const data = event.data;
    if (!data?.reference) {
      this.logger.warn('Paystack event without a reference; ignoring.');
      return;
    }

    const status = this.mapStatus(event.event, data.status);
    const orgId = this.pickMeta(data.metadata, ['organizationId', 'organization_id']);
    const userId = this.pickMeta(data.metadata, ['userId', 'user_id', 'actorUserId']);

    let tx = await this.txRepo.findOne({ where: { reference: data.reference } });
    if (!tx) {
      tx = this.txRepo.create({ reference: data.reference, provider: 'paystack' });
    }
    tx.amount = data.amount ?? tx.amount ?? 0;
    tx.currency = data.currency ?? tx.currency ?? 'NGN';
    tx.status = status;
    tx.channel = data.channel ?? tx.channel ?? null;
    tx.customerEmail = data.customer?.email ?? tx.customerEmail ?? null;
    tx.organizationId = orgId ?? tx.organizationId ?? null;
    tx.userId = userId ?? tx.userId ?? null;
    tx.paidAt = data.paid_at ? new Date(data.paid_at) : (tx.paidAt ?? null);
    tx.rawEvent = event as Record<string, unknown>;
    await this.txRepo.save(tx);
    this.logger.log(
      `Recorded Paystack ${event.event ?? 'event'} ${data.reference} → ${status}`,
    );
  }

  private mapStatus(eventName?: string, dataStatus?: string): PaymentStatus {
    if (eventName?.startsWith('refund')) return 'refunded';
    if (dataStatus === 'success') return 'success';
    if (dataStatus === 'failed') return 'failed';
    return 'pending';
  }

  private pickMeta(
    metadata: Record<string, unknown> | undefined,
    keys: string[],
  ): string | null {
    if (!metadata) return null;
    for (const key of keys) {
      const value = metadata[key];
      if (typeof value === 'string' && value) return value;
    }
    return null;
  }
}
