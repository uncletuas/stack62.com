import { Body, Controller, Get, Post, Query, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { Public } from '../../shared/decorators/public.decorator';
import { AuthService } from './auth.service';
import { GoogleOAuthService } from './google-oauth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { GoogleStartDto } from './dto/google-start.dto';
import { LoopitalSsoDto } from './dto/loopital-sso.dto';

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
  register(@Body() payload: RegisterDto, @Req() req: Request) {
    return this.authService.register(payload, clientIp(req));
  }

  @Public()
  @Post('login')
  login(@Body() payload: LoginDto) {
    return this.authService.login(payload);
  }

  /**
   * Single sign-on from loopital.com. The frontend /sso page posts the
   * short-lived loopital SSO token here; we validate it with loopital's IdP and
   * return a Stack62 session so one loopital account signs in.
   */
  @Public()
  @Post('loopital/sso')
  loopitalSso(@Body() payload: LoopitalSsoDto) {
    return this.authService.loopitalSso(payload.token);
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

function clientIp(req: Request): string | undefined {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip;
}
