'use client';

import { useState } from 'react';
import type { Lang } from '@temelash/i18n';
import { ApiFailure, authed } from '@temelash/ui';
import { formatDay } from './owner-more';
import { IC, Icon, type Lfn } from './owner-ui';
import s from './app.module.css';

/**
 * Paying in cash (DECISIONS.md, 2026-11-06): where to pay, "I paid cash" with the amount, the day
 * and who took the money, and the payments reported with their check. No board draws these yet;
 * they use the Plan page's cards, fields and chips. Owners only.
 */

const RED = '#b3261e';
export type PayMethod = 'cash' | 'telebirr' | 'cbe_birr' | 'bank';
export interface PayTo { cash: string }
export interface Claim { id: string; method: PayMethod; amount: number; transactionId: string; receivedBy: string | null; paidOn: string; status: 'waiting' | 'approved' | 'rejected'; reason: string | null; createdAt: string; receiptNo: string | null }

const METHOD_KEY: Record<PayMethod, string> = { cash: 'owner.soCash', telebirr: 'owner.soTele', cbe_birr: 'owner.payCbe', bank: 'owner.payBank' };
const todayEat = () => new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
const birr = (L: Lfn, n: number) => L('owner.birr', { a: n.toLocaleString('en-US') });

/** "Where to pay": the place set in Admin, and "I paid cash". */
export function PayToCard({ L, payTo, onPay }: { L: Lfn; payTo: PayTo; onPay?: () => void }) {
  return (
    <div className={s.card} style={{ marginTop: 18, padding: 14 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <Icon d={IC.info} size={22} color="#444" />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#333' }}>{L('owner.plHowT')}</div>
          <p style={{ margin: '3px 0 0', fontSize: 13, lineHeight: '18px', color: '#555' }}>{payTo.cash ? L('owner.payToText') : L('owner.payToNone')}</p>
          {payTo.cash && <p style={{ margin: '8px 0 0', fontSize: 14, lineHeight: '20px', fontWeight: 700, color: '#333', overflowWrap: 'anywhere' }}>{payTo.cash}</p>}
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
              {' · '}{c.receivedBy ?? c.transactionId}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

/** "I paid cash": how much, the day and who took the money. */
export function PayForm({ L, purpose, orderId, amount, onSent }: { L: Lfn; purpose: 'plan' | 'stand'; orderId?: string; amount: number; onSent: (m: string) => void }) {
  const [amt, setAmt] = useState(amount ? String(amount) : '');
  const [who, setWho] = useState('');
  const [paidOn, setPaidOn] = useState(todayEat());
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const fixed = purpose === 'stand';

  const send = async () => {
    const n = Number(amt);
    const problem = !Number.isInteger(n) || n <= 0 ? 'owner.payErrAmt' : who.trim().length < 2 ? 'owner.payErrWho' : !paidOn || paidOn > todayEat() ? 'owner.payErrDate' : '';
    if (problem) { setErr(L(problem)); return; }
    setBusy(true);
    setErr('');
    try {
      await authed('owner', 'POST', '/owner/payments', { purpose, orderId, amount: n, receivedBy: who.trim(), paidOn });
      onSent(L('owner.payToast'));
    } catch (e) {
      const code = e instanceof ApiFailure ? e.code : '';
      setErr(L(code === 'claim_waiting' ? 'owner.payErrWaiting' : code === 'received_by_needed' ? 'owner.payErrWho' : code === 'bad_amount' && fixed ? 'owner.payErrTotal'
        : code === 'nothing_to_pay' ? 'owner.payErrNothing' : code === 'bad_paid_on' ? 'owner.payErrDate' : 'owner.tryAgain', { a: birr(L, Number(amt) || 0) }));
    } finally { setBusy(false); }
  };

  return (
    <>
      <p className={s.help} style={{ marginTop: 14 }}>{L('owner.payIntro')}</p>
      <label htmlFor="f_payamt" className={s.label}>{L('owner.payAmt')}</label>
      <input id="f_payamt" className={s.input} inputMode="numeric" value={amt} readOnly={fixed} onChange={(e) => setAmt(e.target.value.replace(/\D/g, '').slice(0, 8))} autoComplete="off" />
      <label htmlFor="f_paywho" className={s.label}>{L('owner.payWho')}</label>
      <input id="f_paywho" className={s.input} value={who} maxLength={80} onChange={(e) => setWho(e.target.value)} autoComplete="off" placeholder={L('owner.payWhoPh')} />
      <label htmlFor="f_paydate" className={s.label}>{L('owner.payDate')}</label>
      <input id="f_paydate" className={s.input} type="date" value={paidOn} max={todayEat()} onChange={(e) => setPaidOn(e.target.value)} />
      {err && <p role="alert" style={{ margin: '12px 4px 0', fontSize: 13, lineHeight: '18px', color: RED }}>{err}</p>}
      <button type="button" className={s.cta} style={{ marginTop: 18 }} onClick={send} aria-busy={busy} disabled={busy}>{L('owner.paySend')}</button>
      <p className={s.muted} style={{ margin: '10px 4px 0' }}>{L('owner.payNote')}</p>
    </>
  );
}
