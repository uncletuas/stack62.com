import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { Public } from '../../shared/decorators/public.decorator';
import { AuthService } from './auth.service';
import { GoogleOAuthService } from './google-oauth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { GoogleStartDto } from './dto/google-start.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly googleOAuthService: GoogleOAuthService,
    private readonly configService: ConfigService,
  ) {}

  @Public()
  @Post('register')
  register(@Body() payload: RegisterDto) {
    return this.authService.register(payload);
  }

  @Public()
  @Post('login')
  login(@Body() payload: LoginDto) {
    return this.authService.login(payload);
  }

  /**
   * Returns a Google consent URL for the requested intent (signin /
   * signup_individual / signup_organization). Frontend redirects the
   * browser to the returned URL.
   *
   * 503 if the operator hasn't set the GOOGLE_AUTH_* env vars yet —
   * frontend should hide the button in that case (we expose
   * GET /auth/google/available for that check).
   */
  @Public()
  @Post('google/url')
  googleStart(@Body() payload: GoogleStartDto) {
    const url = this.googleOAuthService.buildConsentUrl({
      intent: payload.intent ?? 'signin',
      redirectAfter: payload.redirectAfter ?? null,
      inviteToken: payload.inviteToken ?? null,
      organizationName: payload.organizationName,
      organizationRole: payload.organizationRole,
      organizationTeamSize: payload.organizationTeamSize,
    });
    return { url };
  }

  @Public()
  @Get('google/available')
  googleAvailable() {
    return { available: this.googleOAuthService.isConfigured() };
  }

  /**
   * Google redirects here after the user consents. We exchange the code,
   * find-or-create the user, then redirect the browser back to the app
   * with the JWT in the URL fragment so client-side code can pick it up
   * and store it.
   */
  @Public()
  @Get('google/callback')
  async googleCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string | undefined,
    @Res() res: Response,
  ) {
    const appUrl =
      this.configService.get<string>('APP_PUBLIC_URL') ||
      'http://localhost:5173';

    if (error) {
      return res.redirect(
        `${appUrl}/sign-in?error=${encodeURIComponent(error)}`,
      );
    }
    if (!code || !state) {
      return res.redirect(`${appUrl}/sign-in?error=missing_code`);
    }

    try {
      const { auth, redirectAfter } =
        await this.googleOAuthService.handleCallback(code, state);
      const target = redirectAfter || '/app';
      // The fragment keeps the token out of server logs / referer headers.
      const fragment = new URLSearchParams({
        token: auth.accessToken,
      }).toString();
      return res.redirect(`${appUrl}${target}#${fragment}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown_error';
      return res.redirect(
        `${appUrl}/sign-in?error=${encodeURIComponent(message)}`,
      );
    }
  }
}
