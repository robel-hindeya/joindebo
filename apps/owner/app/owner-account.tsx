'use client';

import { useState } from 'react';
import type { Lang } from '@temelash/i18n';
import { ApiFailure, authed } from '@temelash/ui';
import { formatDay, formatWhen } from './owner-more';
import { IC, Row, showPhone, useLoad, type Lfn } from './owner-ui';
import s from './app.module.css';

/** Owner board: Security → YOUR ACCOUNT, OwnChangePhone*, OwnCloseBiz* and OwnPrivacy*. */

const RED = '#b3261e';
const WARN = 'M12 3l10 18H2zM12 10v5M12 18h.01';
interface CloseState { state: 'none' | 'pending' | 'approved'; answerDays: number; afterDays: number; ref?: string; sentAt?: string; answerBy?: string; approvedAt?: string; closesOn?: string; daysLeft?: number }
const day = (iso: string, lang: Lang) => formatDay(new Date(`${iso}T12:00:00+03:00`), lang);

function Kv({ rows }: { rows: Array<[string, string]> }) {
  return <div className={s.kvCard}>{rows.map(([k, v]) => <div key={k} className={s.kvLine}><span style={{ color: '#444' }}>{k}</span><span style={{ fontWeight: 700, color: '#333', textAlign: 'right' }}>{v}</span></div>)}</div>;
}
function Steps({ items }: { items: string[] }) {
  return (
    <div className={s.kvCard}>
      {items.map((t, i) => (
        <div key={t} className={s.kvLine} style={{ justifyContent: 'flex-start', gap: 12 }}>
          <span style={{ flex: 'none', width: 24, height: 24, borderRadius: '50%', background: '#333', color: '#fff', fontSize: 13, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{i + 1}</span>
          <span style={{ color: '#333', lineHeight: '20px' }}>{t}</span>
        </div>
      ))}
    </div>
  );
}
function PinField({ id, label, v, set }: { id: string; label: string; v: string; set: (x: string) => void }) {
  return (
    <>
      <label htmlFor={id} className={s.label}>{label}</label>
      <input id={id} className={s.input} type="password" inputMode="numeric" maxLength={6} placeholder="------" value={v} onChange={(e) => set(e.target.value.replace(/\D/g, '').slice(0, 6))} />
    </>
  );
}

/** "Download my reports and customer list": the shop's cards as a spreadsheet file. */
async function download(L: Lfn, onToast: (m: string) => void) {
  const r = await authed<{ filename: string; csv: string }>('owner', 'GET', '/owner/export');
  const url = URL.createObjectURL(new Blob([r.csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = r.filename; a.click();
  URL.revokeObjectURL(url);
  onToast(L('owner.cbSaved'));
}

/** Security → YOUR ACCOUNT: change phone (everyone), close the business (owners). */
export function AccountRows({ L, lang, isMgr, phone, onPhone, onClose }: { L: Lfn; lang: Lang; isMgr: boolean; phone: string; onPhone: () => void; onClose: () => void }) {
  const c = useLoad<CloseState>(isMgr ? null : '/owner/close');
  const close = c.data;
  return (
    <>
      <div className={s.section}>{L('owner.accLbl')}</div>
      <ul className={`${s.card} ${s.rows}`}>
        <Row icon="M7 3h10v18H7zM11 18h2" title={L('owner.accPhone')} sub={L('owner.accPhoneSub', { a: showPhone(phone) })} onClick={onPhone} />
        {!isMgr && close && (close.state === 'approved'
          ? <Row icon={WARN} title={L('owner.accCloseOk')} sub={L('owner.accCloseOkSub', { a: close.closesOn ? day(close.closesOn, lang) : '' })} onClick={onClose} />
          : close.state === 'pending'
            ? <Row icon={IC.clock} title={L('owner.accClosePend')} sub={L('owner.accClosePendSub')} onClick={onClose} />
            : <Row icon={IC.x} title={L('owner.accClose')} sub={L('owner.accCloseSub')} onClick={onClose} />)}
      </ul>
    </>
  );
}

/** OwnChangePhone: new number and PIN, then the code sent to the new number. */
export function ChangePhone({ L, phone, onDone }: { L: Lfn; phone: string; onDone: (m: string) => void }) {
  const [next, setNext] = useState('');
  const [pin, setPin] = useState('');
  const [code, setCode] = useState('');
  const [ticket, setTicket] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>) => { if (busy) return; setBusy(true); try { await fn(); } finally { setBusy(false); } };
  const send = () => run(async () => {
    if (next.replace(/\D/g, '').length < 9) return setErr(L('owner.cpBadNum'));
    try {
      setTicket((await authed<{ ticket: string }>('owner', 'POST', '/owner/phone/start', { phone: next, pin })).ticket);
      setErr('');
    } catch (e) {
      const c = e instanceof ApiFailure ? e.code : '';
      setErr(c === 'same_number' ? L('owner.cpSame') : c === 'wrong_pin' ? L('owner.cpWrongPin') : c === 'bad_phone' ? L('owner.cpBadNum') : L('owner.tryAgain'));
    }
  });
  const confirm = () => run(async () => {
    try {
      await authed('owner', 'POST', '/owner/phone/confirm', { ticket, code });
      onDone(L('owner.cpDone'));
    } catch { setErr(L('owner.cpBadCode')); }
  });
  return (
    <>
      <p className={s.help}>{ticket ? L('owner.cpHelp1', { a: next }) : L('owner.cpHelp0')}</p>
      {!ticket ? (
        <>
          <div className={s.label}>{L('owner.cpCurLbl')}</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#333' }}>{phone}</div>
          <label htmlFor="f_cpnew" className={s.label}>{L('owner.cpNewLbl')}</label>
          <input id="f_cpnew" className={s.input} type="tel" inputMode="tel" maxLength={16} placeholder="+251 9X XXX XXXX" value={next} onChange={(e) => setNext(e.target.value)} />
          <PinField id="f_cppin" label={L('owner.cpPinLbl')} v={pin} set={setPin} />
          <p className={s.muted} style={{ marginTop: 10 }}>{L('owner.cpNote')}</p>
          <p role="alert" className={s.alert}>{err}</p>
          <button type="button" className={s.cta} onClick={send} aria-busy={busy}>{L('owner.cpSend')}</button>
        </>
      ) : (
        <>
          <label htmlFor="f_cpotp" className={s.label}>{L('owner.otpLbl')}</label>
          <input id="f_cpotp" className={s.input} inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="------" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} />
          <p role="alert" className={s.alert}>{err}</p>
          <button type="button" className={s.cta} onClick={confirm} aria-busy={busy}>{L('owner.cpConfirm')}</button>
          <button type="button" className={s.ghost} onClick={() => { setTicket(''); setCode(''); setErr(''); send(); }}>{L('owner.cpResend')}</button>
        </>
      )}
    </>
  );
}

/** OwnCloseBiz (none), OwnCloseBizPending and OwnCloseBizApproved. */
export function CloseBiz({ L, lang, onToast, onChanged }: { L: Lfn; lang: Lang; onToast: (m: string) => void; onChanged: () => void }) {
  const r = useLoad<CloseState>('/owner/close');
  const [reason, setReason] = useState('');
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  if (!r.data) return null;
  const c = r.data;
  const reasons = ['owner.cbR1', 'owner.cbR2', 'owner.cbR3', 'owner.cbR4'];
  const send = async () => {
    if (!/^\d{6}$/.test(pin)) return setErr(L('owner.cbNeedPin'));
    try {
      await authed('owner', 'POST', '/owner/close', { reason: L(reason || 'owner.cbR4'), pin });
      setPin(''); setErr(''); onToast(L('owner.cbSentToast')); r.reload(); onChanged();
    } catch (e) { setErr(e instanceof ApiFailure && e.code === 'wrong_pin' ? L('owner.cbWrongPin') : L('owner.tryAgain')); }
  };
  const cancel = async (toast: string) => { await authed('owner', 'POST', '/owner/close/cancel', {}); onToast(toast); r.reload(); onChanged(); };
  if (c.state === 'pending') {
    return (
      <>
        <div className={`${s.card} ${s.pad}`}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}><Icon d={IC.clock} /><div style={{ fontSize: 16, fontWeight: 700 }}>{L('owner.cbPendT')}</div></div>
          <p style={{ margin: '6px 0 0', fontSize: 14, lineHeight: '20px', color: '#444' }}>{L('owner.cbPendText', { a: c.answerBy ? day(c.answerBy, lang) : '' })}</p>
        </div>
        <div style={{ height: 12 }} />
        <Kv rows={[[L('owner.cbReqLbl'), c.ref ?? ''], [L('owner.cbSentLbl'), c.sentAt ? formatWhen(c.sentAt, lang) : ''], [L('owner.cbAnsLbl'), c.answerBy ? day(c.answerBy, lang) : '']]} />
        <div className={s.section}>{L('owner.cbNext')}</div>
        <Steps items={[L('owner.cbS3'), L('owner.cbS4')]} />
        <button type="button" className={s.outline} style={{ marginTop: 18, width: '100%' }} onClick={() => cancel(L('owner.cbCancelToast'))}>{L('owner.cbCancelReq')}</button>
      </>
    );
  }
  if (c.state === 'approved') {
    return (
      <>
        <div className={`${s.card} ${s.pad}`}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}><Icon d={WARN} color={RED} /><div style={{ fontSize: 16, fontWeight: 700, color: RED }}>{L('owner.cbOkT')}</div></div>
          <p style={{ margin: '6px 0 0', fontSize: 14, lineHeight: '20px', color: '#444' }}>{L('owner.cbOkText', { a: c.closesOn ? day(c.closesOn, lang) : '' })}</p>
        </div>
        <div style={{ height: 12 }} />
        <Kv rows={[[L('owner.cbApprLbl'), c.approvedAt ? formatDay(new Date(c.approvedAt), lang) : ''], [L('owner.cbCloseOnLbl'), c.closesOn ? day(c.closesOn, lang) : ''], [L('owner.cbDaysLbl'), L('owner.cbDaysV', { a: c.daysLeft ?? 0 }, c.daysLeft ?? 0)]]} />
        <div className={s.section}>{L('owner.cbDelLbl')}</div>
        <div className={s.kvCard}>{['owner.cbD1', 'owner.cbD2', 'owner.cbD3', 'owner.cbD4'].map((k) => <div key={k} className={s.kvLine}><span style={{ color: '#333' }}>{L(k)}</span></div>)}</div>
        <p className={s.muted} style={{ marginTop: 10 }}>{L('owner.cbCustNote')}</p>
        <button type="button" className={s.cta} onClick={() => cancel(L('owner.cbKeptToast'))}>{L('owner.cbKeep')}</button>
        <button type="button" className={s.ghost} onClick={() => download(L, onToast)}>{L('owner.cbSaveData')}</button>
      </>
    );
  }
  return (
    <>
      <p className={s.help}>{L('owner.cbHelp')}</p>
      <div className={s.section}>{L('owner.cbStepsLbl')}</div>
      <Steps items={[L('owner.cbS1'), L('owner.cbS2'), L('owner.cbS3'), L('owner.cbS4')]} />
      <div className={s.section}>{L('owner.cbBefore')}</div>
      <button type="button" className={s.outline} style={{ marginTop: 0, width: '100%' }} onClick={() => download(L, onToast)}>{L('owner.cbDownload')}</button>
      <div className={s.section}>{L('owner.cbWhy')}</div>
      <div className={s.chips} style={{ marginTop: 0 }}>
        {reasons.map((k) => <button key={k} type="button" className={s.chip} aria-pressed={reason === k} onClick={() => setReason(k)}>{L(k)}</button>)}
      </div>
      <PinField id="f_cbpin" label={L('owner.cbPinLbl')} v={pin} set={setPin} />
      <p role="alert" className={s.alert}>{err}</p>
      <button type="button" className={s.cta} style={{ background: RED }} onClick={send}>{L('owner.cbSend')}</button>
    </>
  );
}

function Icon({ d, color = '#333' }: { d: string; color?: string }) {
  return <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;
}

/** OwnPrivacy: what the shop may do with customer data, and passing on a deletion request. */
export function Privacy({ L, lang, onToast }: { L: Lfn; lang: Lang; onToast: (m: string) => void }) {
  const list = useLoad<Array<{ last4: string; status: 'waiting' | 'done' | 'rejected'; doneAt: string | null }>>('/owner/privacy/requests');
  const [phone, setPhone] = useState('');
  const [sent, setSent] = useState(false);
  const bullets = (keys: string[]) => <div className={s.kvCard}>{keys.map((k) => <div key={k} className={s.kvLine}><span style={{ color: '#333', lineHeight: '20px' }}>{L(k)}</span></div>)}</div>;
  const send = async () => {
    if (phone.replace(/\D/g, '').length < 9) return onToast(L('owner.siMissing'));
    try {
      await authed('owner', 'POST', '/owner/privacy/requests', { phone });
      setPhone(''); setSent(true); onToast(L('owner.prSentToast')); list.reload();
    } catch { onToast(L('owner.badPhone')); }
  };
  return (
    <>
      <p className={s.help}>{L('owner.prHelp')}</p>
      <div className={s.section}>{L('owner.prSeeLbl')}</div>
      {bullets(['owner.prSee1', 'owner.prSee2', 'owner.prSee3', 'owner.prSee4', 'owner.prSee5'])}
      <div className={s.section}>{L('owner.prDoLbl')}</div>
      {bullets(['owner.prDo1', 'owner.prDo2', 'owner.prDo3'])}
      <div className={s.section}>{L('owner.prDontLbl')}</div>
      {bullets(['owner.prDont1', 'owner.prDont2', 'owner.prDont3'])}
      <div className={s.section}>{L('owner.prKeepLbl')}</div>
      <p className={s.muted} style={{ margin: 0 }}>{L('owner.prKeep')}</p>
      <div className={s.section}>{L('owner.prReqLbl')}</div>
      <p className={s.muted} style={{ margin: 0 }}>{L('owner.prReqHelp')}</p>
      {sent ? (
        <div className={`${s.card} ${s.pad}`} style={{ marginTop: 12 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{L('owner.prSentT')}</div>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#555' }}>{L('owner.prSentText')}</p>
        </div>
      ) : (
        <>
          <label htmlFor="f_prphone" className={s.label}>{L('owner.prPhoneLbl')}</label>
          <input id="f_prphone" className={s.input} type="tel" inputMode="tel" maxLength={16} placeholder="+251 9X XXX XXXX" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <button type="button" className={s.cta} onClick={send}>{L('owner.prSendReq')}</button>
        </>
      )}
      {(list.data ?? []).length > 0 && (
        <>
          <div className={s.section}>{L('owner.prListLbl')}</div>
          <Kv rows={(list.data ?? []).map((q): [string, string] => [`+251 •• ••• ${q.last4}`, q.status === 'waiting' ? L('owner.prWaiting') : q.status === 'rejected' ? L('owner.prRejected') : L('owner.prDone', { a: q.doneAt ? formatWhen(q.doneAt, lang).split(',')[0] : '' })])} />
        </>
      )}
      <p className={s.muted} style={{ marginTop: 14 }}>{L('owner.prDraft')}</p>
    </>
  );
}
