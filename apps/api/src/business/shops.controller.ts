import { Controller, Get, Inject, Param, UseGuards } from '@nestjs/common';
import type { Sql } from '@temelash/db';
import { SQL } from '../db/db.module';
import { notFound } from '../common/api-error';
import { RateLimitGuard } from '../auth/rate-limit.guard';

export interface PublicShop {
  name: string;
  shopCode: string;
  stampsNeeded: number | null;
  rewards: Array<{ at: number; reward: string }>;
}

/** What a shop's join page (ScanJoin) shows before anyone signs in. */
@Controller('shops')
@UseGuards(RateLimitGuard)
export class ShopsController {
  constructor(@Inject(SQL) private readonly sql: Sql) {}

  @Get(':code')
  async shop(@Param('code') code: string): Promise<PublicShop> {
    const [s] = await this.sql<{ name: string; shop_code: string; stamps_needed: number | null; ladder: Array<{ at: number; reward: string }> | null }[]>`
      select b.name, b.shop_code, r.stamps_needed, r.ladder
      from tc.business b
      left join lateral (select stamps_needed, ladder from tc.rule_set where business_id = b.id order by version desc limit 1) r on true
      where b.shop_code = ${code.toUpperCase()} and b.status in ('trial', 'active')`;
    if (!s) throw notFound('no_shop');
    return { name: s.name, shopCode: s.shop_code, stampsNeeded: s.stamps_needed, rewards: (s.ladder ?? []).map((l) => ({ at: l.at, reward: l.reward })) };
  }
}
