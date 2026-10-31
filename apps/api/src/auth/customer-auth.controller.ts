import { Body, Controller, HttpCode, Inject, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { writeAudit, type Sql } from '@temelash/db';
import { isLang } from '@temelash/i18n';
import { SQL } from '../db/db.module';
import { SettingsService } from '../settings/settings.service';
import { badRequest, conflict, locked, notFound, unauthorized } from '../common/api-error';
import { addCard } from '../stamps/cards';
import { requestMeta } from './auth.guard';
import { clearWrongPins, isLocked, recordWrongPin } from './lockout';
import { OtpService } from './otp.service';
import { burnTime, hashSecret, isPinFormat, normalizePhone, verifySecret } from './pin';
import { RateLimitGuard } from './rate-limit.guard';
import { TokensService } from './tokens.service';

/**
 * Customer accounts (ScanJoin board): phone + 6-digit PIN, no SMS at sign-up,
 * PIN reset by SMS code. Joining a shop's card is added in Phase 2.
 */
@Controller('auth/customer')
@UseGuards(RateLimitGuard)
export class CustomerAuthController {
  constructor(
    @Inject(SQL) private readonly sql: Sql,
    private readonly tokens: TokensService,
    private readonly otp: OtpService,
    private readonly settings: SettingsService,
  ) {}

  @Post('join')
  async join(@Body() b: Record<string, unknown>, @Req() req: Request) {
    const phone = normalizePhone(b.phone);
    if (!phone) throw badRequest('bad_phone');
    if (!isPinFormat(b.pin)) throw badRequest('bad_pin');
    if (b.consent !== true) throw badRequest('no_consent');
    const language = isLang(b.language) ? b.language : 'en';
    const [shop] = await this.sql`select id from tc.business where shop_code = ${String(b.shopCode ?? '').toUpperCase()} and status in ('trial', 'active')`;
    if (!shop) throw notFound('no_shop');
    const pinHash = await hashSecret(b.pin);

    return this.sql.begin(async (tx) => {
      const [c] = await tx<{ id: string }[]>`
        insert into tc.customer (phone, pin_hash, language, consent_at) values (${phone}, ${pinHash}, ${language}, now())
        on conflict (phone) do nothing returning id`;
      if (!c) throw conflict('already_member');
      const cardAdded = await addCard(tx, c.id, shop.id);
      await writeAudit(tx, { actorType: 'customer', actorId: c.id, businessId: shop.id, type: 'customer.join', text: 'Customer created an account', detail: { cardAdded } });
      return { ...(await this.tokens.issue(tx, { type: 'customer', id: c.id }, requestMeta(req))), cardAdded };
    });
  }

  @Post('signin')
  @HttpCode(200)
  async signin(@Body() b: Record<string, unknown>, @Req() req: Request) {
    const phone = normalizePhone(b.phone);
    if (!phone) throw badRequest('bad_phone');
    if (!isPinFormat(b.pin)) throw badRequest('bad_pin');
    const [c] = await this.sql<{ id: string; pin_hash: string | null; locked_until: Date | null }[]>`
      select id, pin_hash, locked_until from tc.customer where phone = ${phone} and status = 'active'`;
    if (!c) {
      await burnTime(b.pin);
      throw unauthorized('wrong_pin');
    }
    if (isLocked(c)) throw locked(c.locked_until!);

    const ok = await verifySecret(c.pin_hash, b.pin);
    const max = await this.settings.number('auth.customer.max_failed_attempts', 5);
    const minutes = await this.settings.number('auth.lock_minutes', 15);
    return this.sql.begin(async (tx) => {
      if (!ok) {
        const r = await recordWrongPin(tx, 'customer', c.id, max, minutes);
        await writeAudit(tx, { actorType: 'customer', actorId: c.id, type: r.locked ? 'auth.locked' : 'auth.pin_wrong', text: r.locked ? 'Sign-in locked after wrong PINs' : 'Wrong PIN' });
        return r;
      }
      await clearWrongPins(tx, 'customer', c.id);
      // Signing in from a shop's join page adds that shop's card ("added to your wallet").
      let cardAdded = false;
      if (b.shopCode) {
        const [shop] = await tx<{ id: string }[]>`select id from tc.business where shop_code = ${String(b.shopCode).toUpperCase()} and status in ('trial', 'active')`;
        if (shop) {
          cardAdded = await addCard(tx, c.id, shop.id);
          if (cardAdded) await writeAudit(tx, { actorType: 'customer', actorId: c.id, businessId: shop.id, type: 'card.added', text: 'Added a card on sign-in' });
        }
      }
      return { ...(await this.tokens.issue(tx, { type: 'customer', id: c.id }, requestMeta(req))), cardAdded };
    }).then((r) => {
      // Throw outside the transaction so the failed try stays recorded.
      if ('locked' in r) throw r.locked ? locked(r.lockedUntil) : unauthorized('wrong_pin', { triesLeft: r.triesLeft });
      return r;
    });
  }

  /** Step 1 of reset: send a code. Looks the same for unknown phones and sends nothing. */
  @Post('reset')
  @HttpCode(200)
  async reset(@Body() b: Record<string, unknown>) {
    const phone = normalizePhone(b.phone);
    if (!phone) throw badRequest('bad_phone');
    const [c] = await this.sql<{ id: string }[]>`select id from tc.customer where phone = ${phone} and status = 'active'`;
    const otpId = c ? await this.otp.issue(this.sql, phone, 'customer_reset', c.id) : null;
    return { ticket: await this.tokens.ticket('customer_reset_code', { otp: otpId }) };
  }

  @Post('reset/verify')
  @HttpCode(200)
  async resetVerify(@Body() b: Record<string, unknown>) {
    const t = await this.tokens.readTicket<{ otp: string | null }>(b.ticket, 'customer_reset_code');
    const { subjectId } = await this.otp.verify(t.otp, 'customer_reset', b.code);
    return { ticket: await this.tokens.ticket('customer_reset_pin', { sub: subjectId }) };
  }

  @Post('reset/pin')
  @HttpCode(200)
  async resetPin(@Body() b: Record<string, unknown>) {
    const t = await this.tokens.readTicket<{ sub: string }>(b.ticket, 'customer_reset_pin');
    if (!isPinFormat(b.pin)) throw badRequest('bad_pin');
    const pinHash = await hashSecret(b.pin);
    await this.sql.begin(async (tx) => {
      await this.tokens.spendTicket(tx, b.ticket, 'customer_reset_pin');
      await tx`update tc.customer set pin_hash = ${pinHash}, failed_attempts = 0, locked_until = null where id = ${t.sub}`;
      await this.tokens.revokeAll(tx, 'customer', t.sub);
      await writeAudit(tx, { actorType: 'customer', actorId: t.sub, type: 'auth.pin_reset', text: 'PIN reset with an SMS code' });
    });
    return { ok: true };
  }
}
