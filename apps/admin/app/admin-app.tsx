'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiFailure, apiPost, authed, loadSession, saveSession } from '@temelash/ui';
import { A, GREY, List, Modal, SearchIcon, fd, ft, type Ctx, type ModalSpec, type View } from './ui';
import { AuditPage, BusinessPage, BusinessesPage, OverviewPage, RequestsPage, SettingsPage } from './pages';
import { SignIn, type Step } from './signin';
import s from './admin.module.css';

/**
 * Admin board shell: the sidebar (Overview, Businesses, Requests, Activity
 * log, Settings), the top search, the "All stamping is paused" banner and
 * the dialog and toast every page uses. Agents, Finance, Messages, Stands
 * and Audience join the sidebar with their phases (5 to 7).
 */

const IC = {
  home: 'M4 11l8-7 8 7v9H4zM10 20v-6h4v6', store: 'M4 10l1-5h14l1 5M5 10v10h14V10M4 10h16M9 20v-5h6v5', inbox: 'M4 13l3-8h10l3 8v6H4zM4 13h5l1 2h4l1-2h5',
  log: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01', cog: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2-1.2L14.2 3h-4.4l-.4 2.6a7 7 0 0 0-2 1.2l-2.3-.9-2 3.4 2 1.5A7 7 0 0 0 5 12a7 7 0 0 0 .1 1.2l-2 1.5 2 3.4 2.3-.9a7 7 0 0 0 2 1.2l.4 2.6h4.4l.4-2.6a7 7 0 0 0 2-1.2l2.3.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z',
};

type Me = Ctx['me'];
interface Found { businesses: Array<{ id: string; name: string; status: string }>; people: Array<{ name: string; role: string; businessId: string; business: string }> }
interface Kill { on: boolean; reason: string; changedBy: string | null; changedAt: string | null }

export function AdminApp() {
  const [auth, setAuth] = useState<'loading' | 'in' | Step>('loading');
  const [me, setMe] = useState<Me | null>(null);
  const [view, setView] = useState<View>({ v: 'overview' });
  const [modal, setModal] = useState<ModalSpec | null>(null);
  const [toast, setToast] = useState('');
  const [openReqs, setOpenReqs] = useState(0);
  const [kill, setKill] = useState<Kill | null>(null);
  const [gs, setGs] = useState('');
  const [found, setFound] = useState<Found | null>(null);
  const [tick, setTick] = useState(0);

  const loadMe = useCallback(async (after?: 'code' | 'backup' | 'setup') => {
    try {
      const m = await authed<Me>('admin', 'GET', '/admin/me');
      setMe(m);
      setAuth('in');
      if (after === 'setup') setToast(A('twoStepOn'));
      else if (after === 'backup') setToast(A('bkUsed', { a: m.backupCodesLeft }, m.backupCodesLeft));
      else if (after === 'code') setToast(A('welcomeBack', { a: m.name }));
    } catch (e) {
      setAuth(e instanceof ApiFailure && e.code === 'idle_signed_out' ? 'idle' : 'pw');
    }
  }, []);

  useEffect(() => {
    if (!loadSession('admin')) setAuth('pw');
    else loadMe();
    // Any page that finds the session over (idle for 30 minutes, signed out elsewhere) shows the sign-in.
    const on401 = (e: Event) => { saveSession('admin', null); setModal(null); setAuth((e as CustomEvent).detail === 'idle_signed_out' ? 'idle' : 'pw'); };
    window.addEventListener('tc-admin-401', on401);
    return () => window.removeEventListener('tc-admin-401', on401);
  }, [loadMe]);

  // Sidebar badge and the kill-switch banner, refreshed after actions and every minute.
  useEffect(() => {
    if (auth !== 'in') return;
    const load = () => {
      authed<unknown[]>('admin', 'GET', '/admin/requests').then((r) => setOpenReqs(r.length)).catch(() => {});
      authed<Kill>('admin', 'GET', '/admin/kill-switch').then(setKill).catch(() => {});
    };
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [auth, tick]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(''), 3400);
    return () => clearTimeout(id);
  }, [toast]);

  // Top search: businesses by name, code, owner or phone; people take you to their business.
  useEffect(() => {
    const q = gs.trim();
    if (q.length < 2) { setFound(null); return; }
    const id = setTimeout(() => { authed<Found>('admin', 'GET', `/admin/search?q=${encodeURIComponent(q)}`).then(setFound).catch(() => setFound({ businesses: [], people: [] })); }, 250);
    return () => clearTimeout(id);
  }, [gs]);

  if (auth === 'loading') return <main className={s.login} />;
  if (auth !== 'in' || !me) return <SignIn start={auth === 'in' ? 'pw' : auth} onIn={(how) => loadMe(how)} />;

  const ctx: Ctx = {
    me,
    open: setModal,
    close: () => setModal(null),
    toast: setToast,
    nav: (v) => { setView(v); setModal(null); },
    refresh: () => setTick((n) => n + 1),
  };
  const signOut = async () => {
    const sess = loadSession('admin');
    if (sess) await apiPost('/auth/signout', {}, sess.accessToken).catch(() => {});
    saveSession('admin', null);
    setMe(null);
    setAuth('pw');
  };
  const nav: Array<[View['v'], string, string, number]> = [
    ['overview', 'navOverview', IC.home, 0], ['businesses', 'navBusinesses', IC.store, 0], ['requests', 'navRequests', IC.inbox, openReqs],
    ['audit', 'navLog', IC.log, 0], ['settings', 'navSettings', IC.cog, 0],
  ];
  const isOn = (v: View['v']) => view.v === v || (v === 'businesses' && view.v === 'business');
  const go = (v: View) => { ctx.nav(v); setGs(''); };
  const results = found ? [
    ...found.businesses.slice(0, 4).map((b) => ({ k: A('kBusiness'), t: b.name, s: A({ active: 'pActive', trial: 'pTrial', pending: 'pPending', paused: 'pPaused', closing: 'pClosing', closed: 'pClosed', rejected: 'pRejected' }[b.status] ?? 'pActive'), go: () => go({ v: 'business', id: b.id }) })),
    ...found.people.slice(0, 3).map((p) => ({ k: A('kPerson'), t: p.name, s: p.business, go: () => go({ v: 'business', id: p.businessId, tab: 'people' }) })),
  ] : [];
  const today = new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Addis_Ababa' }).replace(',', '');

  let page: React.ReactNode;
  switch (view.v) {
    case 'overview': page = <OverviewPage ctx={ctx} />; break;
    case 'businesses': page = <BusinessesPage ctx={ctx} />; break;
    case 'business': page = <BusinessPage key={view.id} ctx={ctx} view={view} />; break;
    case 'requests': page = <RequestsPage ctx={ctx} view={view} />; break;
    case 'audit': page = <AuditPage />; break;
    case 'settings': page = <SettingsPage ctx={ctx} view={view} />; break;
  }

  return (
    <div className={s.app}>
      <aside className={s.aside}>
        <div className={s.brandRow}>
          <span aria-hidden="true" className={s.brandMark}>T</span>
          <div><div className={s.brandName}>{A('brand')}</div><div className={s.brandSub}>{A('brandSub')}</div></div>
        </div>
        <nav aria-label="Main" className={s.nav}>
          {nav.map(([v, l, ic, badge]) => (
            <button key={v} type="button" className={s.navBtn} aria-current={isOn(v) ? 'page' : undefined} onClick={() => go({ v } as View)}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: 'none' }}><path d={ic} /></svg>
              <span style={{ flex: 1 }}>{A(l)}</span>
              {badge > 0 && <span className={s.navBadge}>{badge}</span>}
            </button>
          ))}
        </nav>
        <div style={{ flex: 1 }} />
        <div className={s.meRow}>
          <span aria-hidden="true" className={s.meAvatar}>{me.name.charAt(0).toUpperCase()}</span>
          <div style={{ minWidth: 0 }}><div className={s.meName}>{me.name}</div><div className={s.meRole}>{A(me.role === 'owner' ? 'roleOwner' : me.role === 'finance' ? 'roleFinance' : 'roleSupport')}</div></div>
          <button type="button" className={s.signOut} aria-label={A('signOut')} onClick={signOut}>{A('signOut')}</button>
        </div>
      </aside>
      <div className={s.mainCol}>
        <div className={s.top}>
          <div className={s.search}>
            <SearchIcon />
            <input type="text" className={s.searchInput} value={gs} onChange={(e) => setGs(e.target.value)} placeholder={A('searchPh')} aria-label={A('searchPh')} onKeyDown={(e) => { if (e.key === 'Escape') setGs(''); }} />
            {found && gs.trim().length >= 2 && (
              <div className={s.gsPanel}>
                {results.map((r, i) => (
                  <button key={i} type="button" className={s.gsRow} onClick={r.go}>
                    <span className={s.gsKind}>{r.k}</span>
                    <div style={{ flex: 1, minWidth: 0 }}><div className={s.gsT}>{r.t}</div><div className={s.gsS}>{r.s}</div></div>
                  </button>
                ))}
                {results.length === 0 && <div className={s.gsNone}>{A('nothingFound')}</div>}
              </div>
            )}
          </div>
          <div style={{ flex: 1 }} />
          <span className={s.date}>{today}</span>
        </div>
        <main className={s.page}>
          {kill?.on && (
            <div style={{ marginBottom: 16 }}>
              <List rows={[{ t: A('killBanner'), s: A('killBy', { a: kill.reason, b: kill.changedAt ? `${fd(kill.changedAt)} ${ft(kill.changedAt)}` : '', c: kill.changedBy ?? '' }), pill: 'killp', sc: '#b3261e', rc: GREY, go: () => go({ v: 'settings', tab: 'safety' }) }]} />
            </div>
          )}
          {page}
        </main>
      </div>
      {modal && <Modal key={modal.title} spec={modal} onClose={() => setModal(null)} />}
      {toast && <div role="status" className={s.toast}>{toast}</div>}
    </div>
  );
}
