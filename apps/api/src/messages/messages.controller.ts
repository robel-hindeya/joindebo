import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { writeAudit, type Sql, type TransactionSql } from '@temelash/db';
import { isLang, t, type Lang } from '@temelash/i18n';
import { SQL } from '../db/db.module';
import { SettingsService } from '../settings/settings.service';
import { ApiError, badRequest, forbidden, notFound } from '../common/api-error';
import type { Actor } from '../auth/actor';
import { AuthGuard, CurrentActor, Roles } from '../auth/auth.guard';
import { InboxService, type Audience } from './inbox.service';

type Tx = Sql | TransactionSql;
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const METHOD_KEY: Record<string, string> = { telebirr: 'owner.soTele', cbe_birr: 'owner.payCbe', cash: 'owner.soCash', bank: 'owner.payBank' };

/**
 * AdminMessages / AdminMessageCompose: messages to owners, how many opened them,
 * "send again" to those who did not; one business; receipts to the owner's inbox;
 * the monthly SMS report.
 */
@Controller('admin')
@UseGuards(AuthGuard)
@Roles('admin')
export class AdminMessagesController {
  constructor(
    @Inject(SQL) private readonly sql: Sql,
    private readonly inbox: InboxService,
  ) {}

  private audit(tx: Tx, a: Actor, req: Request, type: string, txt: string, extra: { businessId?: string; detail?: Record<string, unknown> } = {}) {
    return writeAudit(tx, { actorType: 'admin', actorId: a.id, role: a.adminRole, ip: req.ip, type, text: txt, ...extra });
  }

  /** Messaging owners: Owner and Support (plan section 3). */
  private messenger(a: Actor) {
    if (a.adminRole !== 'owner' && a.adminRole !== 'support') throw forbidden();
  }

  @Get('messages')
  async list(@CurrentActor() a: Actor) {
    this.messenger(a);
    return this.sql`
      select m.id, m.audience, m.audience_label as "audienceLabel", m.title, m.body, m.sms, m.at, ad.name as by,
        (select count(*)::int from tc.admin_message_recipient r where r.message_id = m.id) as recipients,
        (select count(*)::int from tc.admin_message_open o where o.message_id = m.id) as opened
      from tc.admin_message m left join tc.admin_user ad on ad.id = m.admin_id
      where m.audience <> 'system' order by m.at desc limit 200`;
  }

  @Post('messages')
  async compose(@Body() b: Record<string, unknown>, @CurrentActor() a: Actor, @Req() req: Request) {
    this.messenger(a);
    const audience = String(b.audience) as Audience;
    if (!['all', 'due', 'agent', 'biz'].includes(audience)) throw badRequest('bad_audience');
    const title = text(b.title, 120);
    const body = text(b.body, 2000);
    if (title.length < 3 || body.length < 6) throw badRequest('message_needed');
    return this.sql.begin(async (tx) => {
      const agentId = audience === 'agent' ? String(b.agentId ?? '') : null;
      const businessId = audience === 'biz' ? String(b.businessId ?? '') : null;
      let label = { all: 'Every business', due: 'Payment due', agent: '', biz: '' }[audience];
      if (agentId) label = `Businesses of ${(await tx<{ name: string }[]>`select name from tc.agent where id = ${agentId}`)[0]?.name ?? ''}`;
      if (businessId) label = (await tx<{ name: string }[]>`select name from tc.business where id = ${businessId}`)[0]?.name ?? '';
      const to = await this.inbox.recipients(tx, audience, { agentId, businessId });
      if (!to.length) throw badRequest('nobody_to_send');
      const out = await this.inbox.send(tx, { audience, label, title, body, sms: b.sms === true, agentId, businessId, adminId: a.id }, to);
      await this.audit(tx, a, req, 'message.sent', `Sent a message: ${title}`, { businessId: businessId ?? undefined, detail: { messageId: out.id, audience, recipients: out.recipients, sms: b.sms === true } });
      return out;
    });
  }

  /** "Send again" to the owners who have not opened it, by text too. */
  @Post('messages/:id/again')
  async again(@Param('id', ParseUUIDPipe) id: string, @CurrentActor() a: Actor, @Req() req: Request) {
    this.messenger(a);
    return this.sql.begin(async (tx) => {
      const [m] = await tx<{ audience: Audience; audience_label: string; title: string; body: string; agent_id: string | null; business_id: string | null }[]>`
        select audience, audience_label, title, body, agent_id, business_id from tc.admin_message where id = ${id} and audience <> 'system'`;
      if (!m) throw notFound();
      const people = await tx<{ business_id: string; person_id: string; phone: string; lang: string | null }[]>`
        select r.business_id, r.person_id, p.phone, p.prefs ->> 'lang' as lang from tc.admin_message_recipient r join tc.person p on p.id = r.person_id
        where r.message_id = ${id} and p.status = 'active' and not exists (select 1 from tc.admin_message_open o where o.message_id = ${id} and o.person_id = r.person_id)`;
      if (!people.length) throw new ApiError(409, 'everyone_opened');
      const out = await this.inbox.send(tx, { audience: m.audience, label: `${m.audience_label} (did not open)`, title: m.title, body: m.body, sms: true, agentId: m.agent_id, businessId: m.business_id, againOf: id, adminId: a.id },
        people.map((p) => ({ business_id: p.business_id, person_id: p.person_id, phone: p.phone, lang: (isLang(p.lang) ? p.lang : 'en') as Lang })));
      await this.audit(tx, a, req, 'message.sent_again', `Sent a message again: ${m.title}`, { detail: { messageId: out.id, againOf: id, recipients: out.recipients } });
      return out;
    });
  }

  /** "Message the owner" from a business page (payment reminder, verification, closing update). */
  @Post('businesses/:id/message')
  async messageOwner(@Param('id', ParseUUIDPipe) id: string, @Body() b: Record<string, unknown>, @CurrentActor() a: Actor, @Req() req: Request) {
    if (!a.adminRole) throw forbidden();
    const title = text(b.title, 120) || 'Message from Temelash';
    const body = text(b.body, 2000);
    if (body.length < 4) throw badRequest('message_needed');
    return this.sql.begin(async (tx) => {
      const [biz] = await tx<{ name: string }[]>`select name from tc.business where id = ${id}`;
      if (!biz) throw notFound();
      const to = await this.inbox.recipients(tx, 'biz', { businessId: id });
      if (!to.length) throw badRequest('nobody_to_send');
      const out = await this.inbox.send(tx, { audience: 'biz', label: biz.name, title, body, sms: b.sms === true, businessId: id, adminId: a.id }, to);
      await this.audit(tx, a, req, 'message.sent', `Sent a message to the owner of ${biz.name}`, { businessId: id, detail: { messageId: out.id, title } });
      return out;
    });
  }

  /** AdminReceipt "Send the receipt to the owner": it shows in Messages from Temelash. Owner and Finance. */
  @Post('payments/:id/send')
  async sendReceipt(@Param('id', ParseUUIDPipe) id: string, @CurrentActor() a: Actor, @Req() req: Request) {
    if (a.adminRole !== 'owner' && a.adminRole !== 'finance') throw forbidden();
    return this.sql.begin(async (tx) => {
      const [p] = await tx<{ business_id: string; receipt_no: string; amount: number; method: string; at: Date; finance_year: number; name: string }[]>`
        select p.business_id, p.receipt_no, p.amount_birr + coalesce((select sum(x.amount_birr) from tc.payment x where x.fixes = p.id), 0)::int as amount,
          p.method, p.at, p.finance_year, b.name
        from tc.payment p join tc.business b on b.id = p.business_id where p.id = ${id} and p.kind = 'payment'`;
      if (!p) throw notFound();
      const day = new Date(p.at.getTime() + 3 * 3_600_000).toISOString().slice(0, 10);
      const to = await this.inbox.recipients(tx, 'biz', { businessId: p.business_id });
      for (const lang of [...new Set(to.map((r) => r.lang))]) {
        const vars = { a: `${p.amount.toLocaleString('en-US')} Birr`, b: t(lang, METHOD_KEY[p.method] as never), c: day, d: p.finance_year, e: p.receipt_no };
        await this.inbox.send(tx, { audience: 'system', label: '', businessId: p.business_id, sms: false, action: 'plan', adminId: a.id,
          title: t(lang, 'inbox.receiptT', { a: p.receipt_no }), body: t(lang, 'inbox.receiptB', vars) }, to.filter((r) => r.lang === lang));
      }
      await this.audit(tx, a, req, 'payment.receipt_sent', `Sent receipt ${p.receipt_no} to the owner of ${p.name}`, { businessId: p.business_id, detail: { receiptNo: p.receipt_no } });
      return { ok: true };
    });
  }

  /** SMS by month: how many were sent, delivered and failed, and what they cost (plan: monthly cost report). */
  @Get('sms/report')
  async smsReport(@CurrentActor() a: Actor) {
    if (!a.adminRole) throw forbidden();
    return {
      months: await this.sql`
        select to_char(date_trunc('month', coalesce(sent_at, created_at) at time zone 'Africa/Addis_Ababa'), 'YYYY-MM') as month,
          count(*)::int as total, count(*) filter (where status = 'delivered')::int as delivered, count(*) filter (where status = 'sent')::int as sent,
          count(*) filter (where status = 'failed')::int as failed, count(*) filter (where status = 'queued')::int as queued,
          coalesce(sum(cost_birr), 0)::float as "costBirr"
        from tc.sms_outbox group by 1 order by 1 desc limit 24`,
    };
  }
}

/**
 * OwnInbox, OwnMessage, OwnMyRequests and OwnNews*: owners only (managers do
 * not see Temelash messages, requests or news).
 */
@Controller('owner')
@UseGuards(AuthGuard)
@Roles('owner', 'manager')
export class OwnerMessagesController {
  constructor(
    @Inject(SQL) private readonly sql: Sql,
    private readonly settings: SettingsService,
  ) {}

  private ownerOnly(a: Actor) {
    if (a.type !== 'owner') throw forbidden();
  }

  @Get('inbox')
  async inbox(@CurrentActor() a: Actor) {
    this.ownerOnly(a);
    const messages = await this.sql<{ unread: boolean }[]>`
      select m.id, m.title, m.body, m.at, m.action, m.action_ref as "actionRef", not exists (select 1 from tc.admin_message_open o where o.message_id = m.id and o.person_id = ${a.id}) as unread
      from tc.admin_message m join tc.admin_message_recipient r on r.message_id = m.id and r.person_id = ${a.id}
      order by m.at desc limit 100`;
    return { unread: messages.filter((m) => m.unread).length, messages };
  }

  /** Opening a message counts it as opened (AdminMessages shows how many did). */
  @Get('inbox/:id')
  async message(@Param('id', ParseUUIDPipe) id: string, @CurrentActor() a: Actor) {
    this.ownerOnly(a);
    const [m] = await this.sql`
      select m.id, m.title, m.body, m.at, m.action, m.action_ref as "actionRef" from tc.admin_message m
      join tc.admin_message_recipient r on r.message_id = m.id and r.person_id = ${a.id} where m.id = ${id}`;
    if (!m) throw notFound();
    await this.sql`insert into tc.admin_message_open (message_id, person_id) values (${id}, ${a.id}) on conflict do nothing`;
    return m;
  }

  /** Everything the owner asked Temelash for, with its live status. Flags are Temelash's own and not listed. */
  @Get('requests')
  async requests(@CurrentActor() a: Actor) {
    this.ownerOnly(a);
    return this.sql`
      select r.id, r.type, r.created_at as "createdAt", r.updated_at as "updatedAt", r.result, r.payload,
        case when r.stage = 'done' then 'done' when r.stage = 'progress' or r.assignee_id is not null then 'progress' else 'waiting' end as status
      from tc.request r where r.business_id = ${a.businessId!} and r.type not in ('flag', 'signup') order by r.created_at desc`;
  }

  // ---------------------------------------------------------------- OwnNews*
  /** Monday 00:00 East Africa Time of this week, as a UTC instant. */
  private weekStart(): Date {
    const eat = new Date(Date.now() + 3 * 3_600_000);
    const back = (eat.getUTCDay() + 6) % 7;
    return new Date(Date.UTC(eat.getUTCFullYear(), eat.getUTCMonth(), eat.getUTCDate() - back) - 3 * 3_600_000);
  }

  /** Customers news would reach: active cards whose holder allows shop news. */
  private async audience(tx: Tx, businessId: string, kind: 'all' | 'near' | 'quiet') {
    const rows = await tx<{ customer_id: string; card_id: string; count: number; needed: number; last: Date | null }[]>`
      select c.customer_id, c.id as card_id, r.stamps_needed as needed,
        (select count(*)::int from tc.stamp s where s.card_id = c.id and s.kind = 'add' and not exists (select 1 from tc.stamp v where v.voids_stamp_id = s.id)
           and (not s.needs_approval or exists (select 1 from tc.stamp_decision d where d.stamp_id = s.id and d.decision = 'approved'))) as count,
        (select max(s.at) from tc.stamp s where s.card_id = c.id) as last
      from tc.card c join tc.customer u on u.id = c.customer_id join tc.rule_set r on r.id = c.rule_set_id
      where c.business_id = ${businessId} and c.status = 'active' and u.status = 'active' and coalesce((u.notify_prefs ->> 'offer')::boolean, true)`;
    const month = Date.now() - 30 * 86_400_000;
    return rows.filter((r) => kind === 'all' || (kind === 'near' ? r.count === r.needed - 1 : !!r.last && r.last.getTime() < month));
  }

  @Get('news')
  async news(@CurrentActor() a: Actor) {
    this.ownerOnly(a);
    const perWeek = await this.settings.number('news.per_week', 2);
    const [{ n }] = await this.sql<{ n: number }[]>`select count(*)::int as n from tc.shop_news where business_id = ${a.businessId!} and at >= ${this.weekStart()}`;
    const past = await this.sql`select id, audience, texts, recipients, at from tc.shop_news where business_id = ${a.businessId!} order by at desc limit 20`;
    const count = async (k: 'all' | 'near' | 'quiet') => (await this.audience(this.sql, a.businessId!, k)).length;
    return { perWeek, left: Math.max(0, perWeek - n), past, audience: { all: await count('all'), near: await count('near'), quiet: await count('quiet') } };
  }

  @Post('news')
  async sendNews(@Body() b: Record<string, unknown>, @CurrentActor() a: Actor, @Req() req: Request) {
    this.ownerOnly(a);
    const kind = String(b.audience) as 'all' | 'near' | 'quiet';
    if (!['all', 'near', 'quiet'].includes(kind)) throw badRequest('bad_audience');
    const raw = (b.texts ?? {}) as Record<string, { title?: unknown; body?: unknown }>;
    const texts: Record<string, { title: string; body: string }> = {};
    for (const lang of ['en', 'am', 'om']) {
      const tt = text(raw[lang]?.title, 60);
      const bb = typeof raw[lang]?.body === 'string' ? (raw[lang]!.body as string).trim() : '';
      if (bb.length > 140) throw badRequest('too_long');
      if (tt && bb) texts[lang] = { title: tt, body: bb };
    }
    // English is required; other languages fall back to it (OwnNewsCompose).
    if (!texts.en) throw badRequest('english_needed');
    const perWeek = await this.settings.number('news.per_week', 2);
    return this.sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${'news:' + a.businessId}, 0))`;
      const [{ n }] = await tx<{ n: number }[]>`select count(*)::int as n from tc.shop_news where business_id = ${a.businessId!} and at >= ${this.weekStart()}`;
      if (n >= perWeek) throw new ApiError(429, 'news_limit');
      const to = await this.audience(tx, a.businessId!, kind);
      const [news] = await tx<{ id: string }[]>`insert into tc.shop_news (business_id, audience, texts, recipients, person_id)
        values (${a.businessId!}, ${kind}, ${tx.json(texts)}, ${to.length}, ${a.id}) returning id`;
      for (const r of to) {
        await tx`insert into tc.notification (customer_id, card_id, type, data) values (${r.customer_id}, ${r.card_id}, 'news', ${tx.json({ newsId: news.id, texts })})`;
      }
      await writeAudit(tx, { actorType: a.type, actorId: a.id, businessId: a.businessId, ip: req.ip, type: 'news.sent', text: `Shop news sent to ${to.length} customers`, detail: { newsId: news.id, audience: kind, title: texts.en.title } });
      return { id: news.id, recipients: to.length };
    });
  }
}

/** The customer's notification settings and marking notifications read (Notifications, Settings). */
@Controller('customer')
@UseGuards(AuthGuard)
@Roles('customer')
export class CustomerPrefsController {
  constructor(@Inject(SQL) private readonly sql: Sql) {}

  @Get('prefs')
  async prefs(@CurrentActor() a: Actor) {
    const [r] = await this.sql<{ p: Record<string, boolean> }[]>`select notify_prefs as p from tc.customer where id = ${a.id}`;
    return { stamp: true, near: true, exp: true, offer: true, ...(r?.p ?? {}) };
  }

  @Post('prefs')
  async setPrefs(@Body() b: Record<string, unknown>, @CurrentActor() a: Actor) {
    const cur = await this.prefs(a);
    for (const k of ['stamp', 'near', 'exp', 'offer'] as const) if (typeof b[k] === 'boolean') cur[k] = b[k] as boolean;
    await this.sql`update tc.customer set notify_prefs = ${this.sql.json(cur)} where id = ${a.id}`;
    return cur;
  }

  /** Mark one notification, or all of them, as read. */
  @Post('notifications/read')
  async read(@Body() b: Record<string, unknown>, @CurrentActor() a: Actor) {
    const id = typeof b.id === 'string' ? b.id : null;
    await this.sql`update tc.notification set read_at = now() where customer_id = ${a.id} and read_at is null and (${id}::uuid is null or id = ${id})`;
    return { ok: true };
  }
}
