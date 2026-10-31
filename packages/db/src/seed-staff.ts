/**
 * Development and staging only: test cashiers for the staff sign-in screens.
 * One works at Moka House (Piassa); the other at Moka House and Sheba Salon,
 * so the shop picker shows. Both get the temporary PIN below and must choose
 * their own at first sign-in, like real owner-issued accounts.
 * Refuses to run unless SEED_ALLOWED=true. Idempotent.
 */
import { hash, Algorithm } from '@node-rs/argon2';
import { createDb } from './index';

export const DEV_STAFF = [
  { phone: '+251911555001', name: 'Test Cashier One', shops: ['MOKA01'] },
  { phone: '+251911555002', name: 'Test Cashier Two', shops: ['MOKA01', 'SHEB02'] },
];
/** Temporary PIN for the dev cashiers above (they must change it on first sign-in). */
export const DEV_STAFF_TEMP_PIN = '583920';

async function main() {
  if (process.env.SEED_ALLOWED !== 'true') throw new Error('Refusing to seed: set SEED_ALLOWED=true (local and staging only).');
  const sql = createDb(undefined, { max: 1 });
  const pinHash = await hash(DEV_STAFF_TEMP_PIN, { algorithm: Algorithm.Argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
  try {
    await sql.begin(async (tx) => {
      for (const s of DEV_STAFF) {
        for (const code of s.shops) {
          const [b] = await tx<{ id: string; branch: string }[]>`
            select b.id, (select id from tc.branch where business_id = b.id order by created_at limit 1) as branch
            from tc.business b where b.shop_code = ${code}`;
          if (!b) continue;
          const [p] = await tx<{ id: string }[]>`
            insert into tc.person (business_id, phone, name, role, pin_hash, pin_set_at, pin_must_change)
            values (${b.id}, ${s.phone}, ${s.name}, 'staff', ${pinHash}, now(), true)
            on conflict (business_id, phone) do nothing returning id`;
          if (p) await tx`insert into tc.person_branch (person_id, branch_id) values (${p.id}, ${b.branch})`;
        }
      }
    });
    console.log(`dev staff ready: ${DEV_STAFF.map((s) => s.phone).join(', ')}`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
