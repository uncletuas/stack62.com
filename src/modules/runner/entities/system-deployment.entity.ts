import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from '../../../shared/database/base.entity';

export type DeploymentStatus =
  | 'pending'
  | 'building'
  | 'starting'
  | 'running'
  | 'stopped'
  | 'crashed';

@Entity({ name: 'system_deployments' })
@Index(['organizationId', 'systemId'])
export class SystemDeploymentEntity extends AppBaseEntity {
  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'workspace_id', type: 'uuid', nullable: true })
  workspaceId!: string | null;

  @Column({ name: 'system_id', type: 'uuid' })
  systemId!: string;

  @Column({ type: 'varchar', length: 60, default: 'node' })
  runtime!: string;

  @Column({ type: 'varchar', length: 512, default: 'server.js' })
  entrypoint!: string;

  @Column({ name: 'source_dir', type: 'varchar', length: 1024 })
  sourceDir!: string;

  @Column({ name: 'log_path', type: 'varchar', length: 1024, nullable: true })
  logPath!: string | null;

  @Column({ type: 'int', nullable: true })
  port!: number | null;

  @Column({ type: 'int', nullable: true })
  pid!: number | null;

  @Column({ type: 'varchar', length: 40, default: 'pending' })
  status!: DeploymentStatus;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt!: Date | null;

  @Column({ name: 'stopped_at', type: 'timestamptz', nullable: true })
  stoppedAt!: Date | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;

  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId!: string | null;
}
