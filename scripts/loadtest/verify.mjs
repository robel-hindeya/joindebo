// After run.mjs: check the database against what the load test saw, and
// rebuild every card's count from raw stamp rows.
import fs from 'node:fs';
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL, { max: 2, onnotice: () => {} });
const { summary, created } = JSON.parse(fs.readFileSync(new URL('./result.json', import.meta.url), 'utf8'));
const expected = new Set(created);

const rows = await sql`select card_id, count(*)::int n from tc.stamp s join tc.card c on c.id = s.card_id
  join tc.business b on b.id = c.business_id where b.shop_code = 'LOAD01' and s.kind = 'add' group by card_id`;
const inDb = new Map(rows.map((r) => [r.card_id, r.n]));
const duplicates = rows.filter((r) => r.n > 1).length;
const lost = [...expected].filter((id) => !inDb.has(id)).length;
const unexpected = [...inDb.keys()].filter((id) => !expected.has(id)).length;

// Ledger rebuild: recount every card from raw rows (adds not voided, not waiting) and compare with the
// same rule computed per card the way the API does.
const rebuilt = await sql`
  select c.id, (select count(*)::int from tc.stamp s where s.card_id = c.id and s.kind = 'add'
    and not exists (select 1 from tc.stamp v where v.voids_stamp_id = s.id)
    and (not s.needs_approval or exists (select 1 from tc.stamp_decision d where d.stamp_id = s.id and d.decision = 'approved'))) as n
  from tc.card c join tc.business b on b.id = c.business_id where b.shop_code = 'LOAD01'`;
const mismatched = rebuilt.filter((r) => r.n !== (inDb.get(r.id) ?? 0)).length;
const totalRows = rows.reduce((a, r) => a + r.n, 0);

const verdict = { stampRows: totalRows, createdByLoad: expected.size, duplicates, lost, unexpected, ledgerMismatches: mismatched };
console.log(JSON.stringify({ summary, verdict }, null, 2));
const pass = duplicates === 0 && lost === 0 && unexpected === 0 && mismatched === 0 && summary.serverErrors === 0
  && summary.retry.sameStamp === summary.retry.total && summary.rescan.refusedDuplicate === summary.rescan.total
  && summary.race.exactlyOne === summary.race.total;
console.log(pass ? 'PASS' : 'FAIL');
await sql.end();
process.exit(pass ? 0 : 1);
