'use client';

import { useEffect, useState } from 'react';
import { authed } from '@temelash/ui';
import s from './wallet.module.css';

/**
 * Main board, the wallet's menu panel (who is signed in, Sign out, History)
 * and the History screen (stamps and rewards by month, filtered).
 * Notifications and Settings (the NOTIFICATIONS switches) arrived with Phase 6.
 */

type Lfn = (k: string, v?: Record<string, string | number>, n?: number) => string;

const X = 'M6 6l12 12M18 6L6 18';
const OUT = 'M15 4h4v16h-4M10 16l4-4-4-4M14 12H4';
const HIST = 'M3 12a9 9 0 1 0 3-6.7M3 4v5h5M12 7v5l3 2';
const CHEV = 'M9 6l6 6-6 6';
const BACK = 'M15 6l-6 6 6 6';
const USER = 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4 4-6 8-6s8 2 8 6';
const EAT = 'Africa/Addis_Ababa';
export const BELL = 'M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9zM10 20a2 2 0 0 0 4 0';
const COG = 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z';

function Icon({ d, size = 22, color = '#333', width = 1.6 }: { d: string; size?: number; color?: string; width?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;
}

export function CustomerMenu({ L, unread, onClose, onSignOut, onHistory, onNotifications, onSettings }: { L: Lfn; unread: number; onClose: () => void; onSignOut: () => void; onHistory: () => void; onNotifications: () => void; onSettings: () => void }) {
  const [phone, setPhone] = useState('');
  useEffect(() => {
    authed<{ phone: string | null }>('customer', 'GET', '/me').then((m) => setPhone(m.phone ? '0' + m.phone.slice(4) : '')).catch(() => {});
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className={`${s.menuWrap} tc-fade`}>
      <button type="button" className={s.menuDim} aria-label={L('main.closeMenu')} onClick={onClose} />
      <div className={`${s.menuPanel} tc-panel`} role="dialog" aria-modal="true" aria-label={L('main.menu')}>
        <div className={s.menuHdr}>
          <h2 className={s.menuTitle}>{L('main.menu')}</h2>
          <button type="button" className={s.iconBtn} style={{ marginRight: -10 }} aria-label={L('main.closeMenu')} onClick={onClose} autoFocus><Icon d={X} /></button>
        </div>
        <div className={s.menuMe}>
          <div style={{ minWidth: 0 }}>
            <div className={s.menuName}><Icon d={USER} color="#444" width={1.8} /><span>{phone}</span></div>
          </div>
          <button type="button" className={s.menuOut} onClick={onSignOut}><Icon d={OUT} size={16} color="#444" width={2} /><span>{L('main.signOut')}</span></button>
        </div>
        <nav aria-label={L('main.menu')} className={s.menuNav}>
          <button type="button" className={s.menuItem} onClick={onNotifications}>
            <Icon d={BELL} color="#444" width={1.7} />
            <span style={{ flex: 1, minWidth: 0 }}>{L('main.notifications')}</span>
            {unread > 0 && <span className={s.menuBadge}>{unread}</span>}
            <Icon d={CHEV} size={16} color="#595959" width={2} />
          </button>
          <button type="button" className={s.menuItem} onClick={onHistory}>
            <Icon d={HIST} color="#444" width={1.7} />
            <span style={{ flex: 1, minWidth: 0 }}>{L('main.history')}</span>
            <Icon d={CHEV} size={16} color="#595959" width={2} />
          </button>
          <button type="button" className={s.menuItem} onClick={onSettings}>
            <Icon d={COG} color="#444" width={1.7} />
            <span style={{ flex: 1, minWidth: 0 }}>{L('main.settings')}</span>
            <Icon d={CHEV} size={16} color="#595959" width={2} />
          </button>
        </nav>
      </div>
    </div>
  );
}

interface HistRow { type: 'stamp' | 'reward'; at: string; reward: string | null; shop: string; shopCode: string; color: string | null; logoUrl: string | null }

/** Shop logo, or initials on the shop colour (as on the cards). */
function Logo({ r }: { r: HistRow }) {
  if (r.logoUrl) return <img src={r.logoUrl} alt="" width={40} height={40} style={{ flex: 'none', borderRadius: '50%', objectFit: 'cover' }} />;
  const ini = r.shop.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  return <span aria-hidden="true" className={s.histLogo} style={{ background: r.color ?? '#333' }}>{ini}</span>;
}

export function History({ L, onBack }: { L: Lfn; onBack: () => void }) {
  const [rows, setRows] = useState<HistRow[] | null>(null);
  const [filter, setFilter] = useState<'all' | 'stamp' | 'reward'>('all');
  useEffect(() => {
    authed<HistRow[]>('customer', 'GET', '/customer/history').then(setRows).catch(() => setRows([]));
  }, []);
  const parts = (iso: string) => {
    const [y, m, d] = new Date(iso).toLocaleDateString('en-CA', { timeZone: EAT }).split('-').map(Number);
    return { y, m, d };
  };
  const shown = (rows ?? []).filter((r) => filter === 'all' || r.type === filter);
  const items: Array<{ head: string } | { row: HistRow; date: string }> = [];
  let last = '';
  for (const r of shown) {
    const { y, m, d } = parts(r.at);
    const head = `${L(`main.m${m}`)} ${y}`;
    if (head !== last) { items.push({ head }); last = head; }
    items.push({ row: r, date: `${d} ${L(`main.m${m}`)} ${y}` });
  }
  return (
    <main className={`${s.screen} tc-fade`}>
      <div className={s.header}>
        <button type="button" className={s.iconBtn} aria-label={L('main.back')} onClick={onBack}><Icon d={BACK} size={24} /></button>
        <h1 className={s.title}>{L('main.history')}</h1>
        <div style={{ width: 44, height: 44 }} />
      </div>
      <div className={s.histBody}>
        <div role="group" aria-label={L('main.history')} className={s.histFilters}>
          {([['all', 'main.hAll'], ['stamp', 'main.hStamps'], ['reward', 'main.hRewards']] as const).map(([v, k]) => (
            <button key={v} type="button" className={s.histChip} aria-pressed={filter === v} onClick={() => setFilter(v)}>{L(k)}</button>
          ))}
        </div>
        {rows && shown.length === 0 && <div className={s.histEmpty}>{L('main.noHistory')}</div>}
        <div className={s.histList}>
          {items.map((it, i) => ('head' in it ? (
            <h2 key={i} className={s.histHead}>{it.head}</h2>
          ) : (
            <div key={i} className={s.histRow}>
              <Logo r={it.row} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className={s.histTitle}>{it.row.type === 'reward' ? L('main.hRewardT', { a: it.row.reward ?? '' }) : L('main.hStampT')}</div>
                <div className={s.histSub}>{it.row.shop} · {it.date}</div>
              </div>
              <span className={s.histBadge}>{it.row.type === 'reward' ? L('main.badgeRedeemed') : '+1'}</span>
            </div>
          )))}
        </div>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------- Notifications (Notifications board)
interface Notice { id: string; type: string; data: Record<string, unknown>; createdAt: string; readAt: string | null; shop: string | null; count: number | null; total: number | null; reward: string | null }
const N_ICON = {
  notice: 'M12 8v5M12 16.5h.01M10.3 3.9L2.4 17.5A2 2 0 0 0 4.1 20.5h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  stamp: 'M5 12.5l4.5 4.5L19 7.5',
  near: 'M4 10h16v10H4zM3 10h18M12 10v10M12 10C9.5 5.5 6 6.5 7.5 8.5 8.5 9.8 10.5 10 12 10zM12 10c2.5-4.5 6-3.5 4.5-1.5-1 1.3-3 1.5-4.5 1.5z',
  exp: 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  offer: 'M3 12V4h8l10 10-8 8zM7.5 8.5h.01',
};

/** The board's wording for each notification; card notices use the shop's customer messages. */
function noticeText(L: Lfn, lang: string, n: Notice): { icon: string; title: string; body: string } {
  const shop = n.shop ?? '';
  const d = n.data;
  const reward = n.reward ?? String(d.reward ?? '');
  const c = n.count ?? 0;
  const tot = n.total ?? 0;
  switch (n.type) {
    case 'stamp_added': return { icon: N_ICON.stamp, title: L('main.nStampT', { a: shop }), body: L('main.nStampB', { a: c, b: tot }) };
    case 'reward_unlocked': return { icon: N_ICON.near, title: L('main.rewardUnlocked'), body: L('main.rewardUnlockedSub', { a: reward }) };
    case 'reward_used': return { icon: N_ICON.stamp, title: L('main.rdDoneTitle'), body: `${shop} · ${reward}` };
    case 'near_reward': return { icon: N_ICON.near, title: L('main.nNearT'), body: L('main.nNearB', { a: shop, b: reward }) };
    case 'reward_expiring': return { icon: N_ICON.exp, title: L('main.nExpT'), body: L('main.nExpB', { a: reward, b: shop, c: Number(d.days ?? 0) }) };
    case 'news': {
      const texts = (d.texts ?? {}) as Record<string, { title: string; body: string }>;
      const t = texts[lang] ?? texts.en ?? { title: '', body: '' };
      return { icon: N_ICON.offer, title: L('main.nOfferT', { a: shop }), body: `${t.title}. ${t.body}` };
    }
    case 'card_paused': return { icon: N_ICON.notice, title: L('owner.cmPauseT', { a: shop }), body: L('owner.cmPauseB', { a: shop }) };
    case 'card_resumed': return { icon: N_ICON.notice, title: L('owner.cmResumeT'), body: L('owner.cmResumeB', { a: shop }) };
    case 'fix_add': return { icon: N_ICON.notice, title: L('owner.cmAddT'), body: L('owner.cmAddB', { a: shop, b: Number(d.count ?? 1), c, d: tot }) };
    case 'fix_remove': return { icon: N_ICON.notice, title: L('owner.cmRmT'), body: L('owner.cmRmB', { a: shop, b: Number(d.count ?? 1), c, d: tot }) };
    case 'fix_undo': return { icon: N_ICON.notice, title: L('owner.cmUndoT'), body: L('owner.cmUndoB', { a: shop, b: reward }) };
    case 'fix_extend': return { icon: N_ICON.notice, title: L('owner.cmExtT'), body: L('owner.cmExtB', { a: shop, b: reward, c: Number(d.days ?? 0) }) };
    default: return { icon: N_ICON.notice, title: shop, body: '' };
  }
}

/** "5m ago", "3h ago", "Yesterday", "4d ago" (board `ago`). */
function ago(L: Lfn, iso: string): string {
  const m = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  return m < 60 ? L('main.agoM', { a: m }) : m < 1440 ? L('main.agoH', { a: Math.floor(m / 60) }) : m < 2880 ? L('main.yesterday') : L('main.agoD', { a: Math.floor(m / 1440) });
}

export function Notifications({ L, lang, onBack }: { L: Lfn; lang: string; onBack: () => void }) {
  const [list, setList] = useState<Notice[] | null>(null);
  const load = () => authed<Notice[]>('customer', 'GET', '/customer/notifications').then(setList).catch(() => setList([]));
  useEffect(() => { load(); }, []);
  const unread = (list ?? []).filter((n) => !n.readAt).length;
  const markAll = async () => { await authed('customer', 'POST', '/customer/notifications/read', {}); load(); };
  const open = async (n: Notice) => { if (!n.readAt) { await authed('customer', 'POST', '/customer/notifications/read', { id: n.id }); load(); } };
  return (
    <main className={`${s.screen} tc-fade`}>
      <div className={s.header}>
        <button type="button" className={s.iconBtn} aria-label={L('main.back')} onClick={onBack}><Icon d={BACK} size={24} /></button>
        <h1 className={s.title}>{L('main.notifications')}</h1>
        <div style={{ width: 44, height: 44 }} />
      </div>
      <div className={s.histBody}>
        <div className={s.notifTop}>
          <span role="status" style={{ fontSize: 13, letterSpacing: 0.4, color: '#555' }}>{unread ? L('main.newCount', { a: unread }) : L('main.allCaughtUp')}</span>
          <button type="button" className={s.markAll} onClick={markAll}>{L('main.markAllRead')}</button>
        </div>
        {list && list.length === 0 && <div className={s.histEmpty}>{L('main.noNotifs')}</div>}
        <div className={s.notifList}>
          {(list ?? []).map((n) => {
            const t = noticeText(L, lang, n);
            return (
              <button key={n.id} type="button" className={s.notif} aria-label={`${t.title}. ${t.body} ${ago(L, n.createdAt)}`} onClick={() => open(n)}>
                <span className={s.notifIcon}><Icon d={t.icon} size={20} color="#444" width={1.8} /></span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span className={s.notifT}>{t.title}</span>
                  {t.body && <span className={s.notifB}>{t.body}</span>}
                  <span className={s.notifW}>{ago(L, n.createdAt)}</span>
                </span>
                {!n.readAt && <span aria-hidden="true" className={s.notifDot} />}
              </button>
            );
          })}
        </div>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------- Settings: NOTIFICATIONS, PRIVACY, ACCOUNT (Settings board)
type Prefs = { stamp: boolean; near: boolean; exp: boolean; offer: boolean };
type Privacy = { share: boolean; pers: boolean };

function Switch({ on, label, sub, onFlip, disabled }: { on: boolean; label: string; sub: string; onFlip: () => void; disabled: boolean }) {
  return (
    <li className={s.setRow}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, lineHeight: '19px', color: '#333' }}>{label}</div>
        <div style={{ marginTop: 2, fontSize: 13, lineHeight: '17px', color: '#595959' }}>{sub}</div>
      </div>
      <button type="button" role="switch" aria-checked={on} aria-label={label} className={s.switchBtn} onClick={onFlip} disabled={disabled}>
        <span className={s.switchTrack} style={{ background: on ? '#333' : '#cfcfcf' }}><span className={`${s.switchKnob} tc-knob`} style={{ left: on ? 23 : 3 }} /></span>
      </button>
    </li>
  );
}

export function Settings({ L, onBack, onGone }: { L: Lfn; onBack: () => void; onGone: () => void }) {
  const [p, setP] = useState<Prefs | null>(null);
  const [pv, setPv] = useState<Privacy | null>(null);
  const [flash, setFlash] = useState('');
  const [del, setDel] = useState<null | 'form' | 'done'>(null);
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => {
    authed<Prefs>('customer', 'GET', '/customer/prefs').then(setP).catch(() => {});
    authed<Privacy>('customer', 'GET', '/customer/privacy').then(setPv).catch(() => {});
  }, []);
  const flip = async (k: keyof Prefs) => {
    if (!p) return;
    const next = { ...p, [k]: !p[k] };
    setP(next);
    setP(await authed<Prefs>('customer', 'POST', '/customer/prefs', { [k]: next[k] }).catch(() => p));
  };
  const flipPv = async (k: keyof Privacy) => {
    if (!pv) return;
    const next = { ...pv, [k]: !pv[k] };
    setPv(next);
    setPv(await authed<Privacy>('customer', 'POST', '/customer/privacy', { [k]: next[k] }).catch(() => pv));
  };
  /** "Download my data": the file comes straight to the phone (phase-8.md, 8d). */
  const download = async () => {
    const d = await authed<object>('customer', 'GET', '/customer/export');
    const url = URL.createObjectURL(new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'joindebo-my-data.json'; a.click();
    URL.revokeObjectURL(url);
    setFlash(L('main.dataSaved'));
  };
  const confirmDelete = async () => {
    if (!/^\d{6}$/.test(pin)) return setErr(L('main.delErrorPin'));
    try { await authed('customer', 'POST', '/customer/account/delete', { pin }); setDel('done'); }
    catch { setErr(L('main.delWrongPin')); setPin(''); }
  };
  const header = (title: string, back: () => void) => (
    <div className={s.header}>
      <button type="button" className={s.iconBtn} aria-label={L('main.back')} onClick={back}><Icon d={BACK} size={24} /></button>
      <h1 className={s.title}>{title}</h1>
      <div style={{ width: 44, height: 44 }} />
    </div>
  );
  if (del) {
    return (
      <main className={`${s.screen} tc-fade`}>
        {header(L('main.deleteAccount'), () => (del === 'done' ? onGone() : setDel(null)))}
        <div className={s.histBody}>
          {del === 'form' ? (
            <>
              <h2 style={{ margin: '14px 0 0', fontSize: 18, fontWeight: 700, color: '#333' }}>{L('main.delTitle')}</h2>
              <p style={{ margin: '8px 0 0', fontSize: 14, lineHeight: '20px', color: '#555' }}>{L('main.delIntro')}</p>
              <ul style={{ margin: '8px 0 0', padding: 0, listStyle: 'none', fontSize: 14, lineHeight: '20px', color: '#444' }}>
                {['main.delItem1', 'main.delItem2', 'main.delItem3'].map((k) => <li key={k} style={{ display: 'flex', gap: 8, padding: '3px 0' }}><span aria-hidden="true">•</span>{L(k)}</li>)}
              </ul>
              <p style={{ margin: '12px 0 0', fontSize: 14, fontWeight: 700, color: '#b3261e' }}>{L('main.delNoUndo')}</p>
              <label htmlFor="delpin" className={s.setH} style={{ display: 'block' }}>{L('main.delPin')}</label>
              <input id="delpin" className="pin-input" type="password" inputMode="numeric" maxLength={6} autoComplete="off" value={pin} placeholder="••••••"
                onChange={(e) => { setPin(e.target.value.replace(/\D/g, '').slice(0, 6)); setErr(''); }}
                style={{ marginTop: 8, width: '100%', boxSizing: 'border-box', height: 52, padding: '0 14px', border: '1.5px solid #444', borderRadius: 10, fontSize: 18, letterSpacing: 6 }} />
              <p role="alert" style={{ margin: '8px 0 0', minHeight: 18, fontSize: 13, lineHeight: '18px', color: '#b3261e' }}>{err}</p>
              <button type="button" onClick={confirmDelete} style={{ marginTop: 8, width: '100%', height: 52, border: 0, borderRadius: 10, background: '#b3261e', color: '#fff', font: "700 14px 'Lato', 'Noto Sans Ethiopic', system-ui, sans-serif", cursor: 'pointer' }}>{L('main.delBtn')}</button>
              <button type="button" onClick={() => setDel(null)} style={{ marginTop: 8, width: '100%', height: 52, border: '1.5px solid #444', borderRadius: 10, background: 'none', color: '#444', font: "700 14px 'Lato', 'Noto Sans Ethiopic', system-ui, sans-serif", cursor: 'pointer' }}>{L('main.delCancel')}</button>
            </>
          ) : (
            <>
              <h2 style={{ margin: '16px 0 0', fontSize: 18, fontWeight: 700, color: '#333' }}>{L('main.delDoneTitle')}</h2>
              <p style={{ margin: '8px 0 0', fontSize: 14, lineHeight: '20px', color: '#555' }}>{L('main.delDoneText')}</p>
              <button type="button" onClick={onGone} style={{ marginTop: 22, width: '100%', height: 52, border: 0, borderRadius: 10, background: '#333', color: '#fff', font: "700 14px 'Lato', 'Noto Sans Ethiopic', system-ui, sans-serif", cursor: 'pointer' }}>{L('main.done')}</button>
            </>
          )}
        </div>
      </main>
    );
  }
  const rows: Array<[keyof Prefs, string, string]> = [['stamp', 'main.tStamp', 'main.tStampS'], ['near', 'main.tNear', 'main.tNearS'], ['exp', 'main.tExp', 'main.tExpS'], ['offer', 'main.tOffer', 'main.tOfferS']];
  return (
    <main className={`${s.screen} tc-fade`}>
      {header(L('main.settings'), onBack)}
      <div className={s.histBody}>
        <h3 className={s.setH}>{L('main.notificationsH')}</h3>
        <ul className={s.setList}>
          {rows.map(([k, label, sub]) => <Switch key={k} on={!!p?.[k]} label={L(label)} sub={L(sub)} onFlip={() => flip(k)} disabled={!p} />)}
        </ul>
        <p style={{ margin: '10px 0 0', fontSize: 13, lineHeight: '18px', color: '#595959' }}>{L('main.noticeNote')}</p>
        <h3 className={s.setH}>{L('main.privacy')}</h3>
        <ul className={s.setList}>
          <Switch on={!!pv?.share} label={L('main.pShare')} sub={L('main.pShareS')} onFlip={() => flipPv('share')} disabled={!pv} />
          <Switch on={!!pv?.pers} label={L('main.pPers')} sub={L('main.pPersS')} onFlip={() => flipPv('pers')} disabled={!pv} />
          <li className={s.setRow}>
            <button type="button" className={s.markAll} style={{ width: '100%', textAlign: 'left', textDecoration: 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }} onClick={download}>
              <span>{L('main.dlData')}</span><Icon d={CHEV} size={16} color="#595959" width={2} />
            </button>
          </li>
        </ul>
        {flash && <p role="status" style={{ margin: '8px 0 0', fontSize: 13, color: '#333' }}>{flash}</p>}
        <h3 className={s.setH}>{L('main.account')}</h3>
        <ul className={s.setList}>
          <li className={s.setRow}>
            <button type="button" className={s.markAll} style={{ width: '100%', textAlign: 'left', textDecoration: 'none', color: '#b3261e', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }} onClick={() => { setDel('form'); setPin(''); setErr(''); }}>
              <span>{L('main.deleteAccount')}</span><Icon d={CHEV} size={16} color="#b3261e" width={2} />
            </button>
          </li>
        </ul>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------- Business page (BusinessPage board)
interface Biz {
  name: string; category: string; city: string; color: string; logoUrl: string | null; stampsNeeded: number | null; rewardValidDays: number | null;
  rewards: Array<{ at: number; reward: string }>; branches: Array<{ name: string; address: string | null; hours: Record<string, string[][]> }>;
}
const WEEK = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const DAY_KEY = ['main.dayMon', 'main.dayTue', 'main.dayWed', 'main.dayThu', 'main.dayFri', 'main.daySat', 'main.daySun'];
const CAT_KEY: Record<string, string> = { cafe: 'owner.catFood', restaurant: 'owner.catFood', food: 'owner.catFood', bakery: 'owner.catFood', salon: 'owner.catSalon', barber: 'owner.catSalon', spa: 'owner.catSpa', car_wash: 'owner.catCar' };

/** Day of week (0 = Monday) and "HH:MM" now in East Africa Time. */
function eatNow(): { day: number; hm: string } {
  const d = new Date(Date.now() + 3 * 3_600_000);
  return { day: (d.getUTCDay() + 6) % 7, hm: d.toISOString().slice(11, 16) };
}
const openAt = (hours: Record<string, string[][]>, day: number, hm: string) => (hours[WEEK[day]] ?? []).some(([o, c]) => hm >= o && hm < c);
const maps = (q: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;

export function BusinessPage({ L, shopCode, onBack }: { L: Lfn; shopCode: string; onBack: () => void }) {
  const [b, setB] = useState<Biz | null>(null);
  useEffect(() => { authed<Biz>('customer', 'GET', `/shops/${shopCode}/details`).then(setB).catch(() => {}); }, [shopCode]);
  const now = eatNow();
  const main = b?.branches[0];
  const hasHours = !!main && Object.keys(main.hours).length > 0;
  const open = main ? openAt(main.hours, now.day, now.hm) : false;
  return (
    <main className={`${s.screen} tc-fade`}>
      <div className={s.header}>
        <button type="button" className={s.iconBtn} aria-label={L('main.back')} onClick={onBack}><Icon d={BACK} size={24} /></button>
        <h1 className={s.title}>{L('main.business')}</h1>
        <div style={{ width: 44, height: 44 }} />
      </div>
      {b && (
        <div className={s.histBody}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 6 }}>
            {b.logoUrl ? <img src={b.logoUrl} alt="" width={56} height={56} style={{ borderRadius: '50%' }} />
              : <div aria-hidden="true" style={{ width: 56, height: 56, borderRadius: '50%', background: b.color, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 20 }}>{b.name.slice(0, 2).toUpperCase()}</div>}
            <div style={{ minWidth: 0 }}>
              <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#333' }}>{b.name}</h2>
              <div style={{ marginTop: 4, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                {CAT_KEY[b.category] && <span style={{ padding: '2px 10px', borderRadius: 12, border: `1.5px solid ${b.color}`, fontSize: 13, color: '#333' }}>{L(CAT_KEY[b.category])}</span>}
                {hasHours && <span style={{ fontSize: 13, fontWeight: 700, color: open ? '#333' : '#595959' }}>{L(open ? 'main.openNow' : 'main.closedNow')}</span>}
              </div>
            </div>
          </div>
          {main?.address && (
            <a href={maps(`${main.address}, ${b.city}`)} target="_blank" rel="noopener noreferrer"
              style={{ marginTop: 16, minHeight: 48, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1.5px solid #444', borderRadius: 10, color: '#333', fontWeight: 700, fontSize: 14, textDecoration: 'none' }}>{L('main.directions')}</a>
          )}
          <h3 className={s.setH}>{L('main.address')}</h3>
          <ul className={s.setList}>
            <li className={s.setRow} style={{ fontSize: 14, color: '#333' }}>{[main?.address, b.city].filter(Boolean).join(', ')}</li>
          </ul>
          {hasHours && main && (
            <>
              <h3 className={s.setH}>{L('main.hours')}</h3>
              <ul className={s.setList}>
                {WEEK.map((d, i) => {
                  const slots = main.hours[d] ?? [];
                  return (
                    <li key={d} className={s.setRow} style={{ fontWeight: i === now.day ? 700 : 400, color: '#333', fontSize: 14 }}>
                      <span style={{ flex: 1 }}>{i === now.day ? `${L(DAY_KEY[i])} · ${L('main.today')}` : L(DAY_KEY[i])}</span>
                      <span>{slots.length ? slots.map(([o, c]) => `${o} – ${c}`).join(', ') : L('main.closed')}</span>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          {b.branches.length > 1 && (
            <>
              <h3 className={s.setH}>{L('main.branches')}</h3>
              <ul className={s.setList}>
                {b.branches.map((br) => (
                  <li key={br.name} className={s.setRow}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#333' }}>{br.name}</div>
                      <div style={{ marginTop: 2, fontSize: 13, color: '#595959' }}>{[br.address, Object.keys(br.hours).length ? L(openAt(br.hours, now.day, now.hm) ? 'main.openNow' : 'main.closedNow') : ''].filter(Boolean).join(' · ')}</div>
                    </div>
                    {br.address && <a href={maps(`${br.address}, ${b.city}`)} target="_blank" rel="noopener noreferrer" aria-label={`${L('main.directions')} · ${br.name}`} className={s.iconBtn}><Icon d={CHEV} size={18} color="#595959" width={2} /></a>}
                  </li>
                ))}
              </ul>
            </>
          )}
          <h3 className={s.setH}>{L('main.aboutCard')}</h3>
          <ul className={s.setList}>
            {b.rewards.map((r) => (
              <li key={r.at} className={s.setRow} style={{ fontSize: 14, color: '#333' }}>
                <span style={{ flex: 1 }}>{r.reward}</span><span style={{ color: '#595959' }}>{L('main.rewardAt', { a: r.at }, r.at)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </main>
  );
}
