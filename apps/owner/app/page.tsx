import { OwnerAuth } from './owner-auth';

/**
 * Business sign-in for owners and branch managers. The front page links here
 * with ?start=1, which skips the merchant landing page.
 */
export default async function Page({ searchParams }: { searchParams: Promise<{ start?: string }> }) {
  const { start } = await searchParams;
  return <OwnerAuth fromHome={Boolean(start)} />;
}
