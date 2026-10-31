import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { ApiError } from '../common/api-error';

/**
 * Per-IP limit on sign-in and code endpoints (build plan, section 8). Per-phone
 * limits are the PIN lockout and the per-code try limit. In memory, so it is
 * per API instance; move to Postgres or Redis before running several.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();
  private readonly perMinute = Number(process.env.AUTH_RATE_LIMIT_PER_MIN ?? 30);

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    const key = `${req.ip}|${req.route?.path ?? req.path}`;
    const now = Date.now();
    const h = this.hits.get(key);
    if (!h || h.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + 60_000 });
      if (this.hits.size > 10_000) this.sweep(now);
      return true;
    }
    h.count++;
    if (h.count > this.perMinute) throw new ApiError(429, 'too_many_requests', { retryAfter: Math.ceil((h.resetAt - now) / 1000) });
    return true;
  }

  private sweep(now: number) {
    for (const [k, v] of this.hits) if (v.resetAt <= now) this.hits.delete(k);
  }
}
