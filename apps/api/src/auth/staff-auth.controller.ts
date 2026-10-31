import { Body, Controller, HttpCode, Inject, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { writeAudit, type Sql } from '@temelash/db';
import { SQL } from '../db/db.module';
import { badRequest, unauthorized } from '../common/api-error';
import { requestMeta } from './auth.guard';
import { PeopleService, type PersonRow } from './people.service';
import { isPinFormat, normalizePhone } from './pin';
import { RateLimitGuard } from './rate-limit.guard';
import { TokensService } from './tokens.service';

interface Choice {
  personId: string;
  branchId: string;
}

/**
 * The shared /staff page (StaffSignIn): one link for cashiers of every
 * business, no business name on the page. Phone + PIN; then a shop picker when
 * the PIN opens more than one shop or branch (StaffPickShop), and a forced PIN
 * change for the owner-issued first PIN or an expired one (StaffSetPin).
 */
@Controller('auth/staff')
@UseGuards(RateLimitGuard)
export class StaffAuthController {
  constructor(
    @Inject(SQL) private readonly sql: Sql,
    private readonly tokens: TokensService,
    private readonly people: PeopleService,
  ) {}

  @Post('signin')
  @HttpCode(200)
  async signin(@Body() b: Record<string, unknown>, @Req() req: Request) {
    const phone = normalizePhone(b.phone);
    if (!phone) throw badRequest('bad_phone');
    if (!isPinFormat(b.pin)) throw badRequest('bad_pin');
    const matches = await this.people.checkPin(await this.people.find(phone, ['staff']), b.pin, 'auth.staff.max_failed_attempts');

    const choices = await this.sql<(Choice & { business_name: string; branch_name: string })[]>`
      select pb.person_id as "personId", pb.branch_id as "branchId", b.name as business_name, br.name as branch_name
      from tc.person_branch pb
      join tc.branch br on br.id = pb.branch_id and br.status = 'active'
      join tc.business b on b.id = br.business_id
      where pb.person_id in ${this.sql(matches.map((m) => m.id))}
      order by b.name, br.name`;
    if (!choices.length) throw unauthorized('no_branch');
    if (choices.length === 1) return this.continue(matches, choices[0], req);

    return {
      next: 'pick_shop',
      ticket: await this.tokens.ticket('staff_pick', { choices: choices.map((c) => `${c.personId}:${c.branchId}`) }),
      shops: choices.map((c) => ({ choice: `${c.personId}:${c.branchId}`, businessName: c.business_name, branchName: c.branch_name })),
    };
  }

  @Post('pick')
  @HttpCode(200)
  async pick(@Body() b: Record<string, unknown>, @Req() req: Request) {
    const t = await this.tokens.readTicket<{ choices: string[] }>(b.ticket, 'staff_pick');
    if (typeof b.choice !== 'string' || !t.choices.includes(b.choice)) throw badRequest('bad_choice');
    const [personId, branchId] = b.choice.split(':');
    const people = await this.sql<PersonRow[]>`
      select p.id, p.business_id, p.phone, p.role, p.pin_hash, p.pin_set_at, p.pin_must_change, p.locked_until
      from tc.person p where p.id = ${personId} and p.status = 'active'`;
    if (!people.length) throw unauthorized('bad_ticket');
    return this.continue(people, { personId, branchId }, req);
  }

  @Post('set-pin')
  @HttpCode(200)
  async setPin(@Body() b: Record<string, unknown>, @Req() req: Request) {
    const t = await this.tokens.readTicket<Choice>(b.ticket, 'staff_set_pin');
    return this.sql.begin(async (tx) => {
      await this.people.setOwnPin(tx, t.personId, b.pin);
      const [p] = await tx<{ business_id: string }[]>`select business_id from tc.person where id = ${t.personId}`;
      await writeAudit(tx, { actorType: 'staff', actorId: t.personId, role: 'staff', businessId: p.business_id, type: 'auth.signin', text: 'Signed in', ip: req.ip });
      return this.tokens.issue(tx, { type: 'staff', id: t.personId, businessId: p.business_id, branchId: t.branchId }, requestMeta(req));
    });
  }

  private async continue(people: PersonRow[], c: Choice, req: Request) {
    const p = people.find((x) => x.id === c.personId)!;
    const reason = await this.people.pinChangeReason(p);
    if (reason) {
      return { next: 'set_pin', reason, changeTicket: await this.tokens.ticket('staff_set_pin', { personId: c.personId, branchId: c.branchId }) };
    }
    return this.sql.begin(async (tx) => {
      await writeAudit(tx, { actorType: 'staff', actorId: p.id, role: 'staff', businessId: p.business_id, type: 'auth.signin', text: 'Signed in', ip: req.ip });
      return this.tokens.issue(tx, { type: 'staff', id: p.id, businessId: p.business_id, branchId: c.branchId }, requestMeta(req));
    });
  }
}
