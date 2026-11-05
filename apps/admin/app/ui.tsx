'use client';

import { Fragment, useCallback, useEffect, useState, type ReactNode } from 'react';
import { t, type MessageKey } from '@temelash/i18n';
import { ApiFailure, authed } from '@temelash/ui';
import s from './admin.module.css';

/**
 * The Admin board's building blocks (Head, Stats, Tool, Table, List, Kv,
 * Timeline, Note, Check, Input, Set, Bars, Cols), its dialog and pills.
 * Each page is a list of these, as on the board.
 */

/** Admin wording, English only (DECISIONS.md). */
export const A = (k: string, v?: Record<string, string | number>, n?: number) => t('en', `admin.${k}` as MessageKey, v, n);

export const RED = '#b3261e';
export const GREY = '#595959';
export const EAT = 'Africa/Addis_Ababa';

/** Status pills, as on the board: [text, colour, border]. */
const PILL: Record<string, [string, string, string]> = {
  active: ['pActive', '#333', '1.5px solid #bdbdbd'], trial: ['pTrial', '#444', '1.5px dashed #8a8a8a'], pending: ['pPending', '#333', '1.5px dashed #333'],
  paused: ['pPaused', RED, `1.5px solid ${RED}`], closing: ['pClosing', RED, `1.5px dashed ${RED}`], closed: ['pClosed', GREY, '1.5px solid #d0d0d0'],
  rejected: ['pRejected', GREY, '1.5px solid #d0d0d0'], cwaiting: ['pToCheck', '#333', '1.5px dashed #333'], capproved: ['pApproved', '#333', '1.5px solid #bdbdbd'], crejected: ['pNotAccepted', RED, `1.5px solid ${RED}`], pilot: ['pPilot', '#444', '1.5px solid #d0d0d0'], btrial: ['pTrial', '#444', '1.5px dashed #8a8a8a'],
  none: ['pNone', GREY, '1.5px solid #d0d0d0'], rnew: ['pNew', '#333', '1.5px solid #333'], rprogress: ['pProgress', '#444', '1.5px dashed #8a8a8a'],
  rdone: ['pDone', GREY, '1.5px solid #d0d0d0'], rdeclined: ['pDeclined', GREY, '1.5px solid #d0d0d0'], aon: ['pActive', '#333', '1.5px solid #bdbdbd'],
  toff: ['pOff', GREY, '1.5px solid #d0d0d0'], pson: ['pOn', '#333', '1.5px solid #bdbdbd'], killp: ['pPaused', RED, `1.5px solid ${RED}`],
  locked: ['pLocked', RED, `1.5px solid ${RED}`], cardpaused: ['pCardPaused', RED, `1.5px solid ${RED}`],
  paid: ['pPaid', '#333', '1.5px solid #bdbdbd'], partial: ['pPartial', '#444', '1.5px dashed #8a8a8a'], due: ['pDue', '#444', '1.5px dashed #8a8a8a'],
  overdue: ['pOverdue', RED, `1.5px solid ${RED}`], owed: ['pOwed', RED, `1.5px solid ${RED}`], apaid: ['pPaid', '#333', '1.5px solid #bdbdbd'],
  await: ['pAwait', '#444', '1.5px dashed #8a8a8a'], nofee: ['pNoFee', GREY, '1.5px solid #d0d0d0'], ghand: ['pHanded', '#333', '1.5px solid #bdbdbd'],
  gnot: ['pNotYet', RED, `1.5px solid ${RED}`], okst: ['pOk', '#333', '1.5px solid #bdbdbd'], lowst: ['pLow', RED, `1.5px solid ${RED}`], rev: ['pReversed', RED, `1.5px solid ${RED}`], fixd: ['pCorrected', '#444', '1.5px dashed #8a8a8a'], aoff: ['pInactive', GREY, '1.5px solid #d0d0d0'],
};

export function Pill({ k }: { k: string }) {
  const p = PILL[k] ?? PILL.none;
  return <span className={s.pill} style={{ color: p[1], border: p[2] }}>{A(p[0])}</span>;
}

// ---------------------------------------------------------------- dates (East Africa Time)
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function parts(d: string | Date) {
  const x = new Date(d);
  const [y, m, day] = x.toLocaleDateString('en-CA', { timeZone: EAT }).split('-').map(Number);
  return { y, m, day, time: x.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: EAT }) };
}
/** "30 Oct" */
export const fd = (d: string | Date) => { const p = parts(d); return `${p.day} ${MONTHS[p.m - 1]}`; };
/** "30 Oct 2026" */
export const fdy = (d: string | Date) => { const p = parts(d); return `${p.day} ${MONTHS[p.m - 1]} ${p.y}`; };
/** "14:05" */
export const ft = (d: string | Date) => parts(d).time;
/** Today, Yesterday, 3 days ago (East Africa Time). */
export function rel(d: string | Date | null): string {
  if (!d) return '—';
  const day = (x: Date) => Date.UTC(...(x.toLocaleDateString('en-CA', { timeZone: EAT }).split('-').map(Number) as [number, number, number]));
  const n = Math.round((day(new Date()) - day(new Date(d))) / 86_400_000);
  return n <= 0 ? A('today') : n === 1 ? A('yesterday') : A('daysAgo', { a: n });
}
export const birr = (n: number) => A('uBirr', { a: Math.round(n).toLocaleString('en-US') });
/** 19,000 */
export const num = (n: number) => Math.round(n).toLocaleString('en-US');

// ---------------------------------------------------------------- data
/** A signed-out or idle session anywhere: the shell shows the sign-in (or "You were signed out"). */
export function signal401(e: unknown) {
  if (e instanceof ApiFailure && e.status === 401) window.dispatchEvent(new CustomEvent('tc-admin-401', { detail: e.code }));
}

export function useLoad<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiFailure | null>(null);
  const reload = useCallback(() => {
    if (!path) return;
    authed<T>('admin', 'GET', path).then((d) => { setData(d); setError(null); }).catch((e) => { signal401(e); setError(e instanceof ApiFailure ? e : new ApiFailure(0, 'offline')); });
  }, [path]);
  useEffect(reload, [reload]);
  return { data, error, reload };
}

// ---------------------------------------------------------------- page frame
export interface Btn { t: string; go?: () => void; kind?: 'primary' | 'outline' | 'danger'; disabled?: boolean }
export function Button({ b }: { b: Btn }) {
  const cls = b.kind === 'primary' ? `${s.btn} ${s.btnPrimary}` : b.kind === 'danger' ? `${s.btn} ${s.btnDanger}` : s.btn;
  return <button type="button" className={cls} onClick={b.go} disabled={b.disabled || !b.go}>{b.t}</button>;
}

export function Page({ title, sub, crumbs, btns, showTitle = true, children }: { title: string; sub?: string; crumbs?: Array<{ t: string; go?: () => void }>; btns?: Btn[]; showTitle?: boolean; children: ReactNode }) {
  return (
    <>
      <div className={s.pageHead}>
        <div style={{ minWidth: 0 }}>
          {crumbs && crumbs.length > 0 && (
            <nav className={s.crumbs} aria-label="Breadcrumb">
              {crumbs.map((c, i) => (
                <Fragment key={i}>
                  {c.go ? <button type="button" className={s.crumbLink} onClick={c.go}>{c.t}</button> : <span className={s.crumbLast}>{c.t}</span>}
                  {i < crumbs.length - 1 && <span aria-hidden="true">›</span>}
                </Fragment>
              ))}
            </nav>
          )}
          {showTitle && <h1 className={s.h1}>{title}</h1>}
          {showTitle && sub && <div className={s.pSub}>{sub}</div>}
        </div>
        {btns && btns.length > 0 && <div className={s.btns}>{btns.map((b, i) => <Button key={i} b={b} />)}</div>}
      </div>
      <div className={s.blocks}>{children}</div>
    </>
  );
}

// ---------------------------------------------------------------- blocks
export function Head({ ini, title, sub, pill, tags, btns }: { ini: string; title: string; sub?: string; pill?: string; tags?: Array<{ t: string; go?: () => void }>; btns?: Btn[] }) {
  return (
    <div className={s.card}><div className={`${s.cardIn} ${s.head}`}>
      <div aria-hidden="true" className={s.headIni}>{ini}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <h2 className={s.headTitle}>{title}</h2>
          {pill && <Pill k={pill} />}
        </div>
        {sub && <div className={s.headSub}>{sub}</div>}
        {tags && tags.length > 0 && (
          <div className={s.tags}>{tags.map((g, i) => <button key={i} type="button" className={`${s.tag} ${g.go ? s.tagLive : ''}`} onClick={g.go} disabled={!g.go}>{g.t}</button>)}</div>
        )}
      </div>
      {btns && btns.length > 0 && <div className={s.btns}>{btns.map((b, i) => <Button key={i} b={b} />)}</div>}
    </div></div>
  );
}

export interface Stat { v: string; l: string; s?: string; sc?: string; go?: () => void }
export function Stats({ cols, items }: { cols: number; items: Stat[] }) {
  return (
    <div className={s.stats} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {items.map((it, i) => (
        <button key={i} type="button" className={`${s.stat} ${it.go ? s.statLive : ''}`} onClick={it.go} disabled={!it.go} style={{ color: 'inherit' }}>
          <div className={s.statIn}>
            <div className={s.statV} style={{ fontSize: cols >= 6 ? 21 : 26 }}>{it.v}</div>
            <div className={s.statL}>{it.l}</div>
            <div className={s.statS} style={{ color: it.sc ?? GREY }}>{it.s ?? ''}</div>
          </div>
        </button>
      ))}
    </div>
  );
}

export interface Chips { label?: string; opts: Array<{ v: string; l: string }>; cur: string; pick: (v: string) => void }
export function ChipRow({ c }: { c: Chips }) {
  return (
    <div className={s.chips}>
      {c.label && <span className={s.chipsLbl}>{c.label}</span>}
      {c.opts.map((o) => <button key={o.v} type="button" className={s.chip} aria-pressed={c.cur === o.v} onClick={() => c.pick(o.v)}>{o.l}</button>)}
    </div>
  );
}

const SEARCH = 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3';
export function SearchIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ position: 'absolute', left: 12, top: 11 }}><path d={SEARCH} /></svg>;
}

export function Tool({ search, groups }: { search?: { value: string; onChange: (v: string) => void; ph: string }; groups: Chips[] }) {
  return (
    <div className={s.card}><div className={`${s.cardIn} ${s.tool}`}>
      {search && (
        <div style={{ position: 'relative' }}>
          <SearchIcon />
          <input type="text" className={s.toolInput} value={search.value} onChange={(e) => search.onChange(e.target.value)} placeholder={search.ph} aria-label={search.ph} />
        </div>
      )}
      {groups.map((g, i) => <ChipRow key={i} c={g} />)}
    </div></div>
  );
}

export interface Cell { t?: string; s?: string; b?: boolean; right?: boolean; c?: string; pill?: string }
export function Table({ title, cols, heads, rows, empty, more, foot }: {
  title?: string; cols: string; heads: Array<{ h: string; right?: boolean }>; rows: Array<{ go?: () => void; cells: Cell[] }>;
  empty?: string; more?: { t: string; go: () => void } | null; foot?: string;
}) {
  return (
    <div className={s.card}><div className={`${s.cardIn} ${s.table}`}>
      {title && <div className={`${s.blkTitle} ${s.tableTitle}`}>{title}</div>}
      <div className={s.thead} style={{ gridTemplateColumns: cols }} role="row">
        {heads.map((h, i) => <div key={i} role="columnheader" style={{ display: 'flex', justifyContent: h.right ? 'flex-end' : 'flex-start', paddingRight: h.right ? 24 : 8 }}>{h.h}</div>)}
      </div>
      {rows.map((r, i) => (
        <div key={i} role="row" tabIndex={r.go ? 0 : -1} className={`${s.trow} ${r.go ? s.trowLive : ''}`} style={{ gridTemplateColumns: cols }}
          onClick={r.go} onKeyDown={(e) => { if (r.go && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); r.go(); } }}>
          {r.cells.map((c, j) => (
            <div key={j} role="cell" className={`${s.cell} ${c.right ? s.cellRight : ''}`}>
              {c.pill ? <span><Pill k={c.pill} /></span> : <span className={s.cellT} style={{ fontWeight: c.b ? 700 : 400, color: c.c ?? '#333' }}>{c.t ?? ''}</span>}
              {c.s && <span className={s.cellS}>{c.s}</span>}
            </div>
          ))}
        </div>
      ))}
      {rows.length === 0 && empty && <div className={s.tEmpty}>{empty}</div>}
      {more && <div className={s.tMore}><button type="button" className={s.btn} onClick={more.go}>{more.t}</button></div>}
      {foot && <div className={s.tFoot}>{foot}</div>}
    </div></div>
  );
}

export interface Row { t: string; s?: string; go?: () => void; r?: string; rc?: string; pill?: string; sc?: string; sub?: string; dim?: boolean; on?: boolean }
export function List({ title, rows, empty, more }: { title?: string; rows: Row[]; empty?: string; more?: { t: string; go: () => void } }) {
  return (
    <div className={s.card}><div className={`${s.cardIn} ${s.list}`}>
      {title && <div className={`${s.blkTitle} ${s.listTitle}`}>{title}</div>}
      {rows.map((r, i) => (
        <button key={i} type="button" className={`${s.lrow} ${r.go ? s.lrowLive : ''} ${r.on ? s.lrowOn : ''}`} onClick={r.go} disabled={!r.go && !r.on} aria-pressed={r.on} style={{ opacity: r.dim ? 0.45 : 1, color: 'inherit' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className={s.lT} style={{ color: r.sc ?? '#333' }}>{r.t}</div>
            {r.s && <div className={s.lS} style={{ color: r.rc ?? GREY }}>{r.s}</div>}
          </div>
          {r.r && <span className={s.lR} style={{ color: r.rc ?? GREY }}>{r.r}</span>}
          {r.pill && <Pill k={r.pill} />}
          {r.go && <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: 'none' }}><path d="M9 6l6 6-6 6" /></svg>}
        </button>
      ))}
      {rows.length === 0 && empty && <div className={s.lEmpty}>{empty}</div>}
      {more && <div className={s.lMore}><button type="button" className={s.lMoreBtn} onClick={more.go}>{more.t} ›</button></div>}
    </div></div>
  );
}

export function Kv({ title, rows }: { title?: string; rows: Array<{ k: string; v: string }> }) {
  return (
    <div className={s.card}><div className={`${s.cardIn} ${s.kv}`}>
      {title && <div className={`${s.blkTitle} ${s.listTitle}`}>{title}</div>}
      {rows.map((r, i) => <div key={i} className={s.kvRow}><span className={s.kvK}>{r.k}</span><span className={s.kvV}>{r.v}</span></div>)}
    </div></div>
  );
}

export function Timeline({ title, rows, empty }: { title?: string; rows: Array<{ t: string; s?: string; w: string }>; empty?: string }) {
  return (
    <div className={s.card}><div className={`${s.cardIn} ${s.tl}`}>
      {title && <div className={s.blkTitle} style={{ paddingBottom: 6 }}>{title}</div>}
      {rows.map((r, i) => (
        <div key={i} className={s.tlRow}>
          <span aria-hidden="true" className={s.tlDot} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className={s.tlT}>{r.t}</div>
            {r.s && <div className={s.tlS}>{r.s}</div>}
            <div className={s.tlW}>{r.w}</div>
          </div>
        </div>
      ))}
      {rows.length === 0 && empty && <div className={s.lEmpty} style={{ paddingBottom: 12 }}>{empty}</div>}
    </div></div>
  );
}

export function Note({ t: text, tone = 'grey' }: { t: string; tone?: 'grey' | 'red' | 'dark' | 'solid' }) {
  const st = { grey: ['1.5px dashed #b5b5b5', '#555'], red: [`1.5px dashed ${RED}`, RED], dark: ['1.5px dashed #333', '#333'], solid: ['1.5px solid #d0d0d0', '#555'] }[tone];
  return <div className={s.note} style={{ border: st[0], color: st[1] }}>{text}</div>;
}

const TICK = 'M5 12.5l4.5 4.5L19 7.5';
export function CheckMark() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={TICK} /></svg>;
}

export function Check({ title, rows, note }: { title: string; rows: Array<{ t: string; on: boolean; go: () => void }>; note: string }) {
  return (
    <div className={s.card}><div className={`${s.cardIn} ${s.check}`}>
      <div className={`${s.blkTitle} ${s.listTitle}`}>{title}</div>
      {rows.map((r, i) => (
        <button key={i} type="button" role="checkbox" aria-checked={r.on} className={s.checkRow} onClick={r.go}>
          <span className={`${s.box} ${r.on ? s.boxOn : ''}`}>{r.on && <CheckMark />}</span>
          <span className={s.checkT}>{r.t}</span>
        </button>
      ))}
      <div className={s.checkNote}>{note}</div>
    </div></div>
  );
}

export function Input({ title, ph, onAdd, btn }: { title: string; ph: string; btn: string; onAdd: (text: string) => Promise<void> }) {
  const [v, setV] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (!v.trim() || busy) return;
    setBusy(true);
    try { await onAdd(v.trim()); setV(''); } finally { setBusy(false); }
  };
  return (
    <div className={s.card}><div className={`${s.cardIn} ${s.inp}`}>
      <div className={s.blkTitle}>{title}</div>
      <div className={s.inpRow}>
        <input type="text" className={s.inpInput} value={v} onChange={(e) => setV(e.target.value)} placeholder={ph} aria-label={title} onKeyDown={(e) => { if (e.key === 'Enter') go(); }} />
        <button type="button" className={`${s.btn} ${s.btnPrimary}`} onClick={go} disabled={!v.trim() || busy}>{btn}</button>
      </div>
    </div></div>
  );
}

export function SetBlock({ title, rows }: { title: string; rows: Array<{ t: string; s?: string; v: string; dec?: () => void; inc?: () => void }> }) {
  return (
    <div className={s.card}><div className={`${s.cardIn} ${s.set}`}>
      <div className={`${s.blkTitle} ${s.listTitle}`}>{title}</div>
      {rows.map((r, i) => (
        <div key={i} className={s.setRow}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className={s.setT}>{r.t}</div>
            {r.s && <div className={s.setS}>{r.s}</div>}
          </div>
          <button type="button" aria-label={A('less')} className={s.setBtn} onClick={r.dec} disabled={!r.dec}>−</button>
          <span className={s.setV}>{r.v}</span>
          <button type="button" aria-label={A('more')} className={s.setBtn} onClick={r.inc} disabled={!r.inc}>+</button>
        </div>
      ))}
    </div></div>
  );
}

export function Bars({ title, sub, bars, note }: { title: string; sub?: string; bars: Array<{ l: string; v: number; on?: boolean }>; note?: string }) {
  const mx = Math.max(1, ...bars.map((b) => b.v));
  return (
    <div className={s.card}><div className={`${s.cardIn} ${s.bars}`}>
      <div className={s.blkTitle}>{title}</div>
      {sub && <div className={s.barsSub}>{sub}</div>}
      <div className={s.barsRow}>
        {bars.map((b, i) => (
          <div key={i} className={s.barCol}>
            <span className={s.barV}>{b.v}</span>
            <div className={s.bar} style={{ height: Math.round(8 + (b.v / mx) * 72), background: b.on ? '#333' : '#bdbdbd' }} />
          </div>
        ))}
      </div>
      <div className={s.barLbls}>{bars.map((b, i) => <span key={i} className={s.barLbl}>{b.l}</span>)}</div>
      {note && <div className={s.barsNote}>{note}</div>}
    </div></div>
  );
}

export function Cols({ lw, rw, left, right }: { lw: string; rw: string; left: ReactNode; right: ReactNode }) {
  return (
    <div className={s.cols} style={{ gridTemplateColumns: `${lw} ${rw}` }}>
      <div className={s.col}>{left}</div>
      <div className={s.col}>{right}</div>
    </div>
  );
}

// ---------------------------------------------------------------- dialog
export interface ModalSpec {
  title: string;
  sub?: string;
  /** Lines under the title; a function re-reads them as the person types (password rules). */
  list?: string[] | ((f: Record<string, string>) => string[]);
  /** Inputs shown before the choices (a search box). */
  pre?: Array<{ label: string; key: string; ph?: string }>;
  /** Choices; `filterBy` narrows them by an input, `when` shows them only for some answers. */
  groups?: Array<{ label: string; key: string; opts: Array<{ v: string; l: string }>; initial?: string; filterBy?: string; when?: (f: Record<string, string>) => boolean;
    /** Picking an option fills other fields ("Start from" a template). */
    fills?: Record<string, Record<string, string>> }>;
  inputs?: Array<{ label: string; key: string; ph?: string; tall?: boolean; type?: string; initial?: string; when?: (f: Record<string, string>) => boolean }>;
  note?: string;
  ok: string;
  danger?: boolean;
  /** Can the OK button be pressed with these values? */
  need?: (f: Record<string, string>) => boolean;
  /** Do it; throw to keep the dialog open (the message is shown). */
  go: (f: Record<string, string>) => Promise<void>;
  noCancel?: boolean;
}

export function Modal({ spec, onClose }: { spec: ModalSpec; onClose: () => void }) {
  const [f, setF] = useState<Record<string, string>>(() => Object.fromEntries([...(spec.inputs ?? []), ...(spec.groups ?? [])].filter((i) => i.initial).map((i) => [i.key, i.initial!])));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));
  const can = !busy && (spec.need ? spec.need(f) : true);
  const list = typeof spec.list === 'function' ? spec.list(f) : spec.list;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const ok = async () => {
    if (!can) return;
    setBusy(true);
    setErr('');
    try { await spec.go(f); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const okCls = spec.danger ? `${s.btn} ${s.btnDanger}` : `${s.btn} ${s.btnPrimary}`;
  return (
    <div className={s.backdrop} onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={spec.title} className={s.modal} onClick={(e) => e.stopPropagation()}>
        <h2 className={s.mTitle}>{spec.title}</h2>
        {spec.sub && <div className={s.mSub}>{spec.sub}</div>}
        {list && list.length > 0 && <div className={s.mList}>{list.map((li, i) => <div key={i} className={s.mListItem}>{li}</div>)}</div>}
        {(spec.pre ?? []).map((i) => (
          <div key={i.key} className={s.mGroup}>
            <label className={s.mLabel} style={{ marginBottom: 6 }} htmlFor={`m_${i.key}`}>{i.label}</label>
            <input id={`m_${i.key}`} type="text" className={s.mInput} value={f[i.key] ?? ''} placeholder={i.ph} autoComplete="off" onChange={(e) => set(i.key, e.target.value)} />
          </div>
        ))}
        {(spec.groups ?? []).filter((g) => !g.when || g.when(f)).map((g) => (
          <div key={g.key} className={s.mGroup}>
            <div className={s.mLabel}>{g.label}</div>
            <div className={s.chips}>{g.opts.filter((o) => !g.filterBy || !f[g.filterBy] || o.l.toLowerCase().includes(f[g.filterBy].toLowerCase())).slice(0, 12).map((o) => <button key={o.v} type="button" className={s.chip} aria-pressed={f[g.key] === o.v} onClick={() => { set(g.key, o.v); const fill = g.fills?.[o.v]; if (fill) setF((x) => ({ ...x, ...fill })); }}>{o.l}</button>)}</div>
          </div>
        ))}
        {(spec.inputs ?? []).filter((i) => !i.when || i.when(f)).map((i) => (
          <div key={i.key} className={s.mGroup}>
            <label className={s.mLabel} style={{ marginBottom: 6 }} htmlFor={`m_${i.key}`}>{i.label}</label>
            {i.tall
              ? <textarea id={`m_${i.key}`} rows={4} className={s.mInput} value={f[i.key] ?? ''} placeholder={i.ph} onChange={(e) => set(i.key, e.target.value)} />
              : <input id={`m_${i.key}`} type={i.type ?? 'text'} className={s.mInput} value={f[i.key] ?? ''} placeholder={i.ph} autoComplete="off" onChange={(e) => set(i.key, e.target.value)} />}
          </div>
        ))}
        {spec.note && <div className={s.mNote}>{spec.note}</div>}
        {err && <div role="alert" className={s.mErr}>{err}</div>}
        <div className={s.mBtns}>
          {!spec.noCancel && <button type="button" className={s.btn} onClick={onClose}>{A('cancel')}</button>}
          <button type="button" className={okCls} onClick={ok} disabled={!can}>{spec.ok}</button>
        </div>
      </div>
    </div>
  );
}

/** What the screens share: open a dialog, show a toast, move between pages. */
export interface Ctx {
  me: { id: string; name: string; email: string; role: 'owner' | 'finance' | 'support'; lastLoginAt: string | null; backupCodesLeft: number };
  open: (m: ModalSpec) => void;
  close: () => void;
  toast: (t: string) => void;
  nav: (v: View) => void;
  /** Refresh counts shown outside the page (sidebar badge, kill banner). */
  refresh: () => void;
}

export type View =
  | { v: 'overview' }
  | { v: 'businesses' }
  | { v: 'business'; id: string; tab?: 'overview' | 'people' | 'customers' | 'finance' | 'support' | 'history'; card?: string }
  | { v: 'finance' }
  | { v: 'report' }
  | { v: 'receipt'; id: string }
  | { v: 'claims'; status?: 'waiting' | 'approved' | 'rejected' }
  | { v: 'claim'; id: string }
  | { v: 'agents'; owed?: boolean }
  | { v: 'agent'; id: string }
  | { v: 'statement'; id: string }
  | { v: 'leaderboard' }
  | { v: 'messages' }
  | { v: 'stands'; tab?: 'prod' | 'price' | 'stock' }
  | { v: 'audience' }
  | { v: 'requests'; id?: string; type?: string }
  | { v: 'audit' }
  | { v: 'settings'; tab?: 'rules' | 'team' | 'safety' | 'account' };

/** An API refusal as a sentence for a dialog. */
export function failText(e: unknown): string {
  if (e instanceof ApiFailure) {
    if (e.code === 'two_owners_needed') return A('keepTwo');
    if (e.code === 'email_in_use') return A('emailUsed');
    if (e.code === 'wrong_login' || e.code === 'wrong_code') {
      const left = Number((e.body as { triesLeft?: number }).triesLeft);
      return Number.isFinite(left) ? `${A('wrong')} ${A('triesLeft', { a: left }, left)}` : A('wrong');
    }
    if (e.code === 'locked') return A('lockedTitle');
  }
  return A('couldNotLoad');
}

/** Numbered steps (AdminReqStand): done and current ones filled. */
export function Steps({ steps, at }: { steps: string[]; at: number }) {
  return (
    <div className={s.card}>
      <ol style={{ margin: 0, background: '#fff', borderRadius: 14, padding: '16px 18px', display: 'flex', gap: 6, listStyle: 'none' }} aria-label={A('stepsAria')}>
        {steps.map((l, i) => (
          <li key={l} aria-current={i === at ? 'step' : undefined} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 30, height: 30, boxSizing: 'border-box', borderRadius: '50%', background: i <= at ? '#333' : '#fff', color: i <= at ? '#fff' : '#555', border: i <= at ? '1.5px solid #333' : '1.5px solid #bdbdbd', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700 }}>{i + 1}</span>
            <span style={{ fontSize: 12, lineHeight: '16px', color: '#444', textAlign: 'center' }}>{l}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
