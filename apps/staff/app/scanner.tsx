'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { t, type Lang, type MessageKey } from '@temelash/i18n';
import { ApiFailure, authed } from '@temelash/ui';
import { Camera } from './camera';
import s from './scanner.module.css';

/**
 * Staff board, signed in: StaffScan (camera), StaffManual (type a code or
 * phone), StaffFound (stamp or reward), StaffAdded / StaffQueued / StaffLimit,
 * the refusal boards (duplicate, bad code, wrong shop, no card, paused, reward
 * used / expired / needs connection), StaffCamera and StaffRecent.
 * Stamps taken without a connection wait on this phone and are sent in order.
 */

interface Me { name: string; businessName: string; branchName: string }
interface StampPreview {
  kind: 'stamp';
  cardId: string;
  customer: string | null;
  count: number;
  total: number;
  nextReward: string | null;
  typed: boolean;
  stampedToday: boolean;
  stampedAt: string | null;
  stampedBy: string | null;
  limit: { used: number; max: number; near: boolean; over: boolean } | null;
}
interface RewardPreview { kind: 'reward'; reward: string; earnedWith: number | null; status: string; expiresAt: string }
type Found = { code: string; preview: StampPreview | RewardPreview };
type Done = { title: string; sub: string; reward?: string | null; queued?: boolean; pending?: boolean };
type Refused = { title: string; text: string };
interface Queued { code: string; scannedAt: string; idempotencyKey: string }

const QUEUE = 'tc_staff_queue';
const TICK = 'M5 12.5l4.5 4.5L19 7.5';
const CROSS = 'M6 6l12 12M18 6L6 18';
const GIFT = 'M4 10h16v10H4zM3 10h18M12 10v10M12 10C9.5 5.5 6 6.5 7.5 9M12 10c2.5-4.5 6-3.5 4.5-1';

function Icon({ d, size = 24, color = '#333', width = 1.8 }: { d: string; size?: number; color?: string; width?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}
const readQueue = (): Queued[] => {
  try {
    return JSON.parse(localStorage.getItem(QUEUE) ?? '[]') as Queued[];
  } catch {
    return [];
  }
};
const writeQueue = (q: Queued[]) => {
  try {
    localStorage.setItem(QUEUE, JSON.stringify(q));
  } catch {
    /* storage blocked: the stamp stays in memory until the page closes */
  }
};
// Times and dates always in East Africa Time (build plan, ground rule 5).
const EAT = 'Africa/Addis_Ababa';
const hhmm = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: EAT }) : '');
const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { timeZone: EAT });
const sentence = (name: unknown) => { const n = String(name ?? '').trim(); return n.endsWith('.') ? n : n + '.'; };

export function Scanner({ lang, me, onSignOut }: { lang: Lang; me: Me; onSignOut: () => void }) {
  const L = useCallback((k: string, v?: Record<string, string | number>, n?: number) => t(lang, k as MessageKey, v, n), [lang]);
  const [tab, setTab] = useState<'scan' | 'recent'>('scan');
  const [view, setView] = useState<'scan' | 'manual' | 'camera' | 'found' | 'done' | 'refused'>('scan');
  const [found, setFound] = useState<Found | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [refused, setRefused] = useState<Refused | null>(null);
  const [manual, setManual] = useState('');
  const [manualErr, setManualErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(true);
  const [queue, setQueue] = useState<Queued[]>([]);
  const [recent, setRecent] = useState<{ hour: { used: number; max: number | null }; items: Array<{ type: string; at: string; by_hand: boolean; pending: boolean; reward: string | null }> } | null>(null);
  const lastScan = useRef({ text: '', at: 0 });

  // ---------------------------------------------------------------- offline queue
  const flush = useCallback(async () => {
    let q = readQueue();
    while (q.length) {
      try {
        await authed('staff', 'POST', '/staff/stamps', q[0]);
      } catch (e) {
        // No connection, or Temelash paused stamping: keep the rest for later. Refused otherwise: drop it (it was decided).
        if (!(e instanceof ApiFailure) || e.status === 0 || e.status === 503) break;
      }
      q = q.slice(1);
      writeQueue(q);
      setQueue(q);
    }
  }, []);

  useEffect(() => {
    setQueue(readQueue());
    setOnline(navigator.onLine);
    const up = () => {
      setOnline(true);
      flush();
    };
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    flush();
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, [flush]);

  useEffect(() => {
    if (tab === 'recent') authed<typeof recent>('staff', 'GET', '/staff/recent').then(setRecent).catch(() => {});
  }, [tab, view]);

  // ---------------------------------------------------------------- refusals
  const refuse = (e: unknown, kind: 'stamp' | 'reward') => {
    const b = e instanceof ApiFailure ? e.body : {};
    const code = e instanceof ApiFailure ? e.code : 'offline';
    const map: Record<string, Refused> = {
      duplicate: { title: L('staff.dupTitle'), text: L('staff.dupText', { a: hhmm(String(b.at ?? '')), b: sentence(b.by) }) },
      bad_code: { title: L('staff.badTitle'), text: L('staff.badText') },
      wrong_shop: { title: L('staff.wrongTitle'), text: L('staff.wrongText', { a: String(b.otherShop ?? ''), b: String(b.thisShop ?? me.businessName) }) },
      no_card: { title: L('staff.nocardTitle'), text: L('staff.nocardText', { a: manual || '—', b: me.businessName }) },
      card_paused: { title: L('staff.pausedTitle'), text: L('staff.pausedText') },
      paused_by_temelash: { title: L('staff.killTitle'), text: String(b.message ?? '') },
      business_paused: { title: L('staff.bizPausedTitle'), text: L('staff.bizPausedText') },
      card_redeemed: { title: L('main.redeemedTitle'), text: L('main.redeemedText') },
      card_expired: { title: L('main.expiredTitle'), text: '' },
      reward_used: { title: L('staff.usedTitle'), text: L('staff.usedText', { a: hhmm(String(b.at ?? '')), b: sentence(b.by) }) },
      reward_expired: { title: L('staff.rexpTitle'), text: L('main.statusExpired', { a: day(String(b.expiredAt ?? new Date().toISOString())) }) },
      offline: kind === 'reward' ? { title: L('staff.rnetTitle'), text: L('staff.rnetText') } : { title: L('staff.badTitle'), text: L('common.offline') },
    };
    setRefused(map[code] ?? map.bad_code);
    setView('refused');
  };

  // ---------------------------------------------------------------- scan → found
  const lookUp = async (code: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const preview = await authed<StampPreview | RewardPreview>('staff', 'POST', '/staff/scan', { code });
      setFound({ code, preview });
      setView('found');
    } catch (e) {
      if (e instanceof ApiFailure && e.status === 0 && !/^TCR:|^[A-Z2-7]{8}$/i.test(code.trim())) {
        // Offline: stamps are saved on this phone and sent later; rewards need the connection.
        const item: Queued = { code, scannedAt: new Date().toISOString(), idempotencyKey: crypto.randomUUID() };
        const q = [...readQueue(), item];
        writeQueue(q);
        setQueue(q);
        setDone({ title: L('staff.queuedTitle'), sub: '', queued: true });
        setView('done');
      } else {
        refuse(e, /^TCR:|^[A-Z2-7]{8}$/i.test(code.trim()) ? 'reward' : 'stamp');
      }
    } finally {
      setBusy(false);
    }
  };

  // The camera keeps one callback; it always calls the current lookUp through this ref.
  const lookUpRef = useRef(lookUp);
  lookUpRef.current = lookUp;
  const onCamera = useCallback((text: string) => {
    const now = Date.now();
    // The same code stays in view for a while: read it once.
    if (text === lastScan.current.text && now - lastScan.current.at < 4000) return;
    lastScan.current = { text, at: now };
    lookUpRef.current(text);
  }, []);

  const onDenied = useCallback(() => setView('camera'), []);

  const confirm = async () => {
    if (!found || busy) return;
    setBusy(true);
    try {
      if (found.preview.kind === 'stamp') {
        const r = await authed<{ count: number; total: number; pending: boolean; rewardUnlocked: string | null }>('staff', 'POST', '/staff/stamps', {
          code: found.code,
          idempotencyKey: crypto.randomUUID(),
        });
        setDone(r.pending
          ? { title: L('staff.limitDoneTitle'), sub: L('staff.limitDoneSub', { a: found.preview.limit?.max ?? '' }), pending: true }
          : { title: L('staff.addedTitle'), sub: L('staff.addedSub', { a: r.count, b: r.total }), reward: r.rewardUnlocked });
      } else {
        await authed('staff', 'POST', '/staff/rewards/confirm', { code: found.code });
        setDone({ title: L('staff.rdDoneTitle'), sub: L('staff.rdDoneSub', { a: found.preview.reward }) });
      }
      setView('done');
    } catch (e) {
      refuse(e, found.preview.kind);
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setFound(null);
    setDone(null);
    setRefused(null);
    setManual('');
    setManualErr('');
    setView('scan');
  };

  // ---------------------------------------------------------------- views
  const p = found?.preview;
  const body = (() => {
    if (tab === 'recent') {
      const max = recent?.hour.max ?? null;
      return (
        <>
          <h1 className={s.h1}>{L('staff.recentTitle')}</h1>
          {max && recent && (
            <div className={s.card} style={{ padding: '14px 16px' }}>
              <div className={s.row}><span className={s.k}>{L('staff.hourLbl')}</span><span className={s.v}>{L('staff.hourOf', { a: recent.hour.used, b: max })}</span></div>
              <div className={s.hourBar}><div className={s.hourFill} style={{ width: `${Math.min(100, (recent.hour.used / max) * 100)}%` }} /></div>
              <div className={s.note} style={{ marginTop: 8 }}>{L('staff.limitCap')}</div>
            </div>
          )}
          <ul className={s.recent}>
            {(recent?.items ?? []).map((r, i) => (
              <li key={i}>
                <span className={s.recentIcon}><Icon d={r.type === 'reward' ? GIFT : TICK} size={20} color="#444" /></span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span className={s.name} style={{ fontSize: 14 }}>{r.type === 'reward' ? `${L('staff.rewardLine')}: ${r.reward ?? ''}` : L('staff.stampLine')}</span>
                  <span className={s.sub}>{hhmm(r.at)}{r.by_hand ? ` · ${L('staff.byHand')}` : ''}{r.pending ? ` · ${L('staff.needsApproval')}` : ''}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className={s.note}>{L('staff.recentNote')}</p>
        </>
      );
    }
    if (view === 'manual') {
      return (
        <div className="tc-panel-work">
          <h1 className={s.h1}>{L('staff.mnTitle')}</h1>
          <p className={s.p}>{L('staff.mnHelp')}</p>
          <label htmlFor="mn" className={s.label}>{L('staff.mnLbl')}</label>
          <input id="mn" className={s.input} value={manual} maxLength={16} autoComplete="off" autoCapitalize="characters"
            onChange={(e) => setManual(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (manual.trim().length >= 6 ? lookUp(manual) : setManualErr(L('staff.mnErr')))} />
          <p role="alert" className={s.alert}>{manualErr}</p>
          <button type="button" className={s.ctaSmall} style={{ marginTop: 8 }} aria-busy={busy}
            onClick={() => (manual.trim().length >= 6 ? lookUp(manual) : setManualErr(L('staff.mnErr')))}>{L('staff.mnBtn')}</button>
          <button type="button" className={s.plain} style={{ marginTop: 4 }} onClick={reset}>{L('staff.mnBack')}</button>
        </div>
      );
    }
    if (view === 'camera') {
      return (
        <div className={`${s.center} tc-fade`}>
          <div className={s.discOutline} style={{ background: '#f3f3f3', border: 0 }}><Icon d="M3 7h4l2-3h6l2 3h4v13H3zM3 3l18 18" size={30} color="#444" /></div>
          <h1 className={s.big} style={{ marginTop: 18, fontSize: 20 }}>{L('staff.camTitle')}</h1>
          <p className={s.p} style={{ marginTop: 8 }}>{L('staff.camText')}</p>
          <button type="button" className={s.ctaSmall} onClick={() => setView('manual')}>{L('staff.camManual')}</button>
        </div>
      );
    }
    if (view === 'found' && p) {
      return (
        <div className="tc-panel-work">
          <h1 className={s.h1}>{L('staff.foundTitle')}</h1>
          <div className={s.card}>
            {p.kind === 'stamp' ? (
              <>
                <div className={s.who}>
                  <span className={s.avatar}>{(p.customer ?? '').slice(-2) || '•'}</span>
                  <span style={{ flex: 1, minWidth: 0 }}><span className={s.name}>{p.customer ?? ''}</span></span>
                </div>
                <div className={s.loyalty}>
                  <div className={s.row}><span className={s.k}>{L('staff.loyaltyLbl')}</span><span className={s.v}>{L('staff.stampsOf', { a: p.count, b: p.total })}</span></div>
                  <ul className={s.dots} aria-hidden="true">{Array.from({ length: p.total }, (_, i) => <li key={i} data-on={i < p.count} />)}</ul>
                  {p.typed && <p className={s.note}>{L('staff.handNote')}</p>}
                  {p.limit?.over && <p role="status" className={s.warn}>{L('staff.limitOver', { a: p.limit.max })}</p>}
                  {p.limit && !p.limit.over && p.limit.near && <p role="status" className={s.warn}>{L('staff.limitNear', { a: p.limit.used, b: p.limit.max })}</p>}
                </div>
              </>
            ) : (
              <>
                <div className={s.k}>{L('staff.rdFoundTitle')}</div>
                <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 10, fontSize: 18, fontWeight: 700, color: '#333' }}><Icon d={GIFT} /><span>{p.reward}</span></div>
                <div style={{ marginTop: 10 }}>
                  <div className={s.rdRow}><span style={{ color: '#595959' }}>{L('staff.rdStatusLbl')}</span><span className={s.v} style={{ fontSize: 13 }}>{L('staff.rdStatusVal')}</span></div>
                  <div className={s.rdRow}><span style={{ color: '#595959' }}>{L('staff.rdUntilLbl')}</span><span className={s.v} style={{ fontSize: 13 }}>{day(p.expiresAt)}</span></div>
                  {p.earnedWith && <div className={s.rdRow}><span style={{ color: '#595959' }}>{L('staff.rdEarnedLbl')}</span><span className={s.v} style={{ fontSize: 13 }}>{L('main.progress', { a: p.earnedWith, b: p.earnedWith })}</span></div>}
                </div>
                <p className={s.note} style={{ marginTop: 8 }}>{L('staff.rdGive')}</p>
              </>
            )}
            <button type="button" className={s.cta} aria-busy={busy} onClick={confirm}>{p.kind === 'stamp' ? L('staff.addStamp') : L('staff.rdConfirm')}</button>
            <button type="button" className={s.plain} onClick={reset}>{L('staff.cancel')}</button>
          </div>
        </div>
      );
    }
    if (view === 'done' && done) {
      return (
        <div className={`${s.center} tc-fade`}>
          <div className={`${done.queued || done.pending ? s.discOutline : s.disc} tc-slam-work`}>
            <Icon d={done.queued ? 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0' : TICK} size={34} color={done.queued || done.pending ? '#333' : '#fff'} width={2.4} />
          </div>
          {found?.preview.kind === 'stamp' && found.preview.customer && <div className={s.name} style={{ marginTop: 16 }}>{found.preview.customer}</div>}
          <h1 role="status" className={s.big}>{done.title}</h1>
          {done.sub && <p className={s.p} style={{ marginTop: 8 }}>{done.sub}</p>}
          {done.reward && <p className={s.hint}>{L('staff.rewardReady')}</p>}
          <button type="button" className={s.ctaSmall} onClick={reset}>{L('staff.nextCustomer')}</button>
        </div>
      );
    }
    if (view === 'refused' && refused) {
      return (
        <div className={`${s.center} tc-fade`}>
          <div className={s.refusedDisc}><Icon d={CROSS} size={30} color="#b3261e" width={2.4} /></div>
          <h1 role="alert" className={s.bigRed}>{refused.title}</h1>
          {refused.text && <p className={s.p} style={{ marginTop: 8 }}>{refused.text}</p>}
          <button type="button" className={s.ctaSmall} onClick={reset}>{L('staff.tryAgain')}</button>
        </div>
      );
    }
    return (
      <>
        <h1 className={s.h1}>{L('staff.scanTitle')}</h1>
        <p className={s.p}>{L('staff.scanHelp')}</p>
        <div className={s.viewfinder}>
          <Camera className={s.video} onCode={onCamera} onDenied={onDenied} />
          <div className={s.frame} aria-hidden="true">
            <div className={`${s.corner} ${s.tl}`} /><div className={`${s.corner} ${s.tr}`} />
            <div className={`${s.corner} ${s.bl}`} /><div className={`${s.corner} ${s.br}`} />
            <div className={`${s.line} tc-scanline-work`} />
          </div>
        </div>
        <button type="button" className={s.underline} onClick={() => setView('manual')}>{L('staff.manualLink')}</button>
      </>
    );
  })();

  const bannerText = !online ? L('staff.offBanner') : queue.length ? L('staff.queuedBanner', { a: queue.length }, queue.length) : '';

  return (
    <main className={s.screen}>
      <div className={s.header}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className={s.kicker}>{L('staff.staffTitle')}</div>
          <div className={s.shop}>{me.businessName} · {me.branchName}</div>
        </div>
        <div className={s.chip}>{me.name}</div>
        <button type="button" className={s.iconBtn} aria-label={L('staff.signOut')} onClick={onSignOut}><Icon d="M15 4h4v16h-4M10 16l4-4-4-4M14 12H4" /></button>
      </div>
      <div className={s.body}>
        {bannerText && (
          <div role="status" className={s.banner}>
            <Icon d={online ? 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0' : 'M3 3l18 18M8.5 16.5a5 5 0 0 1 7 0'} size={18} color="#444" />
            <span>{bannerText}</span>
          </div>
        )}
        {body}
      </div>
      <nav className={s.tabs} aria-label={L('staff.tabsAria')}>
        <button type="button" className={s.tab} aria-current={tab === 'scan' ? 'page' : undefined} onClick={() => { setTab('scan'); reset(); }}>
          <Icon d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4M4 12h16" size={22} color={tab === 'scan' ? '#333' : '#595959'} />{L('staff.tabScan')}
        </button>
        <button type="button" className={s.tab} aria-current={tab === 'recent' ? 'page' : undefined} onClick={() => setTab('recent')}>
          <Icon d="M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0" size={22} color={tab === 'recent' ? '#333' : '#595959'} />{L('staff.tabRecent')}
        </button>
      </nav>
    </main>
  );
}
