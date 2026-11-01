'use client';

import { useEffect, useState } from 'react';
import { authed } from '@temelash/ui';
import s from './wallet.module.css';

/**
 * Main board, the wallet's menu panel (who is signed in, Sign out, History)
 * and the History screen (stamps and rewards by month, filtered).
 * Notifications and Settings join the menu with their own phases (6 and 9).
 */

type Lfn = (k: string, v?: Record<string, string | number>, n?: number) => string;

const X = 'M6 6l12 12M18 6L6 18';
const OUT = 'M15 4h4v16h-4M10 16l4-4-4-4M14 12H4';
const HIST = 'M3 12a9 9 0 1 0 3-6.7M3 4v5h5M12 7v5l3 2';
const CHEV = 'M9 6l6 6-6 6';
const BACK = 'M15 6l-6 6 6 6';
const USER = 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4 4-6 8-6s8 2 8 6';
const EAT = 'Africa/Addis_Ababa';

function Icon({ d, size = 22, color = '#333', width = 1.6 }: { d: string; size?: number; color?: string; width?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;
}

export function CustomerMenu({ L, onClose, onSignOut, onHistory }: { L: Lfn; onClose: () => void; onSignOut: () => void; onHistory: () => void }) {
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
          <button type="button" className={s.menuItem} onClick={onHistory}>
            <Icon d={HIST} color="#444" width={1.7} />
            <span style={{ flex: 1, minWidth: 0 }}>{L('main.history')}</span>
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
