import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from '../../../shared/database/base.entity';

@Entity({ name: 'users' })
export class UserEntity extends AppBaseEntity {
  @Index({ unique: true })
  @Column({ length: 255 })
  email!: string;

  @Column({ name: 'password_hash', length: 255 })
  passwordHash!: string;

  @Column({ name: 'first_name', length: 120 })
  firstName!: string;

  @Column({ name: 'last_name', length: 120 })
  lastName!: string;

  @Column({ length: 30, default: 'active' })
  status!: string;
}
