import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { SignJWT, jwtVerify } from 'jose';
import type { Sql, TransactionSql } from '@temelash/db';
import { SQL } from '../db/db.module';
import { SettingsService } from '../settings/settings.service';
import { unauthorized } from '../common/api-error';
import type { Actor } from './actor';

/**
 * Two kinds of signed token:
 * - access tokens (short-lived, `use: access`) that every protected endpoint accepts;
 * - tickets (`use: <step>`) that carry one sign-in step to the next, e.g. "PIN ok,
 *   now the SMS code". A ticket is never accepted as an access token.
 * Refresh tokens are random, stored only as a hash, and rotate on every use.
 */
@Injectable()
export class TokensService {
  private readonly key: Uint8Array;

  constructor(
    @Inject(SQL) private readonly sql: Sql,
    private readonly settings: SettingsService,
  ) {
    const secret = process.env.JWT_ACCESS_SECRET;
    if (!secret || secret.length < 32) throw new Error('JWT_ACCESS_SECRET must be at least 32 characters');
    this.key = new TextEncoder().encode(secret);
  }

  async ticket(use: string, claims: Record<string, unknown>, minutes = 10): Promise<string> {
    return new SignJWT({ ...claims, use })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(`${minutes}m`)
      .sign(this.key);
  }

  async readTicket<T = Record<string, unknown>>(token: unknown, use: string): Promise<T> {
    if (typeof token !== 'string' || !token) throw unauthorized('bad_ticket');
    try {
      const { payload } = await jwtVerify(token, this.key, { algorithms: ['HS256'] });
      if (payload.use !== use) throw new Error('wrong use');
      return payload as T;
    } catch {
      throw unauthorized('bad_ticket');
    }
  }

  /** Access token for a verified actor. */
  async readAccess(token: string): Promise<Actor> {
    const p = await this.readTicket<{ sub: string; typ: Actor['type']; biz?: string; br?: string; sid: string }>(token, 'access');
    const [session] = await this.sql`select 1 from tc.session where id = ${p.sid} and revoked_at is null and expires_at > now()`;
    if (!session) throw unauthorized('session_ended');
    return { type: p.typ, id: p.sub, businessId: p.biz, branchId: p.br, sessionId: p.sid };
  }

  /** Start a session and return its first access and refresh tokens. */
  async issue(
    tx: Sql | TransactionSql,
    a: Omit<Actor, 'sessionId'>,
    meta: { ip?: string; userAgent?: string },
    familyId: string = randomUUID(),
  ): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
    const refreshToken = randomBytes(32).toString('base64url');
    const days = await this.settings.number('auth.refresh_token_days', 30);
    const [s] = await tx<{ id: string }[]>`
      insert into tc.session (actor_type, actor_id, branch_id, family_id, refresh_hash, expires_at, ip, user_agent)
      values (${a.type}, ${a.id}, ${a.branchId ?? null}, ${familyId}, ${sha256(refreshToken)},
              now() + make_interval(days => ${days}), ${a.type === 'customer' ? null : meta.ip ?? null}, ${meta.userAgent?.slice(0, 300) ?? null})
      returning id`;
    const minutes = await this.settings.number('auth.access_token_minutes', 15);
    const accessToken = await this.ticket('access', { sub: a.id, typ: a.type, biz: a.businessId, br: a.branchId, sid: s.id }, minutes);
    return { accessToken, refreshToken, expiresIn: minutes * 60 };
  }

  /** Rotate a refresh token. Presenting one that was already rotated ends the whole family. */
  async refresh(refreshToken: unknown, meta: { ip?: string; userAgent?: string }) {
    if (typeof refreshToken !== 'string' || !refreshToken) throw unauthorized('bad_refresh');
    return this.sql.begin(async (tx) => {
      const [s] = await tx<{ id: string; family_id: string; actor_type: Actor['type']; actor_id: string; branch_id: string | null; rotated_at: Date | null; revoked_at: Date | null; expired: boolean }[]>`
        select id, family_id, actor_type, actor_id, branch_id, rotated_at, revoked_at, expires_at <= now() as expired
        from tc.session where refresh_hash = ${sha256(refreshToken)} for update`;
      if (!s) throw unauthorized('bad_refresh');
      // A token that was already rotated is being replayed: someone else may hold it, so end the family.
      if (s.rotated_at) {
        await tx`update tc.session set revoked_at = now() where family_id = ${s.family_id} and revoked_at is null`;
        return null;
      }
      if (s.revoked_at || s.expired) throw unauthorized('bad_refresh');
      await tx`update tc.session set rotated_at = now(), revoked_at = now() where id = ${s.id}`;
      const businessId = s.actor_type === 'customer'
        ? undefined
        : (await tx<{ business_id: string }[]>`select business_id from tc.person where id = ${s.actor_id} and status = 'active'`)[0]?.business_id;
      if (s.actor_type !== 'customer' && !businessId) throw unauthorized('bad_refresh');
      return this.issue(tx, { type: s.actor_type, id: s.actor_id, businessId, branchId: s.branch_id ?? undefined }, meta, s.family_id);
    }).then((r) => {
      // Thrown after commit so the family stays revoked.
      if (!r) throw unauthorized('bad_refresh');
      return r;
    });
  }

  async revokeAll(tx: Sql | TransactionSql, actorType: Actor['type'], actorId: string): Promise<void> {
    await tx`update tc.session set revoked_at = now() where actor_type = ${actorType} and actor_id = ${actorId} and revoked_at is null`;
  }
}

export function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}
