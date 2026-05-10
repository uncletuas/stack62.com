import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { JwtUser } from '../../modules/auth/interfaces/jwt-user.interface';
import {
  ACCESS_CONTROL_METADATA_KEY,
  AccessControlRequirement,
} from './access-control.decorator';
import { AccessControlService } from './access-control.service';

@Injectable()
export class TenantAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly accessControlService: AccessControlService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const requirement =
      this.reflector.getAllAndOverride<AccessControlRequirement>(
        ACCESS_CONTROL_METADATA_KEY,
        [context.getHandler(), context.getClass()],
      );

    if (!requirement) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{
      user?: JwtUser;
      body?: Record<string, unknown>;
      query?: Record<string, unknown>;
      params?: Record<string, unknown>;
    }>();

    const userId = request.user?.userId;
    if (!userId) {
      throw new UnauthorizedException('Authenticated user context is missing.');
    }

    await this.accessControlService.assertRequestAccess(userId, requirement, {
      body: request.body,
      query: request.query,
      params: request.params,
    });

    return true;
  }
}
