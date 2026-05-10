import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from '../../../shared/database/base.entity';

@Entity({ name: 'ai_validation_results' })
@Index(['requestId', 'planId'])
export class AiValidationResultEntity extends AppBaseEntity {
  @Column({ name: 'request_id', type: 'uuid' })
  requestId!: string;

  @Column({ name: 'plan_id', type: 'uuid' })
  planId!: string;

  @Column({ name: 'is_valid', default: false })
  isValid!: boolean;

  @Column({ type: 'jsonb', nullable: true })
  issues!: string[] | null;

  @Column({ type: 'jsonb', nullable: true })
  warnings!: string[] | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;
}
