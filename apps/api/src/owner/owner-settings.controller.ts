import { Body, Controller, Get, Inject, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { writeAudit, type Sql } from '@temelash/db';
import { SQL } from '../db/db.module';
import { SettingsService } from '../settings/settings.service';
import { badRequest, forbidden, unauthorized } from '../common/api-error';
import type { Actor } from '../auth/actor';
import { AuthGuard, CurrentActor, Roles, requestMeta } from '../auth/auth.guard';
import { recordWrongPin } from '../auth/lockout';
import { PeopleService } from '../auth/people.service';
import { verifySecret } from '../auth/pin';
import { TokensService } from '../auth/tokens.service';

/** The 12 card colours of the OwnLook board. */
export const SWATCHES = ['#0F6E4B', '#C8341F', '#FFC72C', '#1F5FA8', '#6B3FA0', '#C2185B', '#E8731A', '#0E7C86', '#7A4B2A', '#222222', '#6B7A1F', '#5BA9D6'];

/** Image type from its first bytes, so a renamed file cannot pass as a picture. */
function sniff(b: Buffer): string | null {
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 12 && b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  return null;
}

/** OwnLook, OwnSecurity and OwnDateTime. */
@Controller('owner')
@UseGuards(AuthGuard)
@Roles('owner', 'manager')
export class OwnerSettingsController {
  constructor(
    @Inject(SQL) private readonly sql: Sql,
    private readonly people: PeopleService,
    private readonly tokens: TokensService,
    private readonly settings: SettingsService,
  ) {}

  @Get('look')
  async look(@CurrentActor() a: Actor) {
    const [r] = await this.sql<{ brand_color: string; shop_code: string; version: number | null }[]>`
      select b.brand_color, b.shop_code, l.version from tc.business b left join tc.business_logo l on l.business_id = b.id where b.id = ${a.businessId!}`;
    return { color: r.brand_color, swatches: SWATCHES, logoUrl: r.version ? `/api/v1/shops/${r.shop_code}/logo?v=${r.version}` : null };
  }

  @Post('look')
  async saveLook(@Body() b: Record<string, unknown>, @CurrentActor() a: Actor, @Req() req: Request) {
    if (a.type !== 'owner') throw forbidden();
    const color = String(b.color ?? '').toUpperCase();
    if (!SWATCHES.includes(color)) throw badRequest('bad_color');
    await this.sql.begin(async (tx) => {
      await tx`update tc.business set brand_color = ${color} where id = ${a.businessId!}`;
      await writeAudit(tx, { actorType: a.type, actorId: a.id, role: a.type, businessId: a.businessId, ip: req.ip, type: 'shop.look', text: 'Card colour changed', detail: { color } });
    });
    return { ok: true };
  }

  /** Logo as a data URL (the owner's phone has already cropped and resized it). */
  @Post('look/logo')
  async saveLogo(@Body() b: Record<string, unknown>, @CurrentActor() a: Actor, @Req() req: Request) {
    if (a.type !== 'owner') throw forbidden();
    const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(b.dataUrl ?? ''));
    if (!m) throw badRequest('bad_image');
    const bytes = Buffer.from(m[2], 'base64');
    const mime = sniff(bytes);
    if (!mime || mime !== m[1]) throw badRequest('bad_image');
    if (bytes.length > 300_000) throw badRequest('image_too_big');
    await this.sql.begin(async (tx) => {
      await tx`insert into tc.business_logo (business_id, mime, bytes, updated_by) values (${a.businessId!}, ${mime}, ${bytes}, ${a.id})
               on conflict (business_id) do update set mime = excluded.mime, bytes = excluded.bytes, version = tc.business_logo.version + 1,
                 updated_by = excluded.updated_by, updated_at = now()`;
      await writeAudit(tx, { actorType: a.type, actorId: a.id, role: a.type, businessId: a.businessId, ip: req.ip, type: 'shop.logo', text: 'Logo changed', detail: { bytes: bytes.length } });
    });
    return { ok: true };
  }

  /** OwnSecurity: change your own PIN. This phone stays signed in; every other one is signed out. */
  @Post('security/pin')
  async changePin(@Body() b: Record<string, unknown>, @CurrentActor() a: Actor, @Req() req: Request) {
    const [me] = await this.sql<{ pin_hash: string | null; role: string; business_id: string }[]>`select pin_hash, role, business_id from tc.person where id = ${a.id}`;
    if (typeof b.current !== 'string' || !(await verifySecret(me.pin_hash, b.current))) {
      const max = await this.settings.number('auth.business.max_failed_attempts', 3);
      const minutes = await this.settings.number('auth.lock_minutes', 15);
      await this.sql.begin((tx) => recordWrongPin(tx, 'person', a.id, max, minutes));
      throw unauthorized('wrong_pin');
    }
    return this.sql.begin(async (tx) => {
      await this.people.setOwnPin(tx, a.id, b.pin);
      const branchId = a.type === 'manager' ? a.branchId : undefined;
      return this.tokens.issue(tx, { type: a.type, id: a.id, businessId: a.businessId, branchId }, requestMeta(req));
    });
  }

  @Post('security/signout-others')
  async signOutOthers(@CurrentActor() a: Actor, @Req() req: Request) {
    await this.sql.begin(async (tx) => {
      await tx`update tc.session set revoked_at = now() where actor_id = ${a.id} and id <> ${a.sessionId} and revoked_at is null`;
      await writeAudit(tx, { actorType: a.type, actorId: a.id, role: a.type, businessId: a.businessId, ip: req.ip, type: 'auth.signout_others', text: 'Signed out of all other phones' });
    });
    return { ok: true };
  }

  /** OwnDateTime: this person's calendar and clock. */
  @Get('prefs')
  async prefs(@CurrentActor() a: Actor) {
    const [p] = await this.sql<{ prefs: Record<string, string> }[]>`select prefs from tc.person where id = ${a.id}`;
    return { calendar: p.prefs.calendar ?? 'greg', clock: p.prefs.clock ?? '24' };
  }

  @Post('prefs')
  async savePrefs(@Body() b: Record<string, unknown>, @CurrentActor() a: Actor) {
    const calendar = b.calendar ?? 'greg';
    const clock = b.clock ?? '24';
    if (!['greg', 'eth'].includes(String(calendar)) || !['24', '12', 'eth'].includes(String(clock))) throw badRequest('bad_prefs');
    await this.sql`update tc.person set prefs = ${this.sql.json({ calendar: String(calendar), clock: String(clock) })} where id = ${a.id}`;
    return { ok: true };
  }
}
