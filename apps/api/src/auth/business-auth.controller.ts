import { randomInt } from 'node:crypto';
import { Body, Controller, HttpCode, Inject, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { writeAudit, type Sql, type TransactionSql } from '@temelash/db';
import { SQL } from '../db/db.module';
import { badRequest, conflict } from '../common/api-error';
import { requestMeta } from './auth.guard';
import { OtpService } from './otp.service';
import { PeopleService, type PersonRow } from './people.service';
import { hashSecret, isPinFormat, isWeakPin, maskPhone, normalizePhone } from './pin';
import { RateLimitGuard } from './rate-limit.guard';
import { TokensService } from './tokens.service';

/**
 * The business sign-in page, for owners and branch managers (OwnSignIn: "For
 * shop owners and managers. Cashiers sign in on the staff page."): phone + PIN,
 * then a 6-digit SMS code. Also sign-up (OwnSignUp) and forgot PIN (OwnForgot).
 */
@Controller('auth/business')
@UseGuards(RateLimitGuard)
export class BusinessAuthController {
  constructor(
    @Inject(SQL) private readonly sql: Sql,
    private readonly tokens: TokensService,
    private readonly otp: OtpService,
    private readonly people: PeopleService,
  ) {}

  @Post('signin')
  @HttpCode(200)
  async signin(@Body() b: Record<string, unknown>) {
    const phone = normalizePhone(b.phone);
    if (!phone || !isPinFormat(b.pin)) throw badRequest('missing');
    const found = await this.people.find(phone, ['owner', 'manager']);
    const [p] = await this.people.checkPin(found, b.pin, 'auth.business.max_failed_attempts');
    const otpId = await this.otp.issue(this.sql, phone, 'owner_signin', p.id);
    return { ticket: await this.tokens.ticket('business_signin_code', { otp: otpId }), maskedPhone: maskPhone(phone) };
  }

  @Post('signin/verify')
  @HttpCode(200)
  async signinVerify(@Body() b: Record<string, unknown>, @Req() req: Request) {
    const t = await this.tokens.readTicket<{ otp: string }>(b.ticket, 'business_signin_code');
    const { subjectId } = await this.otp.verify(t.otp, 'owner_signin', b.code);
    const [p] = await this.sql<PersonRow[]>`
      select p.id, p.business_id, b.name as business_name, p.phone, p.role, p.pin_hash, p.pin_set_at, p.pin_must_change, p.locked_until
      from tc.person p join tc.business b on b.id = p.business_id where p.id = ${subjectId}`;
    const reason = await this.people.pinChangeReason(p);
    if (reason) return { next: 'set_pin', reason, changeTicket: await this.tokens.ticket('business_set_pin', { sub: p.id }) };
    return this.startSession(this.sql, p, req);
  }

  /** First PIN for a new manager (OwnMgrFirstPin) or an expired PIN. */
  @Post('set-pin')
  @HttpCode(200)
  async setPin(@Body() b: Record<string, unknown>, @Req() req: Request) {
    const t = await this.tokens.readTicket<{ sub: string }>(b.ticket, 'business_set_pin');
    return this.sql.begin(async (tx) => {
      await this.people.setOwnPin(tx, t.sub, b.pin);
      const [p] = await tx<PersonRow[]>`select id, business_id, role from tc.person where id = ${t.sub}`;
      return this.startSession(tx, p, req);
    });
  }

  /** Sign-up step 1 (OwnSignUp): check the form and text a code. */
  @Post('signup')
  @HttpCode(200)
  async signup(@Body() b: Record<string, unknown>) {
    const businessName = String(b.businessName ?? '').trim();
    const ownerName = String(b.ownerName ?? '').trim();
    const phone = normalizePhone(b.phone);
    const agentRaw = String(b.agentPhone ?? '').trim();
    const agentPhone = agentRaw ? normalizePhone(agentRaw) : null;
    const fields: string[] = [];
    if (businessName.length < 2) fields.push('businessName');
    if (ownerName.length < 2) fields.push('ownerName');
    if (!phone) fields.push('phone');
    if (agentRaw && !agentPhone) fields.push('agentPhone');
    if (fields.length) throw badRequest('invalid', { fields });
    const [taken] = await this.sql`select 1 from tc.person where phone = ${phone} and role = 'owner' and status = 'active'`;
    if (taken) throw conflict('phone_in_use');
    const otpId = await this.otp.issue(this.sql, phone!, 'owner_signup', null, { businessName, ownerName, agentPhone });
    return { ticket: await this.tokens.ticket('business_signup_code', { otp: otpId }), maskedPhone: maskPhone(phone!) };
  }

  @Post('signup/verify')
  @HttpCode(200)
  async signupVerify(@Body() b: Record<string, unknown>) {
    const t = await this.tokens.readTicket<{ otp: string }>(b.ticket, 'business_signup_code');
    const { phone, payload } = await this.otp.verify(t.otp, 'owner_signup', b.code);
    return { ticket: await this.tokens.ticket('business_signup_pin', { phone, ...payload }, 30) };
  }

  /** Sign-up step 3: choose a PIN; the business is created and waits for Temelash's approval. */
  @Post('signup/pin')
  async signupPin(@Body() b: Record<string, unknown>, @Req() req: Request) {
    const t = await this.tokens.readTicket<{ phone: string; businessName: string; ownerName: string; agentPhone: string | null }>(b.ticket, 'business_signup_pin');
    if (!isPinFormat(b.pin)) throw badRequest('bad_pin');
    if (isWeakPin(b.pin, t.phone)) throw badRequest('weak_pin');
    const pinHash = await hashSecret(b.pin);
    return this.sql.begin(async (tx) => {
      const [taken] = await tx`select 1 from tc.person where phone = ${t.phone} and role = 'owner' and status = 'active'`;
      if (taken) throw conflict('phone_in_use');
      const [agent] = t.agentPhone ? await tx<{ id: string }[]>`select id from tc.agent where phone = ${t.agentPhone} and status = 'active'` : [];
      const [biz] = await tx<{ id: string }[]>`
        insert into tc.business (name, category, city, status, agent_id, shop_code)
        values (${t.businessName}, 'other', '', 'pending', ${agent?.id ?? null}, ${await this.newShopCode(tx, t.businessName)})
        returning id`;
      await tx`insert into tc.branch (business_id, name) values (${biz.id}, ${t.businessName})`;
      const [owner] = await tx<{ id: string }[]>`
        insert into tc.person (business_id, phone, name, role, pin_hash, pin_set_at, pin_must_change)
        values (${biz.id}, ${t.phone}, ${t.ownerName}, 'owner', ${pinHash}, now(), false) returning id`;
      await tx`insert into tc.request (type, business_id, stage, payload)
               values ('signup', ${biz.id}, 'new', ${tx.json({ ownerName: t.ownerName, phone: t.phone, agentPhone: t.agentPhone, agentMatched: !!agent })})`;
      await writeAudit(tx, {
        actorType: 'owner', actorId: owner.id, role: 'owner', businessId: biz.id, type: 'business.signup',
        text: `Signed up ${t.businessName}; waiting for approval`, detail: { agentMatched: !!agent },
      });
      return this.tokens.issue(tx, { type: 'owner', id: owner.id, businessId: biz.id }, requestMeta(req));
    });
  }

  /** Forgot PIN (OwnForgot) step 1: text a code. Same answer for unknown phones. */
  @Post('forgot')
  @HttpCode(200)
  async forgot(@Body() b: Record<string, unknown>) {
    const phone = normalizePhone(b.phone);
    if (!phone) throw badRequest('missing');
    const [p] = await this.people.find(phone, ['owner', 'manager']);
    const otpId = p ? await this.otp.issue(this.sql, phone, 'owner_reset', p.id) : null;
    return { ticket: await this.tokens.ticket('business_forgot', { otp: otpId }), maskedPhone: maskPhone(phone) };
  }

  /** Step 2: the code and the new PIN together, as on the OwnForgot board. */
  @Post('forgot/finish')
  @HttpCode(200)
  async forgotFinish(@Body() b: Record<string, unknown>) {
    const t = await this.tokens.readTicket<{ otp: string | null }>(b.ticket, 'business_forgot');
    if (!isPinFormat(b.pin)) throw badRequest('bad_pin');
    // Refuse a weak PIN before the code is used up, so the person can try another.
    if (isWeakPin(b.pin)) throw badRequest('weak_pin');
    const { subjectId } = await this.otp.verify(t.otp, 'owner_reset', b.code);
    await this.sql.begin((tx) => this.people.setOwnPin(tx, subjectId!, b.pin));
    return { ok: true };
  }

  private async startSession(tx: Sql | TransactionSql, p: Pick<PersonRow, 'id' | 'business_id' | 'role'>, req: Request) {
    const type = p.role === 'manager' ? 'manager' : 'owner';
    const branchId = type === 'manager' ? await this.people.managerBranch(p.id) : undefined;
    await writeAudit(tx, { actorType: type, actorId: p.id, role: p.role, businessId: p.business_id, type: 'auth.signin', text: 'Signed in', ip: req.ip });
    return this.tokens.issue(tx, { type, id: p.id, businessId: p.business_id, branchId }, requestMeta(req));
  }

  private async newShopCode(tx: TransactionSql, name: string): Promise<string> {
    const letters = name.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4).padEnd(4, 'X');
    for (let i = 0; ; i++) {
      const code = letters + String(i < 50 ? randomInt(10, 100) : randomInt(1000, 10000));
      const [used] = await tx`select 1 from tc.business where shop_code = ${code}`;
      if (!used) return code;
    }
  }
}
