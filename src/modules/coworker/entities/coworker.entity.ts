import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from '../../../shared/database/base.entity';

export interface CoworkerPermissions {
  canSendEmail: boolean;
  canSendMessage: boolean;
  canApplyPlans: boolean;
  canCreateRecords: boolean;
  canRunJobs: boolean;
  canSendPayments: boolean;
}

export const DEFAULT_PERMISSIONS: CoworkerPermissions = {
  canSendEmail: false,
  canSendMessage: false,
  canApplyPlans: false,
  canCreateRecords: true,
  canRunJobs: true,
  canSendPayments: false,
};

/**
 * The role the Coworker holds in the workspace. Maps 1:1 to the Membership
 * roles used by the access-control layer, so the same policy engine that
 * gates human actions also gates the Coworker.
 */
export type CoworkerRole =
  | 'admin'
  | 'manager'
  | 'staff'
  | 'reviewer'
  | 'read_only';

export const COWORKER_ROLES: CoworkerRole[] = [
  'admin',
  'manager',
  'staff',
  'reviewer',
  'read_only',
];

export const DEFAULT_COWORKER_ROLE: CoworkerRole = 'staff';

@Entity({ name: 'coworker_configs' })
@Index(['organizationId', 'workspaceId'], { unique: true })
export class CoworkerEntity extends AppBaseEntity {
  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ length: 80, default: 'Ada' })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  model!: string | null;

  @Column({ type: 'text', nullable: true })
  voice!: string | null;

  @Column({ name: 'default_autopilot', default: false })
  defaultAutopilot!: boolean;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  permissions!: CoworkerPermissions;

  @Column({ length: 40, default: 'staff' })
  role!: CoworkerRole;
}
