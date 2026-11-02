import { Body, Controller, Get, Inject, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { writeAudit, type Sql } from '@temelash/db';
import { SQL } from '../db/db.module';
import { unauthorized } from '../common/api-error';
import type { Actor } from '../auth/actor';
import { AuthGuard, CurrentActor, Roles } from '../auth/auth.guard';
import { isPinFormat, verifySecret } from '../auth/pin';
import { recordWrongPin } from '../auth/lockout';
import { SettingsService } from '../settings/settings.service';
import { cardCount } from '../stamps/cards';

/**
 * Customer Settings → PRIVACY ("Share my visit activity", "Personalised offers",
 * "Download my data") and ACCOUNT → DeleteAccount (a 30-day window, then the
 * phone number is erased; plan section 7, Phase 8).
 */
@Controller('customer')
@UseGuards(AuthGuard)
@Roles('customer')
export class CustomerAccountController {
  constructor(
    @Inject(SQL) private readonly sql: Sql,
    private readonly settings: SettingsService,
  ) {}

  @Get('privacy')
  async privacy(@CurrentActor() a: Actor) {
    const [r] = await this.sql<{ p: Record<string, boolean> }[]>`select privacy_prefs as p from tc.customer where id = ${a.id}`;
    return { share: true, pers: false, ...(r?.p ?? {}) };
  }

  @Post('privacy')
  async setPrivacy(@Body() b: Record<string, unknown>, @CurrentActor() a: Actor) {
    const cur = await this.privacy(a);
    for (const k of ['share', 'pers'] as const) if (typeof b[k] === 'boolean') cur[k] = b[k] as boolean;
    await this.sql.begin(async (tx) => {
      await tx`update tc.customer set privacy_prefs = ${tx.json(cur)} where id = ${a.id}`;
      await writeAudit(tx, { actorType: 'customer', actorId: a.id, type: 'customer.privacy', text: 'Changed privacy settings', detail: cur });
    });
    return cur;
  }

  /** "Download my data": everything we hold about this customer, as one file. Logged. */
  @Get('export')
  async export(@CurrentActor() a: Actor, @Req() req: Request) {
    const [acc] = await this.sql<{ phone: string; language: string; created_at: Date; consent_at: Date | null; notify_prefs: unknown; privacy_prefs: unknown }[]>`
      select phone, language, created_at, consent_at, notify_prefs, privacy_prefs from tc.customer where id = ${a.id}`;
    const cards = await this.sql<{ id: string; shop: string; status: string; created_at: Date }[]>`
      select c.id, b.name as shop, c.status, c.created_at from tc.card c join tc.business b on b.id = c.business_id where c.customer_id = ${a.id} order by c.created_at`;
    const out = [];
    for (const c of cards) {
      const stamps = await this.sql`select at, kind, method from tc.stamp where card_id = ${c.id} order by at`;
      const rewards = await this.sql`
        select w.tier, w.issued_at as "unlockedAt", (select d.at from tc.redemption d where d.reward_id = w.id order by d.at limit 1) as "usedAt"
        from tc.reward w where w.card_id = ${c.id} order by w.tier`;
      out.push({ shop: c.shop, status: c.status, joined: c.created_at, stamps: await cardCount(this.sql, c.id), history: stamps, rewards });
    }
    const notifications = await this.sql`select type, data, created_at as at, read_at as "readAt" from tc.notification where customer_id = ${a.id} order by created_at`;
    await writeAudit(this.sql, { actorType: 'customer', actorId: a.id, ip: req.ip, type: 'customer.export', text: 'Downloaded their data' });
    return {
      exportedAt: new Date(),
      account: { phone: acc.phone, language: acc.language, joined: acc.created_at, consentAt: acc.consent_at },
      preferences: { notifications: acc.notify_prefs, privacy: acc.privacy_prefs },
      cards: out,
      notifications,
    };
  }

  /** DeleteAccount: PIN to confirm; signed out everywhere now, the number erased within the window. */
  @Post('account/delete')
  async delete(@Body() b: Record<string, unknown>, @CurrentActor() a: Actor, @Req() req: Request) {
    const [c] = await this.sql<{ pin_hash: string | null }[]>`select pin_hash from tc.customer where id = ${a.id} and status = 'active'`;
    if (!c || !isPinFormat(b.pin) || !(await verifySecret(c.pin_hash, b.pin))) {
      if (c) {
        const max = await this.settings.number('auth.customer.max_failed_attempts', 5);
        const minutes = await this.settings.number('auth.lock_minutes', 15);
        await this.sql.begin((tx) => recordWrongPin(tx, 'customer', a.id, max, minutes));
      }
      throw unauthorized('wrong_pin');
    }
    const days = await this.settings.number('promise.delete_days', 30);
    return this.sql.begin(async (tx) => {
      await tx`update tc.customer set status = 'deleting', delete_requested_at = now() where id = ${a.id}`;
      await tx`update tc.session set revoked_at = now() where actor_type = 'customer' and actor_id = ${a.id} and revoked_at is null`;
      await writeAudit(tx, { actorType: 'customer', actorId: a.id, ip: req.ip, type: 'customer.delete_requested', text: 'Asked to delete their account', detail: { days } });
      return { erasedWithinDays: days };
    });
  }
}
