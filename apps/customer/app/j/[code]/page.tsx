import { Welcome } from '../../welcome';

/** A shop's QR code opens this link: choose a language, then join or sign in at that shop. */
export default async function ShopJoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <Welcome shopCode={code} />;
}
