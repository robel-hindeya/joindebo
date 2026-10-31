import { Controller, Get, Inject, Param, UseGuards } from '@nestjs/common';
import type { Sql, TransactionSql } from '@temelash/db';
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

/**
 * Give a customer a card at a shop, under the shop's current rules, unless they
 * already hold a live one. Returns whether a card was added. The welcome stamp
 * and the rest of the stamp loop arrive with Phase 2.
 */
export async function addCard(tx: Sql | TransactionSql, customerId: string, businessId: string): Promise<boolean> {
  const [rules] = await tx<{ id: string }[]>`select id from tc.rule_set where business_id = ${businessId} order by version desc limit 1`;
  if (!rules) return false;
  const rows = await tx`
    insert into tc.card (customer_id, business_id, rule_set_id) values (${customerId}, ${businessId}, ${rules.id})
    on conflict (customer_id, business_id) where status in ('active', 'paused') do nothing returning id`;
  return rows.length > 0;
}
