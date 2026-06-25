import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from '../../../shared/database/base.entity';

export type IpRuleKind = 'allow' | 'block';

/** An IP allow/block rule managed from the Security Center. */
@Entity({ name: 'admin_ip_rules' })
@Index(['kind'])
export class IpRuleEntity extends AppBaseEntity {
  @Column({ length: 64 })
  cidr!: string;

  @Column({ length: 10, default: 'block' })
  kind!: IpRuleKind;

  @Column({ type: 'text', nullable: true })
  reason!: string | null;

  @Column({ name: 'created_by_staff_id', type: 'uuid', nullable: true })
  createdByStaffId!: string | null;
}
