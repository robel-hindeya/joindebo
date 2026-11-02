import { Body, Controller, Get, Inject, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { writeAudit, type Sql } from '@temelash/db';
import { SQL } from '../db/db.module';
import { badRequest, conflict, forbidden, unauthorized } from '../common/api-error';
import type { Actor } from '../auth/actor';
import { AuthGuard, CurrentActor, Roles } from '../auth/auth.guard';
import { isPinFormat, maskPhone, normalizePhone, verifySecret } from '../auth/pin';
import { cardCount } from '../stamps/cards';
import { recordWrongPin } from '../auth/lockout';
import { OtpService } from '../auth/otp.service';
import { TokensService } from '../auth/tokens.service';
import { RateLimitGuard } from '../auth/rate-limit.guard';
import { SettingsService } from '../settings/settings.service';
import { SmsSender, smsLanguage, smsText } from '../sms/sms';
import { addWorkingDays, eatDate, nextRef } from './account';

/**
 * OwnChangePhone*, OwnPrivacy* and OwnCloseBiz*: the owner's own account
 * requests. Changing the phone is open to managers too (their own number);
 * privacy and closing are owners only (OWNONLY).
 */
@Controller('owner')
@UseGuards(AuthGuard)
@Roles('owner', 'manager')
export class OwnerAccountController {
  constructor(
    @Inject(SQL) private readonly sql: Sql,
    private readonly otp: OtpService,
    private readonly tokens: TokensService,
    private readonly settings: SettingsService,
    private readonly sms: SmsSender,
  ) {}

  private ownerOnly(a: Actor) {
    if (a.type !== 'owner') throw forbidden();
  }

  /** The person's PIN, counted against the sign-in lock like any wrong PIN. */
  private async checkPin(a: Actor, pin: unknown) {
    if (!isPinFormat(pin)) throw unauthorized('wrong_pin');
    const [p] = await this.sql<{ pin_hash: string | null }[]>`select pin_hash from tc.person where id = ${a.id}`;
    if (await verifySecret(p?.pin_hash, pin)) return;
    const max = await this.settings.number('auth.business.max_failed_attempts', 5);
    const minutes = await this.settings.number('auth.lock_minutes', 15);
    await this.sql.begin((tx) => recordWrongPin(tx, 'person', a.id, max, minutes));
    throw unauthorized('wrong_pin');
  }

  // ---------------------------------------------------------------- OwnChangePhone*
  @Post('phone/start')
  async phoneStart(@Body() b: Record<string, unknown>, @CurrentActor() a: Actor) {
    const phone = normalizePhone(b.phone);
    if (!phone) throw badRequest('bad_phone');
    const [me] = await this.sql<{ phone: string }[]>`select phone from tc.person where id = ${a.id}`;
    if (me.phone === phone) throw badRequest('same_number');
    await this.checkPin(a, b.pin);
    const [taken] = await this.sql`select 1 from tc.person where business_id = ${a.businessId!} and phone = ${phone} and status = 'active'`;
    if (taken) throw conflict('number_in_use');
    const otpId = await this.sql.begin((tx) => this.otp.issue(tx, phone, 'owner_phone_change', a.id));
    return { ticket: await this.tokens.ticket('phone_change', { sub: a.id, otp: otpId }, 10) };
  }

  @Post('phone/confirm')
  async phoneConfirm(@Body() b: Record<string, unknown>, @CurrentActor() a: Actor, @Req() req: Request) {
    const t = await this.tokens.readTicket<{ sub: string; otp: string }>(b.ticket, 'phone_change');
    if (t.sub !== a.id) throw unauthorized('bad_ticket');
    const { phone } = await this.otp.verify(t.otp, 'owner_phone_change', b.code);
    return this.sql.begin(async (tx) => {
      const [old] = await tx<{ phone: string; name: string }[]>`select phone, name from tc.person where id = ${a.id} for update`;
      await tx`update tc.person set phone = ${phone} where id = ${a.id}`;
      // OwnChangePhone: "We also send an SMS to your old number so you know about the change."
      const lang = await smsLanguage(tx, phone, 'person');
      await this.sms.send(tx, old.phone, 'phone_changed', smsText(lang, 'phoneChanged', { a: `•••${phone.slice(-4)}` }), { language: lang });
      await tx`update tc.session set revoked_at = now() where actor_id = ${a.id} and id <> ${a.sessionId ?? null} and revoked_at is null`;
      await writeAudit(tx, { actorType: a.type, actorId: a.id, businessId: a.businessId!, ip: req.ip, type: 'owner.phone_changed', text: 'Phone number changed', detail: { to: `•••${phone.slice(-4)}` } });
      return { phone };
    });
  }

  // ---------------------------------------------------------------- OwnHelp / OwnMgrHelp
  /** How to reach Temelash; each way shows only once it is set in Admin settings. */
  @Get('help')
  async help() {
    const rows = await this.sql<{ key: string; value: unknown }[]>`select key, value from tc.setting where key in ('support.phone', 'support.telegram')`;
    const v = (k: string) => { const x = rows.find((r) => r.key === k)?.value; return typeof x === 'string' && x.trim() ? x.trim() : null; };
    return { phone: v('support.phone'), telegram: v('support.telegram') };
  }

  /** "Report a problem": a request for the Temelash team, answered by SMS. */
  @Post('help')
  async report(@Body() b: Record<string, unknown>, @CurrentActor() a: Actor, @Req() req: Request) {
    const text = typeof b.text === 'string' ? b.text.trim().slice(0, 1000) : '';
    if (text.length < 3) throw badRequest('text_needed');
    return this.sql.begin(async (tx) => {
      const [me] = await tx<{ name: string; phone: string }[]>`select name, phone from tc.person where id = ${a.id}`;
      await tx`insert into tc.request (type, business_id, payload) values ('help', ${a.businessId!}, ${tx.json({ text, name: me.name, phone: me.phone, role: a.type })})`;
      await writeAudit(tx, { actorType: a.type, actorId: a.id, businessId: a.businessId!, ip: req.ip, type: 'help.reported', text: 'Reported a problem to Temelash' });
      return { ok: true };
    });
  }

  // ---------------------------------------------------------------- OwnPrivacy*
  @Get('privacy/requests')
  async privacyRequests(@CurrentActor() a: Actor) {
    this.ownerOnly(a);
    const rows = await this.sql<{ payload: Record<string, unknown>; stage: string; result: string | null; created_at: Date; updated_at: Date }[]>`
      select payload, stage, result, created_at, updated_at from tc.request where type = 'deletion' and business_id = ${a.businessId!} order by created_at desc limit 50`;
    return rows.map((r) => ({
      last4: r.payload.last4, at: r.created_at, ref: r.payload.code,
      status: r.stage !== 'done' ? 'waiting' : r.result?.startsWith('Rejected') ? 'rejected' : 'done', doneAt: r.stage === 'done' ? r.updated_at : null,
    }));
  }

  /** "A customer asks you to delete their data": the number goes to Temelash, never shown back in full. */
  @Post('privacy/requests')
  async privacyRequest(@Body() b: Record<string, unknown>, @CurrentActor() a: Actor, @Req() req: Request) {
    this.ownerOnly(a);
    const phone = normalizePhone(b.phone);
    if (!phone) throw badRequest('bad_phone');
    return this.sql.begin(async (tx) => {
      const code = await nextRef(tx, 'DEL');
      const [c] = await tx<{ id: string }[]>`
        select u.id from tc.customer u join tc.card c on c.customer_id = u.id and c.business_id = ${a.businessId!} where u.phone = ${phone} limit 1`;
      await tx`insert into tc.request (type, business_id, payload) values ('deletion', ${a.businessId!},
        ${tx.json({ code, phone, last4: phone.slice(-4), customerId: c?.id ?? null, how: 'shop' })})`;
      await writeAudit(tx, { actorType: 'owner', actorId: a.id, businessId: a.businessId!, ip: req.ip, type: 'privacy.requested', text: 'Asked to delete a customer\'s data', detail: { code, last4: phone.slice(-4) } });
      return { ref: code };
    });
  }

  // ---------------------------------------------------------------- OwnCloseBiz* "Download my reports and customer list"
  /** Every card at the shop as a spreadsheet (CSV), phone numbers masked as in the app. Logged. */
  @Get('export')
  async export(@CurrentActor() a: Actor, @Req() req: Request) {
    this.ownerOnly(a);
    const rows = await this.sql<{ id: string; phone: string | null; status: string; joined: Date; last_visit: Date | null; total: number }[]>`
      select c.id, u.phone, c.status, c.created_at as joined, r.stamps_needed as total,
        (select max(s.at) from tc.stamp s where s.card_id = c.id and s.kind = 'add') as last_visit
      from tc.card c join tc.customer u on u.id = c.customer_id join tc.rule_set r on r.id = c.rule_set_id
      where c.business_id = ${a.businessId!} order by c.created_at`;
    const day = (d: Date | null) => (d ? eatDate(d) : '');
    const lines = ['phone,joined,status,stamps,stamps_needed,last_visit'];
    for (const r of rows) lines.push([r.phone ? maskPhone(r.phone) : 'deleted', day(r.joined), r.status, await cardCount(this.sql, r.id), r.total, day(r.last_visit)].join(','));
    await writeAudit(this.sql, { actorType: 'owner', actorId: a.id, businessId: a.businessId!, ip: req.ip, type: 'owner.export', text: 'Downloaded the customer list', detail: { rows: rows.length } });
    return { filename: `customers-${eatDate(new Date())}.csv`, csv: lines.join('\n') + '\n' };
  }

  // ---------------------------------------------------------------- OwnCloseBiz*
  @Get('close')
  async closeState(@CurrentActor() a: Actor) {
    this.ownerOnly(a);
    const answerDays = await this.settings.number('promise.close_answer_days', 3);
    const afterDays = await this.settings.number('promise.close_after_days', 30);
    const [biz] = await this.sql<{ status: string; closing_date: string | null; closing_approved_at: Date | null }[]>`
      select status, to_char(closing_date, 'YYYY-MM-DD') as closing_date, closing_approved_at from tc.business where id = ${a.businessId!}`;
    if (biz.status === 'closing' && biz.closing_date) {
      const daysLeft = Math.max(0, Math.round((Date.parse(biz.closing_date) - Date.parse(eatDate(new Date()))) / 86_400_000));
      return { state: 'approved', answerDays, afterDays, approvedAt: biz.closing_approved_at, closesOn: biz.closing_date, daysLeft };
    }
    const [r] = await this.sql<{ payload: Record<string, unknown>; created_at: Date }[]>`
      select payload, created_at from tc.request where type = 'closing' and business_id = ${a.businessId!} and stage <> 'done' order by created_at desc limit 1`;
    if (r) return { state: 'pending', answerDays, afterDays, ref: r.payload.code, sentAt: r.created_at, answerBy: r.payload.answerBy };
    return { state: 'none', answerDays, afterDays };
  }

  @Post('close')
  async close(@Body() b: Record<string, unknown>, @CurrentActor() a: Actor, @Req() req: Request) {
    this.ownerOnly(a);
    const reason = typeof b.reason === 'string' ? b.reason.trim().slice(0, 200) : '';
    if (!reason) throw badRequest('reason_needed');
    await this.checkPin(a, b.pin);
    const days = await this.settings.number('promise.close_answer_days', 3);
    return this.sql.begin(async (tx) => {
      const [busy] = await tx`select 1 from tc.request where type = 'closing' and business_id = ${a.businessId!} and stage <> 'done'`;
      const [biz] = await tx<{ status: string }[]>`select status from tc.business where id = ${a.businessId!} for update`;
      if (busy || biz.status === 'closing') throw conflict('already_asked');
      const code = await nextRef(tx, 'CLS');
      const answerBy = addWorkingDays(new Date(), days);
      await tx`insert into tc.request (type, business_id, payload) values ('closing', ${a.businessId!}, ${tx.json({ code, reason, answerBy })})`;
      await writeAudit(tx, { actorType: 'owner', actorId: a.id, businessId: a.businessId!, ip: req.ip, type: 'closing.requested', text: 'Asked to close the business', detail: { code, reason } });
      return { ref: code, answerBy };
    });
  }

  /** "Cancel my request" while waiting, or "Keep my business open" after approval. */
  @Post('close/cancel')
  async closeCancel(@CurrentActor() a: Actor, @Req() req: Request) {
    this.ownerOnly(a);
    return this.sql.begin(async (tx) => {
      const [biz] = await tx<{ status: string; status_before_closing: string | null }[]>`
        select status, status_before_closing from tc.business where id = ${a.businessId!} for update`;
      if (biz.status === 'closing') {
        await tx`update tc.business set status = ${biz.status_before_closing ?? 'active'}, closing_date = null, closing_approved_at = null, status_before_closing = null where id = ${a.businessId!}`;
      } else {
        const rows = await tx`update tc.request set stage = 'done', result = 'Cancelled by the owner', updated_at = now()
          where type = 'closing' and business_id = ${a.businessId!} and stage <> 'done' returning id`;
        if (!rows.length) throw conflict('nothing_to_cancel');
      }
      await writeAudit(tx, { actorType: 'owner', actorId: a.id, businessId: a.businessId!, ip: req.ip, type: 'closing.cancelled', text: 'Closing request cancelled' });
      return { state: 'none' };
    });
  }
}

/** OwnLostPhone*: before sign-in, "I no longer have this phone number". Temelash calls them back. */
@Controller('auth/business')
@UseGuards(RateLimitGuard)
export class LostPhoneController {
  constructor(@Inject(SQL) private readonly sql: Sql) {}

  @Post('lost-phone')
  async lostPhone(@Body() b: Record<string, unknown>, @Req() req: Request) {
    const businessName = typeof b.business === 'string' ? b.business.trim().slice(0, 120) : '';
    const name = typeof b.name === 'string' ? b.name.trim().slice(0, 120) : '';
    const newPhone = normalizePhone(b.phone);
    const oldPhone = b.old ? normalizePhone(b.old) : null;
    if (!businessName || !name || !newPhone) throw badRequest('fill_in');
    return this.sql.begin(async (tx) => {
      // Match the business by the old number (an owner on record), else by its exact name.
      const [byOld] = oldPhone ? await tx<{ business_id: string; id: string }[]>`
        select business_id, id from tc.person where phone = ${oldPhone} and role = 'owner' and status = 'active' limit 1` : [];
      const [byName] = byOld ? [] : await tx<{ id: string }[]>`
        select id from tc.business where lower(name) = lower(${businessName}) and status not in ('closed', 'rejected') limit 2`;
      const businessId = byOld?.business_id ?? byName?.id ?? null;
      const code = await nextRef(tx, 'LP');
      await tx`insert into tc.request (type, business_id, payload) values ('lost_phone', ${businessId},
        ${tx.json({ code, businessName, name, newPhone, oldPhone, matched: !!businessId, personId: byOld?.id ?? null })})`;
      await writeAudit(tx, { actorType: 'system', businessId: businessId ?? undefined, ip: req.ip, type: 'lost_phone.requested', text: `Lost-phone request for ${businessName}`, detail: { code } });
      return { ref: code };
    });
  }
}
