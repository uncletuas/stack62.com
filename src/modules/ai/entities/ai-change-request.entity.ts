import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from '../../../shared/database/base.entity';

@Entity({ name: 'ai_change_requests' })
@Index(['organizationId', 'workspaceId', 'systemId', 'status'])
export class AiChangeRequestEntity extends AppBaseEntity {
  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'system_id', type: 'uuid', nullable: true })
  systemId!: string | null;

  @Column({ name: 'actor_user_id', type: 'uuid' })
  actorUserId!: string;

  @Column({ name: 'background_job_id', type: 'uuid', nullable: true })
  backgroundJobId!: string | null;

  @Column({ type: 'text' })
  prompt!: string;

  @Column({ type: 'varchar', length: 80, nullable: true })
  intent!: string | null;

  @Column({ length: 40, default: 'queued' })
  status!: string;

  @Column({
    name: 'risk_level',
    type: 'varchar',
    length: 20,
    nullable: true,
  })
  riskLevel!: string | null;

  @Column({ name: 'auto_apply', default: false })
  autoApply!: boolean;

  @Column({ name: 'generate_artifacts', default: false })
  generateArtifacts!: boolean;

  @Column({ type: 'text', nullable: true })
  summary!: string | null;

  @Column({ name: 'applied_system_id', type: 'uuid', nullable: true })
  appliedSystemId!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;
}
