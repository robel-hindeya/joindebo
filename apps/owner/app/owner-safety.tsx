'use client';

import { useEffect, useState } from 'react';
import type { Lang } from '@temelash/i18n';
import { authed } from '@temelash/ui';
import { formatWhen } from './owner-more';
import { Icon, useLoad, type Lfn } from './owner-ui';
import s from './app.module.css';

/** Owner board: OwnUnusual (an unusual-activity alert) and OwnAlertSet (what we tell you and how). */

const RED = '#b3261e';
interface Alert {
  id: string; kind: 'stamps_per_hour' | 'hand_typed_share' | 'new_cards_per_hour'; at: string; staff: string | null; branch: string | null; personId?: string;
  stamps?: number; phones?: number; top?: number; first?: string | null; last?: string | null; share?: number; typed?: number; total?: number; cards?: number;
}

/** The Today row's sub-line for an alert. */
export const alertSub = (L: Lfn, a: { kind: string; staff: string | null }) =>
  a.kind === 'hand_typed_share' ? L('owner.attnUnusualHand') : a.kind === 'new_cards_per_hour' ? L('owner.attnUnusualCards') : L('owner.attnUnusualSub', { a: a.staff ?? '' });

export function Unusual({ L, lang, id, isMgr, onReview, onPerson, onDone }: { L: Lfn; lang: Lang; id: string; isMgr: boolean; onReview: () => void; onPerson: (id: string) => void; onDone: (m: string) => void }) {
  const r = useLoad<Alert>(`/owner/alerts/${id}`);
  if (!r.data) return null;
  const a = r.data;
  const time = (iso: string | null | undefined) => (iso ? formatWhen(iso, lang, false) : '');
  const mins = a.first && a.last ? Math.max(1, Math.round((new Date(a.last).getTime() - new Date(a.first).getTime()) / 60_000)) : 60;
  const text = a.kind === 'hand_typed_share' ? L('owner.alTextHand', { a: a.share ?? 0, b: a.typed ?? 0, c: a.total ?? 0 })
    : a.kind === 'new_cards_per_hour' ? L('owner.alTextCards', { a: a.cards ?? 0 })
    : L('owner.alText', { a: a.staff ?? '', b: a.stamps ?? 0, c: mins, d: a.phones ?? 0 });
  const rows: Array<[string, string]> = a.kind === 'stamps_per_hour'
    ? [[L('owner.alCashier'), a.staff ?? ''], [L('owner.alBranch'), a.branch ?? ''], [L('owner.alWhen'), `${time(a.first)} – ${time(a.last)}`], [L('owner.alStamps'), String(a.stamps ?? 0)], [L('owner.alPhones'), L('owner.alPhonesV', { a: a.phones ?? 0, b: a.top ?? 0 })]]
    : a.kind === 'hand_typed_share'
      ? [[L('owner.alWhen'), formatWhen(a.at, lang)], [L('owner.alStamps'), `${a.typed ?? 0} / ${a.total ?? 0}`]]
      : [[L('owner.alWhen'), formatWhen(a.at, lang)], [L('owner.alCards'), String(a.cards ?? 0)]];
  const dismiss = async () => { await authed('owner', 'POST', `/owner/alerts/${id}/dismiss`, {}); onDone(L('owner.alDismissed')); };
  return (
    <>
      <div className={`${s.card} ${s.pad}`} style={{ marginTop: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Icon d="M12 3l10 18H2zM12 10v5M12 18h.01" size={28} color={RED} />
          <div style={{ fontSize: 16, fontWeight: 700, color: '#333' }}>{L('owner.alTitle')}</div>
        </div>
        <p style={{ margin: '8px 0 0', fontSize: 14, lineHeight: '20px', color: '#444' }}>{text}</p>
      </div>
      <div className={s.section}>{L('owner.alWho')}</div>
      <div className={s.kvCard}>
        {rows.map(([k, v]) => <div key={k} className={s.kvLine}><span style={{ color: '#444' }}>{k}</span><span style={{ fontWeight: 700, color: '#333', textAlign: 'right' }}>{v}</span></div>)}
      </div>
      <p style={{ margin: '12px 0 0', fontSize: 13, lineHeight: '18px', color: '#555' }}>{L('owner.alRule')}</p>
      <button type="button" className={s.cta} onClick={onReview}>{L('owner.alReview')}</button>
      {a.kind === 'stamps_per_hour' && a.personId && !isMgr && (
        <button type="button" className={s.outline} style={{ marginTop: 8, width: '100%', minHeight: 48, color: RED, borderColor: RED }} onClick={() => onPerson(a.personId!)}>{L('owner.alOff', { a: a.staff ?? '' })}</button>
      )}
      <button type="button" className={s.ghost} onClick={dismiss}>{L('owner.alDismiss')}</button>
    </>
  );
}

type Prefs = { approve: boolean; unusual: boolean; locked: boolean; phone: boolean; daily: boolean; weekly: boolean; how: 'push' | 'sms'; time: number };
const TOGGLES: Array<[keyof Prefs, string, string]> = [
  ['approve', 'owner.asApprove', 'owner.asApproveS'], ['unusual', 'owner.asUnusual', 'owner.asUnusualS'], ['locked', 'owner.asLocked', 'owner.asLockedS'],
  ['phone', 'owner.asPhone', 'owner.asPhoneS'], ['daily', 'owner.asDaily', 'owner.asDailyS'], ['weekly', 'owner.asWeekly', 'owner.asWeeklyS'],
];

/** OwnAlertSet: switches, how (notification or SMS) and the daily summary time. */
export function AlertSettings({ L, onSaved }: { L: Lfn; onSaved: (m: string) => void }) {
  const [p, setP] = useState<Prefs | null>(null);
  useEffect(() => { authed<Prefs>('owner', 'GET', '/owner/alert-prefs').then(setP).catch(() => {}); }, []);
  if (!p) return null;
  const save = async () => { setP(await authed<Prefs>('owner', 'POST', '/owner/alert-prefs', p)); onSaved(L('owner.savedAlerts')); };
  return (
    <>
      <p className={s.help}>{L('owner.asHelp')}</p>
      <div className={s.section} style={{ marginTop: 18 }}>{L('owner.asWhat')}</div>
      <div className={s.kvCard} style={{ padding: '0 16px' }}>
        {TOGGLES.map(([k, t, sub], i) => (
          <button key={k} type="button" role="switch" aria-checked={!!p[k]} className={s.rowBtn} onClick={() => setP({ ...p, [k]: !p[k] })}
            style={{ width: '100%', minHeight: 60, padding: '8px 0', borderTop: i === 0 ? 'none' : '1.5px dashed #e0e0e0', display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left', color: '#333' }}>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 15, lineHeight: '20px', fontWeight: 700 }}>{L(t)}</span>
              <span style={{ display: 'block', marginTop: 2, fontSize: 13, lineHeight: '18px', color: '#555' }}>{L(sub)}</span>
            </span>
            <span style={{ flex: 'none', width: 46, height: 28, borderRadius: 14, background: p[k] ? '#333' : '#cfcfcf', position: 'relative' }}>
              <span className="tc-knob" style={{ position: 'absolute', top: 3, left: p[k] ? 21 : 3, width: 22, height: 22, borderRadius: '50%', background: '#fff' }} />
            </span>
          </button>
        ))}
      </div>
      <div className={s.section} style={{ marginTop: 22 }}>{L('owner.asHow')}</div>
      <div className={s.chips} style={{ marginTop: 0 }}>
        {(['push', 'sms'] as const).map((h) => <button key={h} type="button" className={s.chip} aria-pressed={p.how === h} onClick={() => setP({ ...p, how: h })}>{L(h === 'push' ? 'owner.asPush' : 'owner.asSms')}</button>)}
      </div>
      <p style={{ margin: '8px 0 0', fontSize: 13, lineHeight: '18px', color: '#555' }}>{L('owner.asHowHelp')}</p>
      <div className={s.section} style={{ marginTop: 22 }}>{L('owner.asWhen')}</div>
      <div className={s.chips} style={{ marginTop: 0 }}>
        {[20, 21, 22].map((h) => <button key={h} type="button" className={s.chip} aria-pressed={p.time === h} onClick={() => setP({ ...p, time: h })}>{`${h}:00`}</button>)}
      </div>
      <p style={{ margin: '8px 0 0', fontSize: 13, lineHeight: '18px', color: '#555' }}>{L('owner.asWhenHelp')}</p>
      <button type="button" className={s.cta} onClick={save}>{L('owner.save')}</button>
    </>
  );
}
