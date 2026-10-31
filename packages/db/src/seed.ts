/**
 * Load the prototype's sample agents, businesses, branches, owners, card rules
 * and sign-up requests so every screen has data. Insert-only and idempotent:
 * does nothing when businesses already exist. Refuses to run unless
 * SEED_ALLOWED=true (never set it in production).
 */
import { createDb, writeAudit } from './index';
import { AGENTS, BUSINESSES, DEFAULT_SETTINGS, SAMPLE_LADDER, planCode, shopCode } from './seed-data';

async function main() {
  if (process.env.SEED_ALLOWED !== 'true') {
    throw new Error('Refusing to seed: set SEED_ALLOWED=true (local and staging only).');
  }
  const sql = createDb(undefined, { max: 1 });
  try {
    const [{ count }] = await sql<{ count: number }[]>`select count(*)::int as count from tc.business`;
    if (count > 0) {
      console.log(`seed skipped: ${count} businesses already present`);
      return;
    }

    await sql.begin(async (tx) => {
      for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
        await tx`insert into tc.setting (key, value, changed_by) values (${key}, ${tx.json(value as never)}, 'seed')
                 on conflict (key) do nothing`;
      }

      const agentIds = new Map<string, string>();
      for (const [ref, name, phone, area, status] of AGENTS) {
        const [row] = await tx<{ id: string }[]>`
          insert into tc.agent (name, phone, area, status) values (${name}, ${phone}, ${area}, ${status}) returning id`;
        agentIds.set(ref, row.id);
      }

      for (const b of BUSINESSES) {
        const live = b.status !== 'pending';
        const [biz] = await tx<{ id: string }[]>`
          insert into tc.business (name, category, city, status, plan, plan_date, trial_ends_at, agent_id, shop_code, created_at)
          values (${b.name}, ${b.category}, ${b.city}, ${b.status}, ${live ? planCode(b.plan) : null},
                  ${live ? b.joined : null},
                  ${b.status === 'trial' ? new Date(Date.parse(b.joined) + 30 * 86_400_000) : null},
                  ${agentIds.get(b.agent) ?? null}, ${shopCode(b)}, ${b.joined})
          returning id`;

        const area = b.city.split('·').pop()!.trim();
        for (let i = 1; i <= b.branches; i++) {
          await tx`insert into tc.branch (business_id, name) values (${biz.id}, ${i === 1 ? area : `${area} ${i}`})`;
        }

        await tx`insert into tc.person (business_id, phone, name, role) values (${biz.id}, ${b.phone}, ${b.owner}, 'owner')`;

        if (live) {
          // Moka House has the welcome stamp, as in the prototype (ScanJoin "WELCOME STAMP INCLUDED").
          await tx`insert into tc.rule_set (business_id, version, stamps_needed, ladder, welcome_stamps)
                   values (${biz.id}, 1, 10, ${tx.json(SAMPLE_LADDER)}, ${b.ref === 'b01' ? 1 : 0})`;
        } else {
          await tx`insert into tc.request (type, business_id, stage, payload)
                   values ('signup', ${biz.id}, 'new', ${tx.json({ plan: planCode(b.plan), owner: b.owner, phone: b.phone })})`;
        }
      }

      await writeAudit(tx, {
        actorType: 'system',
        type: 'seed',
        text: `Loaded sample data: ${AGENTS.length} agents, ${BUSINESSES.length} businesses`,
      });
    });

    console.log(`seeded ${AGENTS.length} agents and ${BUSINESSES.length} businesses`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
