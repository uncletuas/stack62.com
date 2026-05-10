import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { UsersService } from '../users/users.service';
import { ActivityService } from '../activity/activity.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { AuthResponseDto } from './dto/auth-response.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly activityService: ActivityService,
  ) {}

  async register(payload: RegisterDto): Promise<AuthResponseDto> {
    const passwordHash = await argon2.hash(payload.password);
    const user = await this.usersService.create({
      email: payload.email,
      passwordHash,
      firstName: payload.firstName,
      lastName: payload.lastName,
    });

    await this.activityService.log({
      actorUserId: user.id,
      action: 'auth.register',
      targetType: 'user',
      targetId: user.id,
      origin: 'user',
      metadata: { email: user.email },
    });

    return this.buildAuthResponse(user);
  }

  async login(payload: LoginDto): Promise<AuthResponseDto> {
    const user = await this.usersService.findByEmail(payload.email);

    if (!user) {
      throw new UnauthorizedException('Invalid credentials.');
    }

    const passwordValid = await argon2.verify(
      user.passwordHash,
      payload.password,
    );
    if (!passwordValid) {
      throw new UnauthorizedException('Invalid credentials.');
    }

    await this.activityService.log({
      actorUserId: user.id,
      action: 'auth.login',
      targetType: 'user',
      targetId: user.id,
      origin: 'user',
      metadata: { email: user.email },
    });

    return this.buildAuthResponse(user);
  }

  private buildAuthResponse(
    user: Awaited<ReturnType<UsersService['findById']>>,
  ): AuthResponseDto {
    const accessToken = this.jwtService.sign({
      sub: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
    });

    return {
      accessToken,
      user: this.usersService.sanitize(user),
    };
  }
}
