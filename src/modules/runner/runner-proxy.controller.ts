import { All, Controller, Logger, Param, Req, Res } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import type { Request, Response } from 'express';
import * as http from 'node:http';
import { Repository } from 'typeorm';
import { Public } from '../../shared/decorators/public.decorator';
import { SystemDeploymentEntity } from './entities/system-deployment.entity';

const COOKIE_PREFIX = 'stack62_sess_';
const QUERY_TOKEN = '_t';

/**
 * Reverse-proxy that fronts running user systems at `/sys/:deploymentId/*`.
 *
 * Why this exists: generated systems listen on an ephemeral localhost port
 * inside the RunnerService. Exposing those ports directly would break when
 * Stack62 runs on a different host, and would make access control impossible.
 * This controller terminates the public request on Stack62's own origin,
 * verifies a JWT (bearer, `?_t=` query param, or per-deployment cookie), then
 * forwards the request — headers, body, and streaming response — to the
 * child process behind the scenes.
 *
 * This controller is excluded from the global `/v1` API prefix in main.ts
 * so the public URLs are `stack62.host/sys/{id}/...`.
 */
@Controller({ path: 'sys' })
export class RunnerProxyController {
  private readonly logger = new Logger(RunnerProxyController.name);

  constructor(
    @InjectRepository(SystemDeploymentEntity)
    private readonly deploymentsRepository: Repository<SystemDeploymentEntity>,
    private readonly jwtService: JwtService,
  ) {}

  @All(':deploymentId')
  @Public()
  proxyRoot(
    @Param('deploymentId') deploymentId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    // Ensure trailing slash so relative paths in served HTML resolve.
    if (!req.originalUrl.endsWith('/') && !req.originalUrl.includes('?')) {
      res.redirect(302, `${req.originalUrl}/`);
      return;
    }
    return this.forward(deploymentId, '/', req, res);
  }

  @All(':deploymentId/*')
  @Public()
  proxy(
    @Param('deploymentId') deploymentId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const rest =
      (req.params as { 0?: string })['0'] ??
      req.path.replace(new RegExp(`^/sys/${deploymentId}/?`), '');
    return this.forward(deploymentId, '/' + rest, req, res);
  }

  // ─── internals ─────────────────────────────────────────────────────────

  private async forward(
    deploymentId: string,
    upstreamPath: string,
    req: Request,
    res: Response,
  ) {
    const deployment = await this.deploymentsRepository.findOne({
      where: { id: deploymentId },
    });
    if (!deployment) {
      res.status(404).send('Deployment not found');
      return;
    }
    if (deployment.status !== 'running' || !deployment.port) {
      res
        .status(503)
        .send(
          `Deployment is ${deployment.status}. Start it before previewing.`,
        );
      return;
    }

    // AuthZ: bearer header, ?_t= query param, or stack62_sess_<id> cookie.
    const token = this.extractToken(req, deploymentId);
    if (!token || !this.verifyToken(token)) {
      res.status(401).send('Unauthorized — missing or invalid preview token.');
      return;
    }

    // If token arrived via query, set cookie + strip query so asset URLs
    // don't leak tokens into the HTML served downstream.
    const queryToken = this.queryToken(req);
    if (queryToken) {
      res.cookie(`${COOKIE_PREFIX}${deploymentId}`, queryToken, {
        httpOnly: true,
        sameSite: 'lax',
        path: `/sys/${deploymentId}`,
        maxAge: 60 * 60 * 1000,
      });
      const cleanUrl = this.stripQueryToken(req.originalUrl);
      res.redirect(302, cleanUrl);
      return;
    }

    // Build upstream URL. Preserve query string (minus _t).
    const [, rawQs] = req.originalUrl.split('?');
    const qs = this.stripTokenFromQuery(rawQs);
    const search = qs ? `?${qs}` : '';

    const upstream = http.request(
      {
        host: '127.0.0.1',
        port: deployment.port,
        path: upstreamPath + search,
        method: req.method,
        headers: this.filterForwardHeaders(req.headers, deployment.port ?? 0),
      },
      (upstreamRes) => {
        res.status(upstreamRes.statusCode ?? 502);
        for (const [k, v] of Object.entries(upstreamRes.headers)) {
          if (v !== undefined) res.setHeader(k, v);
        }
        upstreamRes.pipe(res);
      },
    );

    upstream.on('error', (err) => {
      this.logger.warn(
        `Proxy upstream error for ${deploymentId}: ${err.message}`,
      );
      if (!res.headersSent) {
        res.status(502).send(`Upstream error: ${err.message}`);
      } else {
        res.end();
      }
    });

    req.on('aborted', () => upstream.destroy());
    req.pipe(upstream);
  }

  private extractToken(req: Request, deploymentId: string): string | null {
    const auth = req.headers.authorization;
    if (auth && auth.toLowerCase().startsWith('bearer ')) {
      return auth.slice(7).trim();
    }
    const q = this.queryToken(req);
    if (q) return q;

    const cookieHeader = req.headers.cookie;
    if (!cookieHeader) return null;
    const cookies = cookieHeader.split(';').map((s) => s.trim());
    const target = `${COOKIE_PREFIX}${deploymentId}=`;
    for (const c of cookies) {
      if (c.startsWith(target)) {
        return decodeURIComponent(c.slice(target.length));
      }
    }
    return null;
  }

  private queryToken(req: Request): string | null {
    const raw = (req.query as Record<string, unknown>)[QUERY_TOKEN];
    if (typeof raw === 'string' && raw.length > 0) return raw;
    return null;
  }

  private verifyToken(token: string): boolean {
    try {
      this.jwtService.verify(token);
      return true;
    } catch {
      return false;
    }
  }

  private filterForwardHeaders(
    headers: http.IncomingHttpHeaders,
    port: number,
  ): http.OutgoingHttpHeaders {
    const out: http.OutgoingHttpHeaders = {};
    for (const [k, v] of Object.entries(headers)) {
      const lk = k.toLowerCase();
      if (
        lk === 'host' ||
        lk === 'connection' ||
        lk === 'keep-alive' ||
        lk === 'proxy-authenticate' ||
        lk === 'proxy-authorization' ||
        lk === 'te' ||
        lk === 'trailer' ||
        lk === 'transfer-encoding' ||
        lk === 'upgrade' ||
        lk === 'content-length'
      ) {
        continue;
      }
      if (v === undefined) continue;
      out[k] = v;
    }
    out['host'] = `127.0.0.1:${port}`;
    out['x-forwarded-host'] = String(headers['host'] ?? '');
    out['x-forwarded-proto'] =
      (headers['x-forwarded-proto'] as string) ?? 'http';
    return out;
  }

  private stripQueryToken(originalUrl: string): string {
    const [path, qs] = originalUrl.split('?');
    if (!qs) return path;
    const filtered = this.stripTokenFromQuery(qs);
    return filtered ? `${path}?${filtered}` : path;
  }

  private stripTokenFromQuery(qs: string | undefined): string {
    if (!qs) return '';
    return qs
      .split('&')
      .filter((part) => !part.startsWith(`${QUERY_TOKEN}=`))
      .join('&');
  }
}
