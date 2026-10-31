import { Body, Controller, Get, HttpCode, Inject, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { writeAudit, type Sql } from '@temelash/db';
import { SQL } from '../db/db.module';
import type { Actor } from './actor';
import { AuthGuard, CurrentActor, Roles, requestMeta } from './auth.guard';
import { RateLimitGuard } from './rate-limit.guard';
import { TokensService } from './tokens.service';

@Controller()
export class SessionController {
  constructor(
    @Inject(SQL) private readonly sql: Sql,
    private readonly tokens: TokensService,
  ) {}

  @Post('auth/refresh')
  @HttpCode(200)
  @UseGuards(RateLimitGuard)
  refresh(@Body() b: Record<string, unknown>, @Req() req: Request) {
    return this.tokens.refresh(b.refreshToken, requestMeta(req));
  }

  /** Sign-out ends every session of this person, on every device (build plan, section 8). */
  @Post('auth/signout')
  @HttpCode(204)
  @UseGuards(AuthGuard)
  @Roles('customer', 'staff', 'manager', 'owner')
  async signout(@CurrentActor() a: Actor) {
    await this.sql.begin(async (tx) => {
      await this.tokens.revokeAll(tx, a.type, a.id);
      await writeAudit(tx, { actorType: a.type, actorId: a.id, businessId: a.businessId, type: 'auth.signout', text: 'Signed out everywhere' });
    });
  }

  @Get('me')
  @UseGuards(AuthGuard)
  @Roles('customer', 'staff', 'manager', 'owner')
  me(@CurrentActor() a: Actor) {
    return { actorType: a.type, id: a.id, businessId: a.businessId ?? null, branchId: a.branchId ?? null };
  }
}
