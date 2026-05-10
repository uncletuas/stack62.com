import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from '../../../shared/database/base.entity';

@Entity({ name: 'ai_change_plans' })
@Index(['requestId', 'status'])
export class AiChangePlanEntity extends AppBaseEntity {
  @Column({ name: 'request_id', type: 'uuid' })
  requestId!: string;

  @Column({ name: 'plan_type', length: 80 })
  planType!: string;

  @Column({ type: 'jsonb' })
  structuredPlan!: Record<string, unknown>;

  @Column({ type: 'text' })
  summary!: string;

  @Column({ name: 'risk_level', length: 20 })
  riskLevel!: string;

  @Column({ length: 40, default: 'draft' })
  status!: string;
}
