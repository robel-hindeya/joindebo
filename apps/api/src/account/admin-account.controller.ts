import { Body, Controller, Inject, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { writeAudit, type Sql, type TransactionSql } from '@temelash/db';
import { SQL } from '../db/db.module';
import { badRequest, conflict, notFound } from '../common/api-error';
import type { Actor } from '../auth/actor';
import { AuthGuard, CurrentActor, Roles } from '../auth/auth.guard';
import { SettingsService } from '../settings/settings.service';
import { SmsSender, smsLanguage, smsText } from '../sms/sms';
import { InboxService } from '../messages/inbox.service';
import { anonymiseCustomer, eatDate } from './account';

type Tx = Sql | TransactionSql;

/**
 * AdminReqLostPhone, AdminReqDeletion and AdminReqClosing decisions, and
 * "Cancel the closing" on a business (AdminBusiness). Every step is logged
 * and the owner is told.
 */
@Controller('admin')
@UseGuards(AuthGuard)
@Roles('admin')
export class AdminAccountController {
  constructor(
    @Inject(SQL) private readonly sql: Sql,
    private readonly settings: SettingsService,
    private readonly sms: SmsSender,
    private readonly inbox: InboxService,
  ) {}

  private audit(tx: Tx, a: Actor, req: Request, type: string, text: string, extra: { businessId?: string; detail?: Record<string, unknown> } = {}) {
    return writeAudit(tx, { actorType: 'admin', actorId: a.id, role: a.adminRole, ip: req.ip, type, text, ...extra });
  }

  private async open(tx: Tx, id: string, type: string) {
    const [r] = await tx<{ business_id: string | null; payload: Record<string, unknown>; name: string | null }[]>`
      select r.business_id, r.payload, b.name from tc.request r left join tc.business b on b.id = r.business_id
      where r.id = ${id} and r.type = ${type} and r.stage <> 'done' for update of r`;
    if (!r) throw notFound();
    return r;
  }

  private done(tx: Tx, id: string, a: Actor, result: string) {
    return tx`update tc.request set stage = 'done', result = ${result}, assignee_id = coalesce(assignee_id, ${a.id}), updated_at = now() where id = ${id}`;
  }

  /** AdminReqLostPhone "Change the number": the owner's account moves to the new number. */
  @Post('requests/:id/phone')
  async phone(@Param('id', ParseUUIDPipe) id: string, @Body() b: Record<string, unknown>, @CurrentActor() a: Actor, @Req() req: Request) {
    return this.sql.begin(async (tx) => {
      const r = await this.open(tx, id, 'lost_phone');
      const businessId = r.business_id ?? (typeof b.businessId === 'string' ? b.businessId : null);
      if (!businessId) throw badRequest('pick_business');
      const newPhone = String(r.payload.newPhone);
      const personId = typeof r.payload.personId === 'string' ? r.payload.personId : null;
      const [p] = await tx<{ id: string; phone: string }[]>`
        select id, phone from tc.person where business_id = ${businessId} and status = 'active'
          and (id::text = ${personId ?? ''} or (${personId}::uuid is null and role = 'owner'))
        order by created_at limit 1`;
      if (!p) throw conflict('no_owner');
      const [taken] = await tx`select 1 from tc.person where business_id = ${businessId} and phone = ${newPhone} and id <> ${p.id}`;
      if (taken) throw conflict('number_in_use');
      await tx`update tc.person set phone = ${newPhone}, failed_attempts = 0, locked_until = null where id = ${p.id}`;
      await tx`update tc.session set revoked_at = now() where actor_id = ${p.id} and revoked_at is null`;
      if (!r.business_id) await tx`update tc.request set business_id = ${businessId} where id = ${id}`;
      await this.done(tx, id, a, 'Number changed');
      const lang = await smsLanguage(tx, newPhone, 'person');
      await this.sms.send(tx, newPhone, 'phone_moved', smsText(lang, 'phoneMoved', {}), { language: lang });
      await this.audit(tx, a, req, 'request.phone_changed', 'Changed the phone number of an owner after a lost-phone request', { businessId, detail: { requestId: id, from: `•••${p.phone.slice(-4)}`, to: `•••${newPhone.slice(-4)}` } });
      return { ok: true };
    });
  }

  /** AdminReqDeletion "Delete this customer's data": name and phone go; stamp counts stay. */
  @Post('requests/:id/delete-customer')
  async deleteCustomer(@Param('id', ParseUUIDPipe) id: string, @CurrentActor() a: Actor, @Req() req: Request) {
    return this.sql.begin(async (tx) => {
      const r = await this.open(tx, id, 'deletion');
      const [c] = r.payload.customerId ? [{ id: String(r.payload.customerId) }] : await tx<{ id: string }[]>`
        select u.id from tc.customer u join tc.card c on c.customer_id = u.id and c.business_id = ${r.business_id} where u.phone = ${String(r.payload.phone ?? '')} limit 1`;
      if (!c) throw conflict('no_customer');
      await anonymiseCustomer(tx, c.id);
      await this.done(tx, id, a, 'Customer data deleted');
      await this.audit(tx, a, req, 'request.customer_deleted', `Deleted a customer's data at ${r.name ?? 'a shop'}`, { businessId: r.business_id ?? undefined, detail: { requestId: id, customerId: c.id } });
      return { ok: true };
    });
  }

  /** OwnHelp "Report a problem": closed once someone has answered the owner. */
  @Post('requests/:id/answered')
  async answered(@Param('id', ParseUUIDPipe) id: string, @Body() b: Record<string, unknown>, @CurrentActor() a: Actor, @Req() req: Request) {
    const what = typeof b.reason === 'string' ? b.reason.trim().slice(0, 500) : '';
    if (!what) throw badRequest('reason_needed');
    return this.sql.begin(async (tx) => {
      const r = await this.open(tx, id, 'help');
      await this.done(tx, id, a, `Answered: ${what}`);
      await this.audit(tx, a, req, 'request.answered', `Answered a help request from ${r.name ?? 'a business'}`, { businessId: r.business_id ?? undefined, detail: { requestId: id, answer: what } });
      return { ok: true };
    });
  }

  /** AdminReqClosing "Approve the closing": everything works until the closing date. */
  @Post('requests/:id/close-approve')
  async closeApprove(@Param('id', ParseUUIDPipe) id: string, @CurrentActor() a: Actor, @Req() req: Request) {
    const days = await this.settings.number('promise.close_after_days', 30);
    return this.sql.begin(async (tx) => {
      const r = await this.open(tx, id, 'closing');
      const on = eatDate(new Date(Date.now() + days * 86_400_000));
      const [biz] = await tx<{ status: string }[]>`
        update tc.business set status_before_closing = status, status = 'closing', closing_date = ${on}, closing_approved_at = now()
        where id = ${r.business_id} and status in ('trial', 'active', 'paused') returning status_before_closing as status`;
      if (!biz) throw conflict('cannot_close');
      await this.done(tx, id, a, `Approved, closes ${on}`);
      await this.inbox.system(tx, r.business_id!, 'inbox.closeOkT', 'inbox.closeOkB', { a: on, b: days });
      for (const o of await tx<{ phone: string }[]>`select phone from tc.person where business_id = ${r.business_id} and role = 'owner' and status = 'active'`) {
        const lang = await smsLanguage(tx, o.phone, 'person');
        await this.sms.send(tx, o.phone, 'closing_approved', smsText(lang, 'closingApproved', { a: r.name ?? '', b: on }), { language: lang });
      }
      await this.audit(tx, a, req, 'request.closing_approved', `Approved closing of ${r.name}`, { businessId: r.business_id!, detail: { requestId: id, closesOn: on } });
      return { closesOn: on };
    });
  }

  @Post('requests/:id/close-decline')
  async closeDecline(@Param('id', ParseUUIDPipe) id: string, @Body() b: Record<string, unknown>, @CurrentActor() a: Actor, @Req() req: Request) {
    const reason = typeof b.reason === 'string' ? b.reason.trim().slice(0, 500) : '';
    if (!reason) throw badRequest('reason_needed');
    return this.sql.begin(async (tx) => {
      const r = await this.open(tx, id, 'closing');
      await this.done(tx, id, a, `Declined: ${reason}`);
      await this.inbox.system(tx, r.business_id!, 'inbox.closeNoT', 'inbox.closeNoB', { a: reason });
      await this.audit(tx, a, req, 'request.closing_declined', `Declined closing of ${r.name}`, { businessId: r.business_id!, detail: { requestId: id, reason } });
      return { ok: true };
    });
  }

  /** AdminBusiness "Cancel the closing": the owner changed their mind. */
  @Post('businesses/:id/cancel-closing')
  async cancelClosing(@Param('id', ParseUUIDPipe) id: string, @CurrentActor() a: Actor, @Req() req: Request) {
    return this.sql.begin(async (tx) => {
      const [biz] = await tx<{ name: string }[]>`
        update tc.business set status = coalesce(status_before_closing, 'active'), closing_date = null, closing_approved_at = null, status_before_closing = null
        where id = ${id} and status = 'closing' returning name`;
      if (!biz) throw conflict('not_closing');
      await this.inbox.system(tx, id, 'inbox.closeKeptT', 'inbox.closeKeptB', { a: biz.name });
      await this.audit(tx, a, req, 'business.closing_cancelled', `Cancelled the closing of ${biz.name}`, { businessId: id });
      return { ok: true };
    });
  }
}
