import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ActivityModule } from '../activity/activity.module';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PaymentTransactionEntity } from './entities/payment-transaction.entity';
import { PlanEntity } from './entities/plan.entity';
import { SubscriptionEntity } from './entities/subscription.entity';
import { UsageCounterEntity } from './entities/usage-counter.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PlanEntity,
      SubscriptionEntity,
      UsageCounterEntity,
      PaymentTransactionEntity,
    ]),
    ActivityModule,
  ],
  controllers: [BillingController, PaymentsController],
  providers: [BillingService, PaymentsService],
  exports: [BillingService],
})
export class BillingModule {}
