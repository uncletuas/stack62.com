import {
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../shared/decorators/public.decorator';
import { AdminAuthService } from './admin-auth.service';
import { CurrentStaff, type AuthenticatedStaff } from './admin.decorators';
import {
  AdminChallengeDto,
  AdminLoginDto,
  AdminSetPasswordDto,
  AdminVerifyTwoFactorDto,
} from './dto/admin-auth.dto';
import { PlatformStaffGuard } from './platform-staff.guard';
import { PlatformStaffService } from './platform-staff.service';

/**
 * Staff authentication for assembly.loopital.com. All routes are @Public() so
 * the GLOBAL customer JwtAuthGuard skips them — these flows validate their own
 * challenge/access tokens. 2FA is mandatory: `login` never returns a session.
 */
@ApiTags('admin-auth')
@Public()
@Controller('admin/auth')
export class AdminAuthController {
  constructor(
    private readonly adminAuthService: AdminAuthService,
    private readonly staffService: PlatformStaffService,
  ) {}

  @Post('login')
  @HttpCode(200)
  login(@Body() dto: AdminLoginDto, @Req() req: Request) {
    return this.adminAuthService.login(dto.email, dto.password, clientIp(req));
  }

  @Post('setup-2fa')
  @HttpCode(200)
  setupTwoFactor(@Body() dto: AdminChallengeDto) {
    return this.adminAuthService.setupTwoFactor(dto.challengeToken);
  }

  @Post('verify-2fa')
  @HttpCode(200)
  verifyTwoFactor(@Body() dto: AdminVerifyTwoFactorDto, @Req() req: Request) {
    return this.adminAuthService.verifyTwoFactor(
      dto.challengeToken,
      dto.code,
      clientIp(req),
    );
  }

  /** Current staff identity (used by the SPA to hydrate after refresh). */
  @Post('me')
  @HttpCode(200)
  @UseGuards(PlatformStaffGuard)
  me(@CurrentStaff() staff: AuthenticatedStaff) {
    return staff;
  }

  /** Change own password (clears the must_reset_password flag). */
  @Post('change-password')
  @HttpCode(200)
  @UseGuards(PlatformStaffGuard)
  async changePassword(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Body() dto: AdminSetPasswordDto,
  ) {
    await this.staffService.setPassword(staff.staffId, dto.newPassword);
    return { ok: true };
  }
}

function clientIp(req: Request): string | undefined {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip;
}
