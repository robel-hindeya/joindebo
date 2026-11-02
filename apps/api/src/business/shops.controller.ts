import { Controller, Get, Inject, Param, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import type { Sql } from '@temelash/db';
import { SQL } from '../db/db.module';
import { notFound } from '../common/api-error';
import { RateLimitGuard } from '../auth/rate-limit.guard';

export interface PublicShop {
  name: string;
  shopCode: string;
  color: string;
  logoUrl: string | null;
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
    const [s] = await this.sql<{ name: string; shop_code: string; brand_color: string; logo_version: number | null; stamps_needed: number | null; ladder: Array<{ at: number; reward: string }> | null }[]>`
      select b.name, b.shop_code, b.brand_color, l.version as logo_version, r.stamps_needed, r.ladder
      from tc.business b
      left join tc.business_logo l on l.business_id = b.id
      left join lateral (select stamps_needed, ladder from tc.rule_set where business_id = b.id order by version desc limit 1) r on true
      where b.shop_code = ${code.toUpperCase()} and b.status in ('trial', 'active')`;
    if (!s) throw notFound('no_shop');
    return {
      name: s.name,
      shopCode: s.shop_code,
      color: s.brand_color,
      logoUrl: s.logo_version ? `/api/v1/shops/${s.shop_code}/logo?v=${s.logo_version}` : null,
      stampsNeeded: s.stamps_needed,
      rewards: (s.ladder ?? []).map((l) => ({ at: l.at, reward: l.reward })),
    };
  }

  /** BusinessPage: category, city, branches with address and hours, and the card. Public, like the join page. */
  @Get(':code/details')
  async details(@Param('code') code: string) {
    const [b] = await this.sql<{ id: string; name: string; category: string; city: string; shop_code: string; brand_color: string; logo_version: number | null; stamps_needed: number | null; ladder: Array<{ at: number; reward: string }> | null; reward_valid_days: number | null }[]>`
      select b.id, b.name, b.category, b.city, b.shop_code, b.brand_color, l.version as logo_version, r.stamps_needed, r.ladder, r.reward_valid_days
      from tc.business b
      left join tc.business_logo l on l.business_id = b.id
      left join lateral (select stamps_needed, ladder, reward_valid_days from tc.rule_set where business_id = b.id order by version desc limit 1) r on true
      where b.shop_code = ${code.toUpperCase()} and b.status in ('trial', 'active', 'paused', 'closing')`;
    if (!b) throw notFound('no_shop');
    const branches = await this.sql<{ name: string; address: string | null; hours: Record<string, string[][]> }[]>`
      select name, address, hours from tc.branch where business_id = ${b.id} and status = 'active' order by created_at`;
    return {
      name: b.name, category: b.category, city: b.city, shopCode: b.shop_code, color: b.brand_color,
      logoUrl: b.logo_version ? `/api/v1/shops/${b.shop_code}/logo?v=${b.logo_version}` : null,
      stampsNeeded: b.stamps_needed, rewardValidDays: b.reward_valid_days,
      rewards: (b.ladder ?? []).map((t) => ({ at: t.at, reward: t.reward })),
      branches,
    };
  }

  /** The shop logo. The URL carries the version, so it can be cached for a long time. */
  @Get(':code/logo')
  async logo(@Param('code') code: string, @Res() res: Response) {
    const [l] = await this.sql<{ mime: string; bytes: Buffer }[]>`
      select l.mime, l.bytes from tc.business_logo l join tc.business b on b.id = l.business_id where b.shop_code = ${code.toUpperCase()}`;
    if (!l) throw notFound('no_logo');
    res.setHeader('Content-Type', l.mime);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(l.bytes);
  }
}
