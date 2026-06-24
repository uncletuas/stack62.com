import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserEntity } from './entities/user.entity';

export interface CreateUserInput {
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly usersRepository: Repository<UserEntity>,
  ) {}

  async create(input: CreateUserInput): Promise<UserEntity> {
    const existing = await this.usersRepository.findOne({
      where: { email: input.email.toLowerCase() },
    });

    if (existing) {
      throw new ConflictException('A user with this email already exists.');
    }

    const user = this.usersRepository.create({
      email: input.email.toLowerCase(),
      passwordHash: input.passwordHash,
      firstName: input.firstName,
      lastName: input.lastName,
      status: 'active',
    });

    return this.usersRepository.save(user);
  }

  async findAll(): Promise<UserEntity[]> {
    return this.usersRepository.find({ order: { createdAt: 'DESC' } });
  }

  async findByEmail(email: string): Promise<UserEntity | null> {
    return this.usersRepository.findOne({
      where: { email: email.toLowerCase() },
    });
  }

  async findById(id: string): Promise<UserEntity> {
    const user = await this.usersRepository.findOne({ where: { id } });

    if (!user) {
      throw new NotFoundException('User not found.');
    }

    return user;
  }

  sanitize(user: UserEntity) {
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      status: user.status,
      platformRole: user.platformRole ?? null,
      avatarFileId: user.avatarFileId,
      emailVerifiedAt: user.emailVerifiedAt,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  async setAvatar(
    userId: string,
    avatarFileId: string | null,
  ): Promise<UserEntity> {
    const user = await this.findById(userId);
    user.avatarFileId = avatarFileId;
    return this.usersRepository.save(user);
  }

  async updateProfile(
    userId: string,
    patch: { firstName?: string; lastName?: string },
  ): Promise<UserEntity> {
    const user = await this.findById(userId);
    if (typeof patch.firstName === 'string' && patch.firstName.trim()) {
      user.firstName = patch.firstName.trim().slice(0, 120);
    }
    if (typeof patch.lastName === 'string' && patch.lastName.trim()) {
      user.lastName = patch.lastName.trim().slice(0, 120);
    }
    return this.usersRepository.save(user);
  }
}
