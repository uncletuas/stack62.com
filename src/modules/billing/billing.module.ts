import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ActivityModule } from '../activity/activity.module';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { PlanEntity } from './entities/plan.entity';
import { SubscriptionEntity } from './entities/subscription.entity';
import { UsageCounterEntity } from './entities/usage-counter.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([PlanEntity, SubscriptionEntity, UsageCounterEntity]),
    ActivityModule,
  ],
  controllers: [BillingController],
  providers: [BillingService],
  exports: [BillingService],
})
export class BillingModule {}
