import { Controller, Get, Inject, Param, UseGuards } from '@nestjs/common';
import type { Sql } from '@temelash/db';
import { SQL } from '../db/db.module';
import { forbidden, notFound } from '../common/api-error';
import type { Actor } from '../auth/actor';
import { AuthGuard, CurrentActor, Roles } from '../auth/auth.guard';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Who may see which branch (build plan, section 3):
 * owner: every branch of their business; manager: only their branch;
 * staff: only the branch they signed in at; customers: none here.
 */
export function canSeeBranch(a: Actor, branch: { id: string; business_id: string }): boolean {
  if (a.businessId !== branch.business_id) return false;
  if (a.type === 'owner') return true;
  if (a.type === 'manager' || a.type === 'staff') return a.branchId === branch.id;
  return false;
}

@Controller()
@UseGuards(AuthGuard)
export class BusinessController {
  constructor(@Inject(SQL) private readonly sql: Sql) {}

  @Get('businesses/:id')
  @Roles('owner', 'manager', 'staff')
  async business(@Param('id') id: string, @CurrentActor() a: Actor) {
    if (!UUID.test(id)) throw notFound();
    if (a.businessId !== id) throw forbidden();
    const [b] = await this.sql`select id, name, category, city, status, plan, shop_code as "shopCode" from tc.business where id = ${id}`;
    if (!b) throw notFound();
    return b;
  }

  @Get('branches/:id')
  @Roles('owner', 'manager', 'staff')
  async branch(@Param('id') id: string, @CurrentActor() a: Actor) {
    if (!UUID.test(id)) throw notFound();
    const [br] = await this.sql<{ id: string; business_id: string; name: string; address: string | null; status: string }[]>`
      select id, business_id, name, address, status from tc.branch where id = ${id}`;
    // Same answer for "not yours" and "does not exist", so ids cannot be probed.
    if (!br || !canSeeBranch(a, br)) throw forbidden();
    return { id: br.id, businessId: br.business_id, name: br.name, address: br.address, status: br.status };
  }

  /** The staff app's own context: who is signed in, at which shop and branch. */
  @Get('staff/me')
  @Roles('staff')
  async staffMe(@CurrentActor() a: Actor) {
    const [r] = await this.sql`
      select p.name, b.name as "businessName", br.name as "branchName"
      from tc.person p join tc.business b on b.id = p.business_id join tc.branch br on br.id = ${a.branchId!}
      where p.id = ${a.id}`;
    return { id: a.id, businessId: a.businessId, branchId: a.branchId, ...r };
  }
}
