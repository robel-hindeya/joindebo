'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { authed } from '@temelash/ui';
import s from './app.module.css';

/** Pieces shared by the owner screens: icons, rows and loading. */

/** "+251 91 200 5566", as the boards write numbers. */
export const showPhone = (p: string) => (/^\+2519\d{8}$/.test(p) ? `+251 ${p.slice(4, 6)} ${p.slice(6, 9)} ${p.slice(9)}` : p);

export type Lfn = (k: string, v?: Record<string, string | number>, n?: number) => string;

export const IC = {
  home: 'M4 11l8-7 8 7v9H4zM10 20v-6h4v6', users: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21c0-4 3-6 7-6s7 2 7 6',
  userplus: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21c0-4 3-6 7-6s7 2 7 6M19 8v6M16 11h6', store: 'M4 10l1-5h14l1 5M5 10v10h14V10M4 10h16M9 20v-5h6v5',
  menu: 'M4 7h16M4 12h16M4 17h16', back: 'M15 6l-6 6 6 6', chev: 'M9 6l6 6-6 6', check: 'M5 12.5l4.5 4.5L19 7.5', hand: 'M8 13V5a1.5 1.5 0 0 1 3 0v6M11 11V4a1.5 1.5 0 0 1 3 0v7M14 11V5.5a1.5 1.5 0 0 1 3 0V14a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-3l-2-4a1.5 1.5 0 0 1 2.5-1.5L8 13',
  lock: 'M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3', clock: 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0', x: 'M6 6l12 12M18 6L6 18',
  out: 'M15 4h4v16h-4M10 16l4-4-4-4M14 12H4', card: 'M3 6h18v12H3zM3 10h18M7 15h4', mega: 'M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1zM15 9a4 4 0 0 1 0 6M18 6a8 8 0 0 1 0 12', info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v6M12 7.5h.01', chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2', log: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
};

export function Icon({ d, size = 22, color = '#333' }: { d: string; size?: number; color?: string }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;
}

/** GET with reload; errors show as an empty state rather than a blank page. */
export function useLoad<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState(false);
  const reload = useCallback(() => {
    if (!path) return;
    authed<T>('owner', 'GET', path).then((d) => { setData(d); setError(false); }).catch(() => setError(true));
  }, [path]);
  useEffect(reload, [reload]);
  return { data, error, reload };
}

export function Row({ icon, title, sub, onClick, right }: { icon?: string; title: string; sub?: string; onClick?: () => void; right?: ReactNode }) {
  const inner = (
    <span className={s.row}>
      {icon && <span className={s.rowIcon}><Icon d={icon} size={20} color="#444" /></span>}
      <span className={s.rowMain}><span className={s.rowTitle}>{title}</span>{sub && <span className={s.rowSub}>{sub}</span>}</span>
      {right ?? (onClick && <Icon d={IC.chev} size={18} color="#595959" />)}
    </span>
  );
  return <li>{onClick ? <button type="button" className={s.rowBtn} onClick={onClick}>{inner}</button> : inner}</li>;
}
