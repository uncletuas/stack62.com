import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from '../../../shared/database/base.entity';

export type CoworkerMemoryKind = 'fact' | 'preference' | 'episode';
export type CoworkerMemorySource = 'user' | 'coworker';

/**
 * A single memory record the Coworker can recall later. Memories are
 * scoped per-System by default — a memory written under one System never
 * leaks to another team's System. When `systemId` is null the memory is
 * workspace-scoped.
 */
@Entity({ name: 'coworker_memories' })
@Index(['organizationId', 'workspaceId', 'systemId'])
export class CoworkerMemoryEntity extends AppBaseEntity {
  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'system_id', type: 'uuid', nullable: true })
  systemId!: string | null;

  @Column({ length: 20, default: 'fact' })
  kind!: CoworkerMemoryKind;

  @Column({ name: 'memory_key', type: 'varchar', length: 180, nullable: true })
  key!: string | null;

  @Column({ type: 'text' })
  text!: string;

  @Column({ length: 20, default: 'user' })
  source!: CoworkerMemorySource;

  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;
}
