'use client';

import { useRef, useState } from 'react';
import type { Lang } from '@temelash/i18n';
import { ApiFailure, authed } from '@temelash/ui';
import { formatDay } from './owner-more';
import { IC, Icon, type Lfn } from './owner-ui';
import s from './app.module.css';

/**
 * Paying by hand (DECISIONS.md, 2026-11-04): where to pay, "I have paid" with the transaction ID
 * and a screenshot, and the payments sent with their check. No board draws these yet; they use
 * the Plan page's cards, fields and chips. Owners only.
 */

const RED = '#b3261e';
export type PayMethod = 'telebirr' | 'cbe_birr' | 'bank';
export interface PayTo { telebirr: string; cbe_birr: string; bank: string }
export interface Claim { id: string; method: PayMethod; amount: number; transactionId: string; paidOn: string; status: 'waiting' | 'approved' | 'rejected'; reason: string | null; createdAt: string; receiptNo: string | null }

const METHOD_KEY: Record<PayMethod, string> = { telebirr: 'owner.soTele', cbe_birr: 'owner.payCbe', bank: 'owner.payBank' };
const todayEat = () => new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
const birr = (L: Lfn, n: number) => L('owner.birr', { a: n.toLocaleString('en-US') });

/** "Where to pay": the accounts set in Admin, and "I have paid". */
export function PayToCard({ L, payTo, onPay }: { L: Lfn; payTo: PayTo; onPay?: () => void }) {
  const rows = (Object.keys(METHOD_KEY) as PayMethod[]).filter((m) => payTo[m]);
  return (
    <div className={s.card} style={{ marginTop: 18, padding: 14 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <Icon d={IC.info} size={22} color="#444" />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#333' }}>{L('owner.plHowT')}</div>
          <p style={{ margin: '3px 0 0', fontSize: 13, lineHeight: '18px', color: '#555' }}>{rows.length ? L('owner.payToText') : L('owner.payToNone')}</p>
          {rows.map((m) => (
            <div key={m} className={s.kvLine} style={{ padding: '8px 0 0' }}>
              <span style={{ color: '#444' }}>{L(METHOD_KEY[m])}</span>
              <span style={{ fontWeight: 700, color: '#333', textAlign: 'right', overflowWrap: 'anywhere' }}>{payTo[m]}</span>
            </div>
          ))}
        </div>
      </div>
      {onPay && <button type="button" className={s.cta} style={{ marginTop: 14 }} onClick={onPay}>{L('owner.payBtn')}</button>}
    </div>
  );
}

/** The payments sent and what we decided. */
export function ClaimsList({ L, lang, claims }: { L: Lfn; lang: Lang; claims: Claim[] }) {
  if (!claims.length) return null;
  const day = (iso: string) => formatDay(new Date(iso + 'T12:00:00+03:00'), lang);
  return (
    <>
      <div className={s.section}>{L('owner.paySentLbl')}</div>
      <div className={s.kvCard}>
        {claims.map((c) => (
          <div key={c.id} className={s.kvLine} style={{ flexDirection: 'column', alignItems: 'stretch', gap: 2 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <span style={{ color: '#444' }}>{day(c.paidOn)} · {L(METHOD_KEY[c.method])}</span>
              <span style={{ fontWeight: 700, color: '#333' }}>{birr(L, c.amount)}</span>
            </div>
            <span style={{ fontSize: 13, color: c.status === 'rejected' ? RED : '#555' }}>
              {c.status === 'waiting' ? L('owner.payWaiting') : c.status === 'approved' ? L('owner.payApproved') : L('owner.payRejected', { a: c.reason ?? '' })}
              {' · '}{c.transactionId}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

/** A photo as a JPEG at most 1600 px on its long side, base64 (keeps uploads small on slow phones). */
async function shrink(file: File): Promise<{ type: string; data: string }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = url; });
    const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.naturalWidth * k));
    c.height = Math.max(1, Math.round(img.naturalHeight * k));
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, 'image/jpeg', 0.85));
    if (!blob) throw new Error('no image');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { type: 'image/jpeg', data: btoa(bin) };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** "I have paid": how, how much, the transaction ID, the day and a screenshot. */
export function PayForm({ L, purpose, orderId, amount, onSent }: { L: Lfn; purpose: 'plan' | 'stand'; orderId?: string; amount: number; onSent: (m: string) => void }) {
  const [method, setMethod] = useState<PayMethod | ''>('');
  const [amt, setAmt] = useState(amount ? String(amount) : '');
  const [txn, setTxn] = useState('');
  const [paidOn, setPaidOn] = useState(todayEat());
  const [shot, setShot] = useState<{ type: string; data: string } | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const fixed = purpose === 'stand';

  const pick = async (f: File | undefined) => {
    if (!f) return;
    setErr('');
    try { setShot(await shrink(f)); } catch { setShot(null); setErr(L('owner.payErrImg')); }
  };
  const send = async () => {
    const n = Number(amt);
    const problem = !method ? 'owner.payErrMethod' : !Number.isInteger(n) || n <= 0 ? 'owner.payErrAmt' : txn.trim().length < 4 ? 'owner.payErrTxn'
      : !paidOn || paidOn > todayEat() ? 'owner.payErrDate' : !shot ? 'owner.payErrShot' : '';
    if (problem) { setErr(L(problem)); return; }
    setBusy(true);
    setErr('');
    try {
      await authed('owner', 'POST', '/owner/payments', { purpose, orderId, method, amount: n, transactionId: txn.trim(), paidOn, screenshot: shot });
      onSent(L('owner.payToast'));
    } catch (e) {
      const code = e instanceof ApiFailure ? e.code : '';
      setErr(L(code === 'transaction_id_used' ? 'owner.payErrUsed' : code === 'bad_screenshot' || code === 'screenshot_too_big' ? 'owner.payErrImg'
        : code === 'bad_amount' && fixed ? 'owner.payErrTotal' : code === 'nothing_to_pay' ? 'owner.payErrNothing' : code === 'bad_paid_on' ? 'owner.payErrDate' : 'owner.tryAgain', { a: birr(L, amount) }));
    } finally { setBusy(false); }
  };

  return (
    <>
      <p className={s.help} style={{ marginTop: 14 }}>{L('owner.payIntro')}</p>
      <div className={s.section} style={{ marginTop: 18 }}>{L('owner.payHowLbl')}</div>
      <div className={s.chips} style={{ marginTop: 0 }}>
        {(Object.keys(METHOD_KEY) as PayMethod[]).map((m) => <button key={m} type="button" className={s.chip} aria-pressed={method === m} onClick={() => setMethod(m)}>{L(METHOD_KEY[m])}</button>)}
      </div>
      <label htmlFor="f_payamt" className={s.label}>{L('owner.payAmt')}</label>
      <input id="f_payamt" className={s.input} inputMode="numeric" value={amt} readOnly={fixed} onChange={(e) => setAmt(e.target.value.replace(/\D/g, '').slice(0, 8))} autoComplete="off" />
      <label htmlFor="f_paytxn" className={s.label}>{L('owner.payTxn')}</label>
      <input id="f_paytxn" className={s.input} value={txn} maxLength={60} onChange={(e) => setTxn(e.target.value)} autoComplete="off" autoCapitalize="characters" placeholder={L('owner.payTxnPh')} />
      <p className={s.muted} style={{ margin: '6px 4px 0' }}>{L('owner.payTxnHelp')}</p>
      <label htmlFor="f_paydate" className={s.label}>{L('owner.payDate')}</label>
      <input id="f_paydate" className={s.input} type="date" value={paidOn} max={todayEat()} onChange={(e) => setPaidOn(e.target.value)} />
      <div className={s.label}>{L('owner.payShot')}</div>
      <input ref={file} id="f_payshot" type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => pick(e.target.files?.[0])} />
      {shot && <img src={`data:${shot.type};base64,${shot.data}`} alt={L('owner.payShot')} style={{ display: 'block', maxWidth: '100%', maxHeight: 260, margin: '0 auto 8px', borderRadius: 10 }} />}
      <button type="button" className={s.chip} style={{ width: '100%' }} onClick={() => file.current?.click()}>{shot ? L('owner.payShotChange') : L('owner.payShotPick')}</button>
      {err && <p role="alert" style={{ margin: '12px 4px 0', fontSize: 13, lineHeight: '18px', color: RED }}>{err}</p>}
      <button type="button" className={s.cta} style={{ marginTop: 18 }} onClick={send} aria-busy={busy} disabled={busy}>{L('owner.paySend')}</button>
      <p className={s.muted} style={{ margin: '10px 4px 0' }}>{L('owner.payNote')}</p>
    </>
  );
}
