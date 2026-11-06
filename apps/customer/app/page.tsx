import { RoleLanding } from './role-landing';
import { Welcome } from './welcome';

/**
 * The front page: choose owner, staff or customer. Customers come back to
 * /?start=1 for the Welcome board: choose a language, then sign up or sign in
 * (ScanJoin, Phase 1).
 */
export default async function Page({ searchParams }: { searchParams: Promise<{ start?: string }> }) {
  const { start } = await searchParams;
  return start ? <Welcome /> : <RoleLanding />;
}
