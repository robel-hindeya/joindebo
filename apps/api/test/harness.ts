/**
 * End-to-end harness: a fresh `tc` schema on TEST_DATABASE_URL (a throwaway
 * Postgres, never Supabase), every migration applied, and the Nest app bound to it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createDb, type Sql } from '@temelash/db';
import { AppModule } from '../src/app.module';
import { SQL } from '../src/db/db.module';
import { configureApp } from '../src/main';
import { hashSecret } from '../src/auth/pin';

export const TEST_DB = process.env.TEST_DATABASE_URL;
/** Use as `describeDb(...)`: skipped (with a note) when no test database is configured. */
export const describeDb: jest.Describe = TEST_DB ? describe : describe.skip;
if (!TEST_DB) console.log('TEST_DATABASE_URL not set: database tests skipped');

export async function resetDb(): Promise<Sql> {
  const sql = createDb(TEST_DB, { max: 4, onnotice: () => {} });
  await migrateFresh(sql);
  return sql;
}

/** Drop and recreate the schema. The append-only audit log refuses deletes, so tests start over instead. */
export async function migrateFresh(sql: Sql): Promise<void> {
  await sql`drop schema if exists tc cascade`;
  const dir = path.join(__dirname, '..', '..', '..', 'packages', 'db', 'migrations');
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    await sql.unsafe(fs.readFileSync(path.join(dir, file), 'utf8'));
  }
}

export async function createTestApp(sql: Sql): Promise<INestApplication> {
  process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-at-least-32-characters-long';
  process.env.DEV_SMS = 'true';
  process.env.AUTH_RATE_LIMIT_PER_MIN = '10000';
  const mod = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(SQL)
    .useValue(sql)
    .compile();
  const app = mod.createNestApplication({ logger: false });
  configureApp(app);
  await app.init();
  return app;
}

export interface World {
  bizA: string;
  bizB: string;
  branchA1: string;
  branchA2: string;
  branchB1: string;
  owner: { id: string; phone: string };
  manager: { id: string; phone: string };
  staff: { id: string; phone: string };
  ownerB: { id: string; phone: string };
}

export const GOOD_PIN = '482915';

/** Two businesses; A has two branches, an owner, a manager of branch A1 and a cashier at A1. */
export async function seedWorld(sql: Sql): Promise<World> {
  const hash = await hashSecret(GOOD_PIN);
  const [{ id: bizA }] = await sql`insert into tc.business (name, category, city, status, plan, shop_code)
    values ('Moka House', 'cafe', 'Addis Ababa', 'active', 'full', 'MOKA01') returning id`;
  const [{ id: bizB }] = await sql`insert into tc.business (name, category, city, status, plan, shop_code)
    values ('Sheba Salon', 'salon', 'Addis Ababa', 'active', 'starter', 'SHEB02') returning id`;
  const [{ id: branchA1 }] = await sql`insert into tc.branch (business_id, name) values (${bizA}, 'Piassa') returning id`;
  const [{ id: branchA2 }] = await sql`insert into tc.branch (business_id, name) values (${bizA}, 'Bole') returning id`;
  const [{ id: branchB1 }] = await sql`insert into tc.branch (business_id, name) values (${bizB}, 'Bole') returning id`;
  const person = async (business: string, phone: string, role: string, branch?: string) => {
    const [{ id }] = await sql`insert into tc.person (business_id, phone, name, role, pin_hash, pin_set_at, pin_must_change)
      values (${business}, ${phone}, ${role + ' ' + phone.slice(-4)}, ${role}, ${hash}, now(), false) returning id`;
    if (branch) await sql`insert into tc.person_branch (person_id, branch_id) values (${id}, ${branch})`;
    return { id: id as string, phone };
  };
  return {
    bizA,
    bizB,
    branchA1,
    branchA2,
    branchB1,
    owner: await person(bizA, '+251911100001', 'owner'),
    manager: await person(bizA, '+251911100002', 'manager', branchA1),
    staff: await person(bizA, '+251911100003', 'staff', branchA1),
    ownerB: await person(bizB, '+251911100004', 'owner'),
  };
}

/** The latest code the dev SMS sender "sent" to a phone. */
export async function lastSmsCode(sql: Sql, phone: string): Promise<string> {
  const [row] = await sql<{ body: string }[]>`select body from tc.sms_outbox where phone = ${phone} order by created_at desc limit 1`;
  const m = row?.body.match(/\b(\d{6})\b/);
  if (!m) throw new Error(`no SMS code for ${phone}`);
  return m[1];
}
