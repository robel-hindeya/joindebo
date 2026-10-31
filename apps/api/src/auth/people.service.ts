import { Inject, Injectable } from '@nestjs/common';
import { writeAudit, type Sql, type TransactionSql } from '@temelash/db';
import { SQL } from '../db/db.module';
import { SettingsService } from '../settings/settings.service';
import { badRequest, locked, unauthorized } from '../common/api-error';
import type { BusinessRole } from './actor';
import { clearWrongPins, isLocked, recordWrongPin } from './lockout';
import { burnTime, hashSecret, isPinFormat, isWeakPin, verifySecret } from './pin';
import { TokensService } from './tokens.service';

export interface PersonRow {
  id: string;
  business_id: string;
  business_name: string;
  phone: string;
  role: BusinessRole;
  pin_hash: string | null;
  pin_set_at: Date | null;
  pin_must_change: boolean;
  locked_until: Date | null;
}

/** PIN checks shared by the staff page and the business (owner/manager) page. */
@Injectable()
export class PeopleService {
  constructor(
    @Inject(SQL) private readonly sql: Sql,
    private readonly settings: SettingsService,
    private readonly tokens: TokensService,
  ) {}

  /** Active people with this phone and one of these roles, in businesses that are not closed. */
  find(phone: string, roles: BusinessRole[]): Promise<PersonRow[]> {
    return this.sql<PersonRow[]>`
      select p.id, p.business_id, b.name as business_name, p.phone, p.role, p.pin_hash, p.pin_set_at, p.pin_must_change, p.locked_until
      from tc.person p join tc.business b on b.id = p.business_id
      where p.phone = ${phone} and p.role in ${this.sql(roles)} and p.status = 'active'
        and b.status not in ('closed', 'rejected')
      order by p.created_at`;
  }

  /**
   * Check a PIN against every account with this phone. Wrong PINs count on each
   * unlocked account; if all are locked, or a wrong PIN locks one, sign-in is refused.
   */
  async checkPin(people: PersonRow[], pin: string, maxKey: string): Promise<PersonRow[]> {
    const open = people.filter((p) => !isLocked(p));
    if (!people.length) {
      await burnTime(pin);
      throw unauthorized('wrong_pin');
    }
    if (!open.length) throw locked(new Date(Math.min(...people.map((p) => p.locked_until!.getTime()))));
    const matches: PersonRow[] = [];
    for (const p of open) if (await verifySecret(p.pin_hash, pin)) matches.push(p);
    if (matches.length) {
      for (const p of matches) await clearWrongPins(this.sql, 'person', p.id);
      return matches;
    }
    const max = await this.settings.number(maxKey, 5);
    const minutes = await this.settings.number('auth.lock_minutes', 15);
    let triesLeft = max;
    let lockedUntil: Date | null = null;
    await this.sql.begin(async (tx) => {
      for (const p of open) {
        const r = await recordWrongPin(tx, 'person', p.id, max, minutes);
        await writeAudit(tx, {
          actorType: p.role === 'staff' ? 'staff' : p.role, actorId: p.id, role: p.role, businessId: p.business_id,
          type: r.locked ? 'auth.locked' : 'auth.pin_wrong', text: r.locked ? 'Sign-in locked after wrong PINs' : 'Wrong PIN',
        });
        if (r.locked) lockedUntil = r.lockedUntil;
        else triesLeft = Math.min(triesLeft, r.triesLeft);
      }
    });
    if (lockedUntil) throw locked(lockedUntil);
    throw unauthorized('wrong_pin', { triesLeft });
  }

  /** Why this person must choose a new PIN before going further, if they must. */
  async pinChangeReason(p: PersonRow): Promise<'first' | 'expired' | null> {
    if (p.pin_must_change) return 'first';
    const [r] = await this.sql<{ pin_days: number }[]>`
      select pin_days from tc.rule_set where business_id = ${p.business_id} order by version desc limit 1`;
    const days = r?.pin_days ?? (await this.settings.number('pin.default_expiry_days', 90));
    if (!p.pin_set_at || p.pin_set_at.getTime() + days * 86_400_000 < Date.now()) return 'expired';
    return null;
  }

  /** Validate and store a new PIN chosen by the person (StaffSetPin, OwnMgrFirstPin, forgot PIN). */
  async setOwnPin(tx: Sql | TransactionSql, personId: string, pin: unknown): Promise<void> {
    if (!isPinFormat(pin)) throw badRequest('bad_pin');
    const [p] = await tx<{ phone: string; pin_hash: string | null; role: BusinessRole; business_id: string }[]>`
      select phone, pin_hash, role, business_id from tc.person where id = ${personId}`;
    if (!p) throw unauthorized('bad_ticket');
    if (isWeakPin(pin, p.phone)) throw badRequest('weak_pin');
    if (await verifySecret(p.pin_hash, pin)) throw badRequest('same_pin');
    await tx`update tc.person set pin_hash = ${await hashSecret(pin)}, pin_set_at = now(), pin_must_change = false,
             failed_attempts = 0, locked_until = null where id = ${personId}`;
    await this.tokens.revokeAll(tx, p.role === 'staff' ? 'staff' : p.role, personId);
    await writeAudit(tx, { actorType: p.role === 'staff' ? 'staff' : p.role, actorId: personId, role: p.role, businessId: p.business_id, type: 'auth.pin_changed', text: 'Chose a new PIN' });
  }

  /** The branch a manager runs (managers have exactly one). */
  async managerBranch(personId: string): Promise<string | undefined> {
    const [r] = await this.sql<{ branch_id: string }[]>`select branch_id from tc.person_branch where person_id = ${personId} limit 1`;
    return r?.branch_id;
  }
}
