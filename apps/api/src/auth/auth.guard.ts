import { CanActivate, ExecutionContext, Injectable, SetMetadata, createParamDecorator } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { forbidden, unauthorized } from '../common/api-error';
import type { Actor } from './actor';
import { TokensService } from './tokens.service';

const ROLES = 'tc_roles';

/** Which actor types may call an endpoint. Every protected endpoint names them. */
export const Roles = (...types: Actor['type'][]) => SetMetadata(ROLES, types);

/** The verified caller, set by AuthGuard. */
export const CurrentActor = createParamDecorator((_: unknown, ctx: ExecutionContext): Actor => {
  return (ctx.switchToHttp().getRequest() as Request & { actor: Actor }).actor;
});

/**
 * Requires a valid access token (never a sign-in ticket) for a live session,
 * and an actor type listed in @Roles. Finer checks (which business or branch)
 * live in the service that loads the record.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly tokens: TokensService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request & { actor?: Actor }>();
    const header = req.header('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) throw unauthorized();
    const actor = await this.tokens.readAccess(token);
    const allowed = this.reflector.getAllAndOverride<Actor['type'][]>(ROLES, [ctx.getHandler(), ctx.getClass()]);
    if (!allowed || !allowed.includes(actor.type)) throw forbidden();
    req.actor = actor;
    return true;
  }
}

export function requestMeta(req: Request): { ip?: string; userAgent?: string } {
  return { ip: req.ip, userAgent: req.header('user-agent') };
}
