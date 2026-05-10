import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from '../../../shared/database/base.entity';

export type AuditOrigin = 'user' | 'ai' | 'system';
export type AuditPayload = object | string | number | boolean;

@Entity({ name: 'audit_logs' })
@Index(['organizationId', 'workspaceId', 'systemId'])
export class AuditLogEntity extends AppBaseEntity {
  @Column({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId!: string | null;

  @Column({ name: 'workspace_id', type: 'uuid', nullable: true })
  workspaceId!: string | null;

  @Column({ name: 'system_id', type: 'uuid', nullable: true })
  systemId!: string | null;

  @Column({ name: 'actor_user_id', type: 'uuid', nullable: true })
  actorUserId!: string | null;

  @Column({ length: 120 })
  action!: string;

  @Column({ name: 'target_type', length: 120 })
  targetType!: string;

  @Column({ name: 'target_id', length: 120 })
  targetId!: string;

  @Column({ type: 'varchar', length: 20, default: 'user' })
  origin!: AuditOrigin;

  @Column({ name: 'before_data', type: 'jsonb', nullable: true })
  beforeData!: AuditPayload | null;

  @Column({ name: 'after_data', type: 'jsonb', nullable: true })
  afterData!: AuditPayload | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;
}
