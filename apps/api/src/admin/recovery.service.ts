import { Inject, Injectable } from '@nestjs/common';
import type { Sql, TransactionSql } from '@temelash/db';
import { t, type MessageKey } from '@temelash/i18n';
import { SQL } from '../db/db.module';
import { EmailSender } from '../email/email';

type Tx = Sql | TransactionSql;

/** "2 Nov 2026, 14:05" in East Africa Time. */
export const eatTime = (d: Date) => `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Addis_Ababa' })}, ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Addis_Ababa' })}`;

/** A short device name from a user agent, for the new-device email. */
export function deviceName(ua: string | null | undefined): string {
  if (!ua) return 'an unknown device';
  const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iPhone' : /Windows/i.test(ua) ? 'Windows' : /Mac OS/i.test(ua) ? 'Mac' : /Linux/i.test(ua) ? 'Linux' : '';
  const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '';
  return [br, os].filter(Boolean).join(' on ') || ua.slice(0, 40);
}

/**
 * Admin account recovery (AdminLoginRecover*, AdminTeamRecovery) and the
 * emails at every step. Email text lives in the locale files as admin.mail*.
 */
@Injectable()
export class RecoveryService {
  constructor(
    @Inject(SQL) private readonly sql: Sql,
    private readonly email: EmailSender,
  ) {}

  /** Write one email from its admin.mail<Name>S / admin.mail<Name>B strings. */
  mail(tx: Tx, to: string, template: string, name: string, vars: Record<string, string | number>) {
    return this.email.send(tx, to, template, t('en', `admin.mail${name}S` as MessageKey, vars), t('en', `admin.mail${name}B` as MessageKey, vars));
  }

  /** The other active Owners (the people who can approve). */
  otherOwners(tx: Tx, exceptId: string) {
    return tx<{ id: string; email: string; name: string }[]>`
      select id, email, name from tc.admin_user where role = 'owner' and status = 'active' and id <> ${exceptId} order by name`;
  }

  /** The open request of this admin, if any. */
  async open(tx: Tx, adminId: string) {
    const [r] = await tx<{ id: string; status: 'pending' | 'approved'; ready_at: Date | null; decided_by: string | null }[]>`
      select id, status, ready_at, decided_by from tc.admin_recovery where admin_id = ${adminId} and status in ('pending', 'approved')`;
    return r ?? null;
  }

  /** After the new authenticator is set: close the request and tell everyone. */
  async finish(tx: Tx, admin: { id: string; email: string; name: string }, recoveryId: string) {
    const [r] = await tx<{ by: string | null }[]>`
      update tc.admin_recovery x set status = 'done', done_at = now() from tc.admin_user d
      where x.id = ${recoveryId} and x.status = 'approved' and d.id = x.decided_by returning d.name as by`;
    if (!r) return false;
    await this.mail(tx, admin.email, 'recovery_done', 'RecDone', { a: admin.name });
    for (const o of await this.otherOwners(tx, admin.id)) await this.mail(tx, o.email, 'recovery_done_owner', 'RecDoneOwner', { a: admin.name, b: r.by ?? '' });
    return true;
  }

  /** AdminAccount "Tell me when a new device signs in": a device (browser) not seen before for this admin. */
  async newDevice(tx: Tx, admin: { id: string; email: string; name: string; new_device_alert: boolean }, ua: string | undefined) {
    if (!admin.new_device_alert) return;
    const [seen] = await tx<{ before: number; same: number }[]>`
      select count(*)::int as before, count(*) filter (where user_agent is not distinct from ${ua ?? null})::int as same
      from tc.session where actor_type = 'admin' and actor_id = ${admin.id}`;
    if (seen.before === 0 || seen.same > 0) return;
    const vars = { a: admin.name, b: deviceName(ua), c: eatTime(new Date()) };
    await this.mail(tx, admin.email, 'new_device', 'NewDevice', vars);
    for (const o of await this.otherOwners(tx, admin.id)) await this.mail(tx, o.email, 'new_device_owner', 'NewDeviceOwner', vars);
  }

}
