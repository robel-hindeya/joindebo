/**
 * Create a Temelash admin from the server, for the first two Owners:
 *   npm run admin:create -w @temelash/api -- owner@temelash.et "Full Name" owner
 * Prints a temporary password once; the admin sets up the authenticator at first sign-in.
 */
import { createDb } from '@temelash/db';
import { createAdmin, tempPassword, type AdminRole } from './accounts';

async function main() {
  const [email, name, role = 'owner'] = process.argv.slice(2);
  if (!email || !name || !['owner', 'finance', 'support'].includes(role)) {
    console.error('usage: admin:create <email> "<name>" [owner|finance|support]');
    process.exit(2);
  }
  const sql = createDb();
  try {
    const password = tempPassword();
    await sql.begin(async (tx) => {
      const id = await createAdmin(tx, { email, name, role: role as AdminRole, password });
      await tx`insert into tc.audit_log (actor_type, role, type, text, detail)
               values ('system', ${role}, 'admin.team_added', ${`Added ${name} (${role}) from the server`}, ${tx.json({ adminId: id })})`;
    });
    // Shown once on the operator's terminal; not stored anywhere in plain text.
    process.stdout.write(`Created ${email} (${role}). Temporary password: ${password}\n`);
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
