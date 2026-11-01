import { Inject, Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import type { Sql } from '@temelash/db';
import { SQL } from '../db/db.module';
import { SettingsService } from '../settings/settings.service';

/**
 * Notifications nobody's action triggers: "Reward ending soon" (Notifications
 * board), once per reward, `notify.reward_expiring_days` before it runs out,
 * for customers who allow it. Checked every hour.
 */
@Injectable()
export class Notifier implements OnModuleInit, OnApplicationShutdown {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(SQL) private readonly sql: Sql,
    private readonly settings: SettingsService,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => { this.rewardsEndingSoon().catch((e) => console.log(JSON.stringify({ level: 'error', msg: 'reward notices failed', error: (e as Error).message }))); }, 3_600_000);
    this.timer.unref();
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  async rewardsEndingSoon(): Promise<number> {
    const days = await this.settings.number('notify.reward_expiring_days', 3);
    const rows = await this.sql`
      insert into tc.notification (customer_id, card_id, type, data)
      select c.customer_id, c.id, 'reward_expiring',
        jsonb_build_object('rewardId', w.id::text, 'reward', (select t ->> 'reward' from jsonb_array_elements(rs.ladder) t where (t ->> 'tier')::int = w.tier),
          'days', greatest(1, ceil(extract(epoch from w.expires_at - now()) / 86400))::int)
      from tc.reward w join tc.card c on c.id = w.card_id join tc.rule_set rs on rs.id = c.rule_set_id join tc.customer u on u.id = c.customer_id
      where w.expires_at > now() and w.expires_at <= now() + make_interval(days => ${days}) and c.status = 'active'
        and coalesce((u.notify_prefs ->> 'exp')::boolean, true)
        and not exists (select 1 from tc.redemption d where d.reward_id = w.id and not exists (select 1 from tc.redemption_void x where x.redemption_id = d.id))
      on conflict ((data ->> 'rewardId')) where type = 'reward_expiring' do nothing
      returning id`;
    return rows.length;
  }
}
