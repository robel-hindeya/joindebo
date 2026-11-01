import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { writeAudit, type Sql } from '@temelash/db';
import { SQL } from '../db/db.module';
import { badRequest, notFound } from '../common/api-error';
import type { Actor } from '../auth/actor';
import { AuthGuard, CurrentActor, Roles } from '../auth/auth.guard';
import { ALERT_DEFAULTS, prefsOf, type AlertPrefs } from './alerts.service';

/** The open flags of a business an owner or manager sees on Today (managers: their branch). */
export async function openAlerts(sql: Sql, a: Actor) {
  const rows = await sql<Array<{ id: string; payload: Record<string, unknown>; created_at: Date; staff: string | null }>>`
    select r.id, r.payload, r.created_at, p.name as staff from tc.request r
    left join tc.person p on p.id::text = r.payload ->> 'personId'
    where r.type = 'flag' and r.business_id = ${a.businessId!} and r.stage <> 'done' and r.owner_dismissed_at is null
      and (${a.type} = 'owner' or r.payload ->> 'branchId' = ${a.branchId ?? ''})
    order by r.created_at desc`;
  return rows.map((r) => ({ id: r.id, kind: r.payload.kind as string, staff: r.staff, at: r.created_at }));
}

/** OwnUnusual (the alert) and OwnAlertSet (what we tell you and how). */
@Controller('owner')
@UseGuards(AuthGuard)
@Roles('owner', 'manager')
export class OwnerAlertsController {
  constructor(@Inject(SQL) private readonly sql: Sql) {}

  @Get('alerts/:id')
  async alert(@Param('id', ParseUUIDPipe) id: string, @CurrentActor() a: Actor) {
    const [r] = await this.sql<Array<{ id: string; payload: Record<string, unknown>; created_at: Date; staff: string | null; branch: string | null }>>`
      select r.id, r.payload, r.created_at, p.name as staff, br.name as branch from tc.request r
      left join tc.person p on p.id::text = r.payload ->> 'personId'
      left join tc.branch br on br.id::text = r.payload ->> 'branchId'
      where r.id = ${id} and r.type = 'flag' and r.business_id = ${a.businessId!}
        and (${a.type} = 'owner' or r.payload ->> 'branchId' = ${a.branchId ?? ''})`;
    if (!r) throw notFound();
    const p = r.payload;
    const out: Record<string, unknown> = { id: r.id, kind: p.kind, at: r.created_at, staff: r.staff, branch: r.branch, limit: p.limit };
    if (p.kind === 'stamps_per_hour') {
      // The hour's stamps by this cashier: how many, over how many phones (cards), the most on one.
      const [s] = await this.sql<{ stamps: number; phones: number; top: number; first: Date | null; last: Date | null }[]>`
        with h as (
          select s.card_id, s.at from tc.stamp s where s.person_id = ${String(p.personId)} and s.method in ('scan', 'typed') and s.kind = 'add'
            and to_char(date_trunc('hour', s.at at time zone 'Africa/Addis_Ababa'), 'YYYY-MM-DD"T"HH24') = ${String(p.hour)})
        select count(*)::int as stamps, count(distinct card_id)::int as phones,
          coalesce((select max(n) from (select count(*)::int as n from h group by card_id) x), 0) as top, min(at) as first, max(at) as last from h`;
      Object.assign(out, s, { personId: p.personId });
    } else if (p.kind === 'hand_typed_share') {
      Object.assign(out, { share: p.share, typed: p.typed, total: p.total, week: p.week });
    } else {
      Object.assign(out, { cards: p.cards, hour: p.hour });
    }
    return out;
  }

  /** "It is fine, dismiss": hidden for the business; Temelash decides on its own copy. */
  @Post('alerts/:id/dismiss')
  async dismiss(@Param('id', ParseUUIDPipe) id: string, @CurrentActor() a: Actor, @Req() req: Request) {
    return this.sql.begin(async (tx) => {
      const [r] = await tx`
        update tc.request set owner_dismissed_at = now(), owner_dismissed_by = ${a.id}
        where id = ${id} and type = 'flag' and business_id = ${a.businessId!} and owner_dismissed_at is null
          and (${a.type} = 'owner' or payload ->> 'branchId' = ${a.branchId ?? ''}) returning id`;
      if (!r) throw notFound();
      await writeAudit(tx, { actorType: a.type, actorId: a.id, businessId: a.businessId!, ip: req.ip, type: 'alert.dismissed', text: 'Dismissed an unusual-activity alert', detail: { requestId: id } });
      return { ok: true };
    });
  }

  @Get('alert-prefs')
  async prefs(@CurrentActor() a: Actor): Promise<AlertPrefs> {
    const [p] = await this.sql<{ alert_prefs: unknown }[]>`select alert_prefs from tc.person where id = ${a.id}`;
    return prefsOf(p?.alert_prefs);
  }

  @Post('alert-prefs')
  async setPrefs(@Body() b: Record<string, unknown>, @CurrentActor() a: Actor, @Req() req: Request) {
    const next = { ...ALERT_DEFAULTS } as Record<string, unknown>;
    for (const k of ['approve', 'unusual', 'locked', 'phone', 'daily', 'weekly'] as const) {
      if (typeof b[k] !== 'boolean') throw badRequest('bad_prefs');
      next[k] = b[k];
    }
    if (b.how !== 'push' && b.how !== 'sms') throw badRequest('bad_prefs');
    // OwnAlertSet offers 20:00, 21:00 and 22:00 for the daily summary.
    if (b.time !== 20 && b.time !== 21 && b.time !== 22) throw badRequest('bad_prefs');
    next.how = b.how;
    next.time = b.time;
    return this.sql.begin(async (tx) => {
      await tx`update tc.person set alert_prefs = ${tx.json(next as never)} where id = ${a.id}`;
      await writeAudit(tx, { actorType: a.type, actorId: a.id, businessId: a.businessId!, ip: req.ip, type: 'settings.alerts', text: 'Changed alert settings', detail: next });
      return next;
    });
  }
}
