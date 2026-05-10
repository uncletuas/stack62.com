import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from '../../../shared/database/base.entity';

/**
 * A folder. Folders form a tree per organization (and optionally per
 * workspace). The org root is implicit (parentId=null, isRoot=true) —
 * we materialize it lazily when first accessed.
 *
 * `path` is denormalized (e.g. "/legal/contracts/2026") for breadcrumbs
 * and prefix queries; rebuilt on rename or move.
 */
@Entity({ name: 'folders' })
@Index(['organizationId', 'parentId'])
@Index(['organizationId', 'path'])
export class FolderEntity extends AppBaseEntity {
  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'workspace_id', type: 'uuid', nullable: true })
  workspaceId!: string | null;

  @Column({ name: 'parent_id', type: 'uuid', nullable: true })
  parentId!: string | null;

  @Column({ type: 'varchar', length: 200 })
  name!: string;

  /** Slash-prefixed materialized path. Rebuilt on rename/move. */
  @Column({ type: 'varchar', length: 1024, default: '/' })
  path!: string;

  @Column({ name: 'is_root', default: false })
  isRoot!: boolean;

  /** Owners always have admin access regardless of ACL state. */
  @Column({ name: 'owner_user_id', type: 'uuid' })
  ownerUserId!: string;

  /** Personal folders are visible only to the owner by default. */
  @Column({ name: 'is_personal', default: false })
  isPersonal!: boolean;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 30, default: 'active' })
  status!: string;
}
