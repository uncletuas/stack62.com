import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from '../../../shared/database/base.entity';

/**
 * One row per page visit in a workspace's in-app browser. Powers history +
 * bookmarks. Kept deliberately lightweight; the live page itself lives only
 * in the Playwright session, not here.
 */
@Entity({ name: 'browser_history' })
@Index(['organizationId', 'workspaceId'])
export class BrowserHistoryEntity extends AppBaseEntity {
  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'workspace_id', type: 'uuid', nullable: true })
  workspaceId!: string | null;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ type: 'varchar', length: 2048 })
  url!: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  title!: string | null;

  @Column({ name: 'bookmarked', type: 'boolean', default: false })
  bookmarked!: boolean;
}
