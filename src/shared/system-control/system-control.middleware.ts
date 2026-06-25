import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { SystemControlService } from './system-control.service';

/**
 * Enforces the runtime system controls (maintenance / read-only / rate-limit)
 * on the customer API surface. Cheap: just reads in-memory flags. When a flag
 * trips it returns the appropriate status with Retry-After; otherwise next().
 */
@Injectable()
export class SystemControlMiddleware implements NestMiddleware {
  constructor(private readonly systemControl: SystemControlService) {}

  use(req: Request, res: Response, next: NextFunction) {
    const forwarded = req.headers['x-forwarded-for'];
    const ip =
      (typeof forwarded === 'string' && forwarded.split(',')[0].trim()) ||
      req.ip ||
      '';
    const decision = this.systemControl.evaluate(
      req.method,
      req.path,
      ip,
    );
    if (decision) {
      res.setHeader('Retry-After', '60');
      return res.status(decision.status).json({
        statusCode: decision.status,
        error:
          decision.status === 503
            ? 'Service Unavailable'
            : decision.status === 423
              ? 'Locked'
              : 'Too Many Requests',
        message: decision.message,
      });
    }
    next();
  }
}
