'use client';

import { useEffect, useState } from 'react';
import qrcode from 'qrcode-generator';
import { cardCode, minuteOf, secondsLeft, type CardCode } from '@temelash/codes';

/** QR modules as one SVG path, drawn black on white like the prototype. */
export function QrSvg({ text, size, label }: { text: string; size: number; label: string }) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
  return (
    <svg width={size} height={size} viewBox={`-2 -2 ${n + 4} ${n + 4}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect x={-2} y={-2} width={n + 4} height={n + 4} fill="#fff" />
      <path d={d} fill="#222" />
    </svg>
  );
}

/**
 * The card's code for the current minute, computed on this phone from the
 * card secret, so it keeps working offline. Re-renders every second for the
 * "New code in Ns" countdown.
 */
export function useCardCode(card: { qr: { secret: string; short: string }; shop: { shopCode: string } } | null) {
  const [now, setNow] = useState(() => Date.now());
  const [code, setCode] = useState<CardCode | null>(null);
  const minute = minuteOf(now);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (!card) return;
    let live = true;
    cardCode(card.qr.secret, card.shop.shopCode, card.qr.short, minute).then((c) => live && setCode(c));
    return () => {
      live = false;
    };
  }, [card, minute]);
  const left = secondsLeft(now);
  return { code, left, pct: `${Math.round((left / 60) * 100)}%` };
}
