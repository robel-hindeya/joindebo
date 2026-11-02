'use client';

import { useEffect, useState } from 'react';
import { authed } from '@temelash/ui';
import { IC, Icon, Row, useLoad, type Lfn } from './owner-ui';
import s from './app.module.css';

/** Owner board: OwnHelp / OwnMgrHelp, OwnRoles / OwnMgrRoles, OwnFresh (setup card) and OwnOffline. */

const PHONE = 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2';
const SEND = 'M22 2L11 13M22 2l-7 20-4-9-9-4z';
const CIRCLE = 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z';

/** OwnHelp: call or message Temelash (once set in Admin), questions and answers, report a problem. */
export function Help({ L, onToast }: { L: Lfn; onToast: (m: string) => void }) {
  const r = useLoad<{ phone: string | null; telegram: string | null }>('/owner/help');
  const [open, setOpen] = useState(-1);
  const [text, setText] = useState('');
  const send = async () => {
    if (!text.trim()) return onToast(L('owner.hpNeed'));
    try { await authed('owner', 'POST', '/owner/help', { text: text.trim() }); setText(''); onToast(L('owner.hpSent')); }
    catch { onToast(L('owner.needNet')); }
  };
  const tg = r.data?.telegram ? (r.data.telegram.startsWith('http') ? r.data.telegram : `https://t.me/${r.data.telegram.replace(/^@/, '')}`) : null;
  return (
    <>
      <p className={s.help}>{L('owner.hpHelp')}</p>
      {(r.data?.phone || tg) && (
        <ul className={`${s.card} ${s.rows}`}>
          {r.data?.phone && <Row icon={PHONE} title={L('owner.hpCall')} sub={L('owner.hpCallSub')} onClick={() => { location.href = `tel:${r.data!.phone!.replace(/\s/g, '')}`; }} right={<span className={s.newTag}>{L('owner.hpCallV')}</span>} />}
          {tg && <Row icon={SEND} title={L('owner.hpTg')} sub={L('owner.hpTgSub')} onClick={() => window.open(tg, '_blank', 'noopener')} right={<span className={s.newTag}>{L('owner.hpTgV')}</span>} />}
        </ul>
      )}
      <div className={s.section}>{L('owner.hpFaq')}</div>
      <div className={s.kvCard} style={{ padding: '0 16px' }}>
        {[1, 2, 3, 4, 5].map((n, i) => (
          <div key={n} style={{ borderTop: i === 0 ? 'none' : '1.5px dashed #e0e0e0' }}>
            <button type="button" className={s.rowBtn} aria-expanded={open === i} onClick={() => setOpen(open === i ? -1 : i)}
              style={{ width: '100%', minHeight: 52, padding: '10px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, textAlign: 'left', fontSize: 15, fontWeight: 700, color: '#333' }}>
              <span>{L(`owner.fq${n}`)}</span><Icon d={open === i ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'} size={18} color="#595959" />
            </button>
            {open === i && <p style={{ margin: '0 0 12px', fontSize: 14, lineHeight: '20px', color: '#444' }}>{L(`owner.fa${n}`)}</p>}
          </div>
        ))}
      </div>
      <label htmlFor="f_prob" className={s.section} style={{ display: 'block' }}>{L('owner.hpReport')}</label>
      <textarea id="f_prob" className={s.textarea} rows={4} maxLength={1000} value={text} placeholder={L('owner.hpReportPh')} onChange={(e) => setText(e.target.value)} />
      <button type="button" className={s.cta} onClick={send}>{L('owner.hpSend')}</button>
    </>
  );
}

const ROLES = [1, 2, 3, 4, 5, 6, 7, 8];
/** What a manager may do (OwnMgrRoles marks each row yes or no). */
const MGR_CAN: Record<number, boolean> = { 1: true, 2: true, 3: true, 5: true, 6: true };

/** OwnRoles / OwnMgrRoles: who can do what. */
export function Roles({ L, isMgr }: { L: Lfn; isMgr: boolean }) {
  return (
    <>
      <p className={s.help}>{L('owner.rlHelp')}</p>
      <div className={s.kvCard} style={{ marginTop: 12 }}>
        {ROLES.map((n, i) => (
          <div key={n} style={{ padding: '10px 0', borderTop: i === 0 ? 'none' : '1.5px dashed #e0e0e0' }}>
            <div style={{ fontSize: 15, lineHeight: '20px', fontWeight: 700, color: '#333' }}>{L(`owner.rr${n}`)}</div>
            <div style={{ marginTop: 2, fontSize: 13, lineHeight: '18px', color: '#555' }}>{isMgr ? `${L(MGR_CAN[n] ? 'owner.rlYes' : 'owner.rlNo')} · ` : ''}{L(`owner.rr${n}s`)}</div>
          </div>
        ))}
      </div>
      <p className={s.muted} style={{ marginTop: 12 }}>{L('owner.rlNote')}</p>
    </>
  );
}

export interface Setup { card: boolean; details: boolean; staff: boolean; poster: boolean }
/** OwnFresh: "Set up your shop", four steps with a progress bar, until all are done. */
export function SetupCard({ L, setup, go }: { L: Lfn; setup: Setup; go: (to: 'card' | 'details' | 'addPerson' | 'poster') => void }) {
  const steps: Array<[keyof Setup, string, string, 'card' | 'details' | 'addPerson' | 'poster']> = [
    ['card', 'owner.suCard', 'owner.suCardSub', 'card'], ['details', 'owner.suDetails', 'owner.suDetailsSub', 'details'],
    ['staff', 'owner.suStaff', 'owner.suStaffSub', 'addPerson'], ['poster', 'owner.suPoster', 'owner.suPosterSub', 'poster'],
  ];
  const done = steps.filter(([k]) => setup[k]).length;
  return (
    <>
      <div className={`${s.card} ${s.pad}`} style={{ marginTop: 14 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#333' }}>{L('owner.setupTitle')}</h2>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#333' }}>{L('owner.setupCount', { a: done, b: 4 })}</span>
        </div>
        <div style={{ marginTop: 10, height: 8, borderRadius: 4, background: '#e6e6e6' }} role="progressbar" aria-valuemin={0} aria-valuemax={4} aria-valuenow={done}>
          <div style={{ height: 8, borderRadius: 4, background: '#333', width: `${done * 25}%` }} />
        </div>
        <p style={{ margin: '10px 0 0', fontSize: 14, lineHeight: '20px', color: '#555' }}>{L('owner.setupHelp')}</p>
      </div>
      <ul className={`${s.card} ${s.rows}`} style={{ marginTop: 12 }}>
        {steps.map(([k, t, sub, to]) => <Row key={k} icon={setup[k] ? IC.check : CIRCLE} title={L(t)} sub={L(sub)} onClick={() => go(to)} right={setup[k] ? <span className={s.newTag}>{L('owner.doneTag')}</span> : undefined} />)}
      </ul>
    </>
  );
}

/** OwnOffline: a banner while the phone has no connection. */
export function OfflineBanner({ L }: { L: Lfn }) {
  const [off, setOff] = useState(false);
  useEffect(() => {
    const on = () => setOff(!navigator.onLine);
    on();
    window.addEventListener('online', on);
    window.addEventListener('offline', on);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', on); };
  }, []);
  if (!off) return null;
  return <p role="status" className={s.killNote} style={{ background: '#444' }}>{L('owner.offBanner')}</p>;
}
