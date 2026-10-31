'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { t, type Lang, type MessageKey } from '@temelash/i18n';
import { ApiFailure, authed } from '@temelash/ui';
import { DateTime, Look, Poster, Security, formatDay, formatWhen, logText, setPrefs, type Prefs } from './owner-more';
import s from './app.module.css';

/**
 * Owner board, signed in: Today, Review (approvals and typed by hand),
 * Customers with the fix sheet, Team, Shop (card, rules, branches and hours,
 * details), Reports and the Activity log. Managers get the same screens held
 * to their branch, without the Shop tab and owner-only actions (OwnMgr*).
 */

type Screen =
  | { name: 'today' } | { name: 'review'; tab: 'appr' | 'hand' } | { name: 'customers' } | { name: 'customer'; cardId: string }
  | { name: 'team' } | { name: 'person'; id: string } | { name: 'addPerson' } | { name: 'shop' } | { name: 'card' } | { name: 'rules' }
  | { name: 'branches' } | { name: 'branch'; id: string | null } | { name: 'details' } | { name: 'reports' } | { name: 'log' }
  | { name: 'look' } | { name: 'poster' } | { name: 'security' } | { name: 'datetime' };
interface Branch { id: string; name: string; address: string | null; hours: Record<string, string[][]>; status: string }
interface Person { id: string; name: string; phone: string; role: string; hourlyLimit: number | null; branches: string[]; locked: boolean; pinDaysLeft: number | null }
interface Rules { version: number; stampsNeeded: number; ladder: Array<{ tier: number; at: number; reward: string }>; gapHours: number; rewardValidDays: number; hourlyLimit: number | null; handTyped: 'review' | 'allow' | 'off'; pinDays: number }

const EAT = 'Africa/Addis_Ababa';
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const IC = {
  home: 'M4 11l8-7 8 7v9H4zM10 20v-6h4v6', users: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21c0-4 3-6 7-6s7 2 7 6',
  userplus: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21c0-4 3-6 7-6s7 2 7 6M19 8v6M16 11h6', store: 'M4 10l1-5h14l1 5M5 10v10h14V10M4 10h16M9 20v-5h6v5',
  menu: 'M4 7h16M4 12h16M4 17h16', back: 'M15 6l-6 6 6 6', chev: 'M9 6l6 6-6 6', check: 'M5 12.5l4.5 4.5L19 7.5', hand: 'M8 13V5a1.5 1.5 0 0 1 3 0v6M11 11V4a1.5 1.5 0 0 1 3 0v7M14 11V5.5a1.5 1.5 0 0 1 3 0V14a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-3l-2-4a1.5 1.5 0 0 1 2.5-1.5L8 13',
  lock: 'M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3', clock: 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0', x: 'M6 6l12 12M18 6L6 18',
};

function Icon({ d, size = 22, color = '#333' }: { d: string; size?: number; color?: string }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;
}
const when = (iso: string | null, lang: Lang) => (iso ? formatWhen(iso, lang) : '');

/** GET with reload; errors show as an empty state rather than a blank page. */
function useLoad<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState(false);
  const reload = useCallback(() => {
    if (!path) return;
    authed<T>('owner', 'GET', path).then((d) => { setData(d); setError(false); }).catch(() => setError(true));
  }, [path]);
  useEffect(reload, [reload]);
  return { data, error, reload };
}

export function OwnerApp({ lang, me, onSignOut, onLang }: { lang: Lang; me: { actorType: string; businessId: string | null }; onSignOut: () => void; onLang: (l: Lang) => void }) {
  const L = useCallback((k: string, v?: Record<string, string | number>) => t(lang, k as MessageKey, v), [lang]);
  const isMgr = me.actorType === 'manager';
  const [stack, setStack] = useState<Screen[]>([{ name: 'today' }]);
  const [menu, setMenu] = useState(false);
  const [toast, setToast] = useState('');
  const [branch, setBranch] = useState<string>('');
  const [, setPrefsLoaded] = useState(0);
  useEffect(() => {
    authed<Prefs>('owner', 'GET', '/owner/prefs').then((p) => { setPrefs(p); setPrefsLoaded((n) => n + 1); }).catch(() => {});
  }, []);
  const shop = useLoad<{ name: string; shopCode: string }>('/owner/shop');
  const branches = useLoad<Branch[]>('/owner/branches');
  const cur = stack[stack.length - 1];
  const go = (sc: Screen) => setStack([...stack, sc]);
  const back = () => setStack(stack.length > 1 ? stack.slice(0, -1) : stack);
  const tab = (sc: Screen) => setStack([sc]);
  const q = branch ? `branchId=${branch}` : '';
  const today = useLoad<{ attention: { pendingApprovals: number; toCheck: number; locked: Array<{ id: string; name: string }>; pinsExpiringSoon: Array<{ id: string; name: string; daysLeft: number }> }; today: { stamps: number; rewards: number } }>(`/owner/today?${q}`);
  const attnCount = today.data ? today.data.attention.pendingApprovals + today.data.attention.toCheck + today.data.attention.locked.length : 0;

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(''), 3000);
    return () => clearTimeout(id);
  }, [toast]);

  // ---------------------------------------------------------------- screens
  const screens: Record<Screen['name'], () => ReactNode> = {
    today: () => {
      const a = today.data?.attention;
      const now = new Date();
      const dateLine = formatDay(now, lang);
      return (
        <>
          <h1 className={s.h1}>{L('owner.todayTitle')}</h1>
          <p className={s.muted}>{dateLine}</p>
          {!isMgr ? (
            <div className={s.chips}>
              <button type="button" className={s.chip} aria-pressed={!branch} onClick={() => setBranch('')}>{L('owner.allBranches')}</button>
              {(branches.data ?? []).map((b) => <button key={b.id} type="button" className={s.chip} aria-pressed={branch === b.id} onClick={() => setBranch(b.id)}>{b.name}</button>)}
            </div>
          ) : (
            <div className={s.scope}><Icon d={IC.store} size={16} color="#444" /><span>{branches.data?.[0]?.name ?? ''}</span></div>
          )}
          <div className={s.stats}>
            <div className={s.stat}><div className={s.statN}>{today.data?.today.stamps ?? '–'}</div><div className={s.statL}>{L('main.hStamps')}</div></div>
            <div className={s.stat}><div className={s.statN}>{today.data?.today.rewards ?? '–'}</div><div className={s.statL}>{L('main.hRewards')}</div></div>
          </div>
          {a && attnCount + a.pinsExpiringSoon.length > 0 && (
            <>
              <div className={s.section}>{L('owner.attnLbl')}</div>
              <ul className={`${s.card} ${s.rows}`}>
                {a.pendingApprovals > 0 && <Row icon={IC.clock} title={L('owner.attnAppr', { a: a.pendingApprovals })} sub={L('owner.attnApprSub')} onClick={() => go({ name: 'review', tab: 'appr' })} />}
                {a.toCheck > 0 && <Row icon={IC.hand} title={L('owner.attnHand', { a: a.toCheck })} sub={L('owner.attnHandSub')} onClick={() => go({ name: 'review', tab: 'hand' })} />}
                {a.locked.map((p) => <Row key={p.id} icon={IC.lock} title={L('owner.attnLocked', { a: p.name })} sub={L('owner.attnLockedSub')} onClick={() => go({ name: 'person', id: p.id })} />)}
                {a.pinsExpiringSoon.length > 0 && <Row icon={IC.lock} title={L('owner.attnPin', { a: a.pinsExpiringSoon.length })} sub={a.pinsExpiringSoon.map((p) => p.name).join(', ')} onClick={() => tab({ name: 'team' })} />}
              </ul>
            </>
          )}
          <Week path={`/owner/reports?days=7&${q}`} L={L} />
          <div className={s.section}>{L('owner.quickLbl')}</div>
          <ul className={`${s.card} ${s.rows}`}>
            <Row icon={IC.userplus} title={L('owner.qAddCashier')} sub={L('owner.qAddCashierSub')} onClick={() => go({ name: 'addPerson' })} />
          </ul>
        </>
      );
    },

    review: () => <Review L={L} q={q} start={cur.name === 'review' ? cur.tab : 'appr'} onDone={(m) => { setToast(m); today.reload(); }} />,

    customers: () => <Customers L={L} q={q} lang={lang} onOpen={(cardId) => go({ name: 'customer', cardId })} />,

    customer: () => <Customer L={L} lang={lang} isMgr={isMgr} cardId={cur.name === 'customer' ? cur.cardId : ''} onToast={setToast} />,

    team: () => <Team L={L} isMgr={isMgr} onOpen={(id) => go({ name: 'person', id })} onAdd={() => go({ name: 'addPerson' })} />,

    person: () => <PersonScreen L={L} id={cur.name === 'person' ? cur.id : ''} onToast={setToast} onGone={back} />,

    addPerson: () => <AddPerson L={L} isMgr={isMgr} branches={branches.data ?? []} />,

    shop: () => (
      <>
        <h1 className={s.h1}>{L('owner.shopTitle')}</h1>
        <p className={s.help}>{L('owner.shopHelp')}</p>
        <ul className={`${s.card} ${s.rows}`}>
          <Row title={L('owner.shCard')} sub={shop.data ? `${L('owner.shPosterSub').replace('MOKA24', shop.data.shopCode)}` : ''} onClick={() => go({ name: 'card' })} />
          <Row title={L('owner.shRules')} onClick={() => go({ name: 'rules' })} />
          <Row title={L('owner.shBranches')} sub={L('owner.shBranchesSub', { a: branches.data?.length ?? 0 })} onClick={() => go({ name: 'branches' })} />
          <Row title={L('owner.shLook')} sub={L('owner.shLookSub')} onClick={() => go({ name: 'look' })} />
          <Row title={L('owner.shPoster')} sub={shop.data ? L('owner.shPosterSub').replace('MOKA24', shop.data.shopCode) : ''} onClick={() => go({ name: 'poster' })} />
          <Row title={L('owner.shDetails')} onClick={() => go({ name: 'details' })} />
        </ul>
      </>
    ),

    card: () => <CardEditor L={L} onSaved={(m) => { setToast(m); back(); }} />,
    rules: () => <RulesEditor L={L} onSaved={(m) => { setToast(m); back(); }} />,
    branches: () => <Branches L={L} list={branches.data ?? []} isMgr={isMgr} onOpen={(id) => go({ name: 'branch', id })} />,
    branch: () => <BranchForm L={L} lang={lang} branch={(branches.data ?? []).find((b) => cur.name === 'branch' && b.id === cur.id) ?? null} onSaved={(m) => { setToast(m); branches.reload(); back(); }} />,
    details: () => <Details L={L} shop={shop.data} onSaved={(m) => { setToast(m); shop.reload(); back(); }} />,
    reports: () => <Reports L={L} isMgr={isMgr} branches={branches.data ?? []} />,
    log: () => <Log L={L} lang={lang} />,
    look: () => <Look L={L} shopName={shop.data?.name ?? ''} onSaved={setToast} />,
    poster: () => <Poster L={L} shop={shop.data} />,
    security: () => <Security L={L} onSaved={setToast} />,
    datetime: () => <DateTime L={L} lang={lang} onSaved={(m) => { setToast(m); back(); }} />,
  };

  const titles: Partial<Record<Screen['name'], string>> = {
    review: L('owner.attnLbl'), customer: L('owner.tabCustomers'), person: L('owner.tabTeam'), addPerson: L('owner.addPerson'),
    card: L('owner.shCard'), rules: L('owner.shRules'), branches: L('owner.shBranches'), branch: L('owner.shBranches'),
    details: L('owner.shDetails'), reports: L('owner.mnReports'), log: L('owner.mnLog'),
    look: L('owner.shLook'), poster: L('owner.shPoster'), security: L('owner.mnSecurity'), datetime: L('owner.mnDateTime'),
  };
  const isRoot = stack.length === 1 && ['today', 'customers', 'team', 'shop'].includes(cur.name);
  const tabs: Array<[Screen['name'], string, string]> = [['today', L('owner.tabToday'), IC.home], ['customers', L('owner.tabCustomers'), IC.users], ['team', L('owner.tabTeam'), IC.userplus]];
  if (!isMgr) tabs.push(['shop', L('owner.tabShop'), IC.store]);

  return (
    <main className={s.screen}>
      {isRoot ? (
        <div className={s.rootHdr}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className={s.kicker}>{isMgr ? L('owner.mgrTitle') : L('owner.ownerTitle')}</div>
            <div className={s.biz}>{shop.data?.name ?? ''}</div>
          </div>
          <button type="button" className={s.iconBtn} aria-label={L('owner.menuAria')} aria-haspopup="dialog" onClick={() => setMenu(true)}><Icon d={IC.menu} /></button>
        </div>
      ) : (
        <div className={s.subHdr}>
          <button type="button" className={s.iconBtn} aria-label={L('owner.back')} onClick={back}><Icon d={IC.back} /></button>
          <h1 className={s.subTitle}>{titles[cur.name] ?? ''}</h1>
        </div>
      )}
      <div key={stack.length + cur.name} className={`${s.body} ${stack.length > 1 ? 'tc-panel-work' : 'tc-fade'}`}>{screens[cur.name]()}</div>
      {isRoot && (
        <nav className={s.tabs} aria-label={L('owner.tabsAria')}>
          {tabs.map(([k, label, icon]) => (
            <button key={k} type="button" className={s.tab} aria-current={cur.name === k ? 'page' : undefined} onClick={() => tab({ name: k } as Screen)}>
              <Icon d={icon} color={cur.name === k ? '#222' : '#595959'} />{label}
              {k === 'today' && attnCount > 0 && <span className={s.tabBadge}>{attnCount}</span>}
            </button>
          ))}
        </nav>
      )}
      {menu && (
        <div className={`${s.dim} tc-fade`} onClick={() => setMenu(false)} style={{ alignItems: 'stretch' }}>
          <div className={`${s.menu} tc-panel-work`} role="dialog" aria-label={L('owner.menuAria')} onClick={(e) => e.stopPropagation()}>
            <ul className={s.rows} style={{ padding: 0 }}>
              <Row title={L('owner.mnReports')} sub={L('owner.mnReportsSub')} onClick={() => { setMenu(false); go({ name: 'reports' }); }} />
              <Row title={L('owner.mnLog')} sub={L('owner.mnLogSub')} onClick={() => { setMenu(false); go({ name: 'log' }); }} />
              <Row title={L('owner.mnSecurity')} sub={L('owner.mnSecuritySub')} onClick={() => { setMenu(false); go({ name: 'security' }); }} />
              <Row title={L('owner.mnDateTime')} onClick={() => { setMenu(false); go({ name: 'datetime' }); }} />
            </ul>
            <div className={s.section}>{L('owner.langLbl')}</div>
            <div className={s.chips} style={{ marginTop: 0 }}>
              {(['en', 'am', 'om'] as Lang[]).map((l) => <button key={l} type="button" className={s.chip} aria-pressed={lang === l} onClick={() => onLang(l)}>{{ en: 'English', am: 'አማርኛ', om: 'Afaan Oromoo' }[l]}</button>)}
            </div>
            <button type="button" className={s.outline} style={{ marginTop: 24 }} onClick={onSignOut}>{L('owner.signOut')}</button>
          </div>
        </div>
      )}
      {toast && <div className={`${s.toast} tc-fade`} role="status">{toast}</div>}
    </main>
  );
}

// ---------------------------------------------------------------- shared pieces
type Lfn = (k: string, v?: Record<string, string | number>) => string;

function Row({ icon, title, sub, onClick, right }: { icon?: string; title: string; sub?: string; onClick?: () => void; right?: ReactNode }) {
  const inner = (
    <span className={s.row}>
      {icon && <span className={s.rowIcon}><Icon d={icon} size={20} color="#444" /></span>}
      <span className={s.rowMain}><span className={s.rowTitle}>{title}</span>{sub && <span className={s.rowSub}>{sub}</span>}</span>
      {right ?? (onClick && <Icon d={IC.chev} size={18} color="#595959" />)}
    </span>
  );
  return <li>{onClick ? <button type="button" className={s.rowBtn} onClick={onClick}>{inner}</button> : inner}</li>;
}

function Week({ path, L }: { path: string; L: Lfn }) {
  const r = useLoad<{ stamps: number; byDay: Array<{ day: string; stamps: number }> }>(path);
  const days = Array.from({ length: 7 }, (_, i) => new Date(Date.now() - (6 - i) * 86_400_000).toLocaleDateString('en-CA', { timeZone: EAT }));
  const by = new Map((r.data?.byDay ?? []).map((d) => [d.day, d.stamps]));
  const max = Math.max(1, ...days.map((d) => by.get(d) ?? 0));
  return (
    <>
      <div className={s.section}>{L('owner.chartStamps7')} · {L('owner.chartTotal', { a: r.data?.stamps ?? 0 })}</div>
      <div className={s.card}>
        <div className={s.bars} role="img" aria-label={L('owner.chartAria')}>
          {days.map((d) => (
            <div key={d} className={s.barCol}>
              <span>{by.get(d) ?? 0}</span>
              <div className={s.bar} style={{ height: `${((by.get(d) ?? 0) / max) * 80}px` }} />
              <span>{d.slice(8)}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function Review({ L, q, start, onDone }: { L: Lfn; q: string; start: 'appr' | 'hand'; onDone: (msg: string) => void }) {
  const [tabSel, setTab] = useState(start);
  const appr = useLoad<Array<{ id: string; at: string; staff: string; branch: string; phone: string }>>(`/owner/approvals?${q}`);
  const hand = useLoad<Array<{ id: string; at: string; staff: string; branch: string }>>(`/owner/to-check?${q}`);
  const act = async (path: string, body: object, msg: string) => {
    await authed('owner', 'POST', path, body);
    appr.reload();
    hand.reload();
    onDone(msg);
  };
  const list = tabSel === 'appr' ? appr.data : hand.data;
  return (
    <>
      <div className={s.chips}>
        <button type="button" className={s.chip} aria-pressed={tabSel === 'appr'} onClick={() => setTab('appr')}>{L('owner.rvApprove', { a: appr.data?.length ?? 0 })}</button>
        <button type="button" className={s.chip} aria-pressed={tabSel === 'hand'} onClick={() => setTab('hand')}>{L('owner.rvHand', { a: hand.data?.length ?? 0 })}</button>
      </div>
      <p className={s.help}>{tabSel === 'appr' ? L('owner.rvHelpAppr') : L('owner.rvHelpHand')}</p>
      {list && list.length === 0 && <div className={s.empty}><div className={s.emptyT}>{L('owner.rvNone')}</div><p className={s.help}>{L('owner.rvNoneSub')}</p></div>}
      {list && list.length > 0 && (
        <>
          {tabSel === 'appr' && <button type="button" className={s.cta} onClick={() => act('/owner/approvals/decide', { stampIds: list.map((x) => x.id), decision: 'approved' }, L('owner.rvAllToast', { a: list.length }))}>{L('owner.approveAll')}</button>}
          <ul className={`${s.card} ${s.rows}`}>
            {list.map((x) => (
              <li key={x.id}>
                <div className={s.row} style={{ flexWrap: 'wrap' }}>
                  <span className={s.rowMain}>
                    <span className={s.rowTitle}>{'phone' in x ? (x as { phone: string }).phone : x.staff}</span>
                    <span className={s.rowSub}>{L('owner.rvSub', { a: x.staff ?? '', b: x.branch ?? '', c: new Date(x.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: EAT }) })}</span>
                  </span>
                  {tabSel === 'appr' ? (
                    <span style={{ display: 'flex', gap: 8 }}>
                      <button type="button" className={s.small} onClick={() => act('/owner/approvals/decide', { stampIds: [x.id], decision: 'rejected' }, L('owner.rvDeclinedToast'))}>{L('owner.rvDecline')}</button>
                      <button type="button" className={s.smallDark} onClick={() => act('/owner/approvals/decide', { stampIds: [x.id], decision: 'approved' }, L('owner.rvApprovedToast'))}>{L('owner.rvApprove1')}</button>
                    </span>
                  ) : (
                    <button type="button" className={s.smallDark} onClick={() => act('/owner/to-check/mark', { stampIds: [x.id] }, L('owner.rvFineToast'))}>{L('owner.rvLooksFine')}</button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

function Customers({ L, q, lang, onOpen }: { L: Lfn; q: string; lang: Lang; onOpen: (cardId: string) => void }) {
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setTerm(search), 300);
    return () => clearTimeout(id);
  }, [search]);
  const list = useLoad<Array<{ cardId: string; phone: string; status: string; stamps: number; total: number; lastVisit: string | null }>>(`/owner/customers?q=${encodeURIComponent(term)}&${q}`);
  return (
    <>
      <h1 className={s.h1}>{L('owner.tabCustomers')}</h1>
      <input className={s.search} style={{ marginTop: 12 }} type="search" placeholder={L('owner.searchPh')} aria-label={L('owner.searchPh')} value={search} onChange={(e) => setSearch(e.target.value)} />
      <p className={s.muted} style={{ marginTop: 10 }}>{list.data ? (list.data.length ? L('owner.custShowing', { a: list.data.length }) : '') : ''}</p>
      {list.data?.length === 0 && (
        <div className={s.empty}>
          <div className={s.emptyT}>{term ? L('owner.custNotFoundT') : L('owner.custNoneT')}</div>
          <p className={s.help}>{term ? L('owner.custNotFoundS') : L('owner.custNoneS')}</p>
        </div>
      )}
      {!!list.data?.length && (
        <ul className={`${s.card} ${s.rows}`}>
          {list.data.map((c) => (
            <Row key={c.cardId} icon={IC.users} title={c.phone ?? '—'} sub={`${L('owner.stampsShort', { a: c.stamps, b: c.total })}${c.lastVisit ? ' · ' + when(c.lastVisit, lang) : ''}${c.status === 'paused' ? ' · ' + L('owner.cuPausedT') : ''}`} onClick={() => onOpen(c.cardId)} />
          ))}
        </ul>
      )}
    </>
  );
}

function Customer({ L, lang, isMgr, cardId, onToast }: { L: Lfn; lang: Lang; isMgr: boolean; cardId: string; onToast: (m: string) => void }) {
  const c = useLoad<{ cardId: string; status: string; phone: string; stamps: number; total: number; history: Array<{ id: string; at: string; kind: string; method: string; pending: boolean; by: string | null; branch: string | null }> }>(`/owner/customers/${cardId}`);
  const [fix, setFix] = useState<null | 'add' | 'remove' | 'undo' | 'extend' | 'pause' | 'resume'>(null);
  if (c.error) return <div className={s.empty}><div className={s.emptyT}>{L('owner.custNotFoundT')}</div></div>;
  if (!c.data) return null;
  const d = c.data;
  const actions: Array<[NonNullable<typeof fix>, string, string]> = [
    ['remove', L('owner.fixRemove'), L('owner.fixRemoveSub')],
    ['add', L('owner.fixAdd'), L('owner.fixAddSub')],
    ['extend', L('owner.fixExtend'), L('owner.fixExtendSub')],
    d.status === 'paused' ? ['resume', L('owner.fixResume'), L('owner.fixResumeSub')] : ['pause', L('owner.fixPause'), L('owner.fixPauseSub')],
  ];
  if (!isMgr) actions.splice(2, 0, ['undo', L('owner.fixUndo'), '']);
  return (
    <>
      <div className={`${s.card} ${s.pad}`}>
        <div className={s.rowTitle} style={{ fontSize: 18 }}>{d.phone}</div>
        <div className={s.rowSub}>{L('owner.stampsOf', { a: d.stamps, b: d.total })}{d.status === 'paused' ? ` · ${L('owner.cuPausedT')}` : ''}</div>
      </div>
      <div className={s.section}>{L('owner.fixLbl')}</div>
      <ul className={`${s.card} ${s.rows}`}>
        {actions.map(([k, title, sub]) => <Row key={k} title={title} sub={sub || undefined} onClick={() => setFix(k)} />)}
      </ul>
      <p className={s.muted} style={{ margin: '8px 4px 0' }}>{L('owner.fixNote')}</p>
      <div className={s.section}>{L('owner.histLbl')}</div>
      <ul className={`${s.card} ${s.rows}`}>
        {d.history.map((h) => (
          <Row key={h.id} icon={h.kind === 'void' ? IC.x : IC.check} title={h.kind === 'void' ? L('owner.rvTaken') : h.method === 'typed' ? `${L('staff.stampLine')} · ${L('owner.byHandShort')}` : L('staff.stampLine')}
            sub={[when(h.at, lang), h.by, h.branch, h.pending ? L('staff.needsApproval') : ''].filter(Boolean).join(' · ')} />
        ))}
      </ul>
      {fix && <FixSheet L={L} kind={fix} cardId={d.cardId} stamps={d.stamps} total={d.total} who={d.phone} onClose={() => setFix(null)} onDone={(m) => { setFix(null); onToast(m); c.reload(); }} />}
    </>
  );
}

function FixSheet({ L, kind, cardId, stamps, total, who, onClose, onDone }: { L: Lfn; kind: 'add' | 'remove' | 'undo' | 'extend' | 'pause' | 'resume'; cardId: string; stamps: number; total: number; who: string; onClose: () => void; onDone: (m: string) => void }) {
  const [count, setCount] = useState(1);
  const [days, setDays] = useState(7);
  const [reason, setReason] = useState('');
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const reasons: Array<[string, string]> = [['mistake', L('owner.rsMistake')], ['asked', L('owner.rsAsked')], ['ours', L('owner.rsOurs')], ['goodwill', L('owner.rsGoodwill')], ['other', L('owner.rsOther')]];
  const after = kind === 'add' ? Math.min(total, stamps + count) : kind === 'remove' ? Math.max(0, stamps - count) : stamps;
  const submit = async () => {
    if (!reason) return setErr(L('owner.fxNeedReason'));
    if (!/^\d{6}$/.test(pin)) return setErr(L('owner.fxPinLen'));
    setBusy(true);
    try {
      await authed('owner', 'POST', `/owner/cards/${cardId}/fix`, { action: kind, count, days, reason, pin });
      onDone(L('owner.fxTold'));
    } catch (e) {
      setErr(e instanceof ApiFailure && e.code === 'wrong_pin' ? L('owner.fxPinWrong') : L('common.offline'));
    } finally {
      setBusy(false);
    }
  };
  const btn = { add: L('owner.fxBtnAdd', { a: count }), remove: L('owner.fxBtnRemove', { a: count }), undo: L('owner.fxBtnUndo'), extend: L('owner.fxBtnExtend', { a: days }), pause: L('owner.fixPause'), resume: L('owner.fixResume') }[kind];
  return (
    <div className={`${s.dim} tc-fade`} onClick={onClose}>
      <div className={`${s.sheet} tc-sheet`} role="dialog" aria-modal="true" aria-label={L(`owner.fxTitle_${kind}`)} onClick={(e) => e.stopPropagation()}>
        <h2 className={s.h1} style={{ fontSize: 20 }}>{L(`owner.fxTitle_${kind}`)}</h2>
        <p className={s.help}>{L(`owner.fxHelp_${kind}`, { a: who })}</p>
        {(kind === 'add' || kind === 'remove') && (
          <>
            <div className={s.label}>{kind === 'add' ? L('owner.fxHowManyAdd') : L('owner.fxHowMany')}</div>
            <div className={s.chips} style={{ marginTop: 0 }}>{[1, 2, 3].map((n) => <button key={n} type="button" className={s.chip} aria-pressed={count === n} onClick={() => setCount(n)}>{n}</button>)}</div>
            <div className={s.label}>{L('owner.fxAfter')}</div>
            <p className={s.help} style={{ marginTop: 0 }}>{L(kind === 'add' ? 'owner.fxImpAdd' : 'owner.fxImpRemove', { a: who, b: after, c: total, d: stamps })}</p>
          </>
        )}
        {kind === 'extend' && (
          <>
            <div className={s.label}>{L('owner.fxDaysLbl')}</div>
            <div className={s.chips} style={{ marginTop: 0 }}>{[7, 14, 30].map((n) => <button key={n} type="button" className={s.chip} aria-pressed={days === n} onClick={() => setDays(n)}>{L('owner.daysN', { a: n })}</button>)}</div>
          </>
        )}
        <div className={s.label}>{L('owner.fxReasonLbl')}</div>
        <div className={s.chips} style={{ marginTop: 0 }}>{reasons.map(([k, l]) => <button key={k} type="button" className={s.chip} aria-pressed={reason === k} onClick={() => setReason(k)}>{l}</button>)}</div>
        <label htmlFor="fxpin" className={s.label}>{L('owner.fxPinLbl')}</label>
        <input id="fxpin" className={s.input} type="password" inputMode="numeric" maxLength={6} autoComplete="current-password" placeholder="------" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} />
        <p role="alert" className={s.alert}>{err}</p>
        <p className={s.muted}>{L('owner.fxTold')}</p>
        <button type="button" className={s.cta} aria-busy={busy} onClick={submit}>{btn}</button>
        <button type="button" className={s.ghost} onClick={onClose}>{L('owner.cancel')}</button>
      </div>
    </div>
  );
}

function Team({ L, isMgr, onOpen, onAdd }: { L: Lfn; isMgr: boolean; onOpen: (id: string) => void; onAdd: () => void }) {
  const team = useLoad<Person[]>('/owner/team');
  return (
    <>
      <h1 className={s.h1}>{L('owner.teamTitle', { a: team.data?.length ?? 0 })}</h1>
      <button type="button" className={s.cta} onClick={onAdd}>{L('owner.addPerson')}</button>
      <ul className={`${s.card} ${s.rows}`}>
        {(team.data ?? []).map((p) => (
          <Row key={p.id} icon={IC.users} title={p.name} onClick={() => onOpen(p.id)}
            sub={`${p.role === 'manager' ? L('owner.mgrTitle') : L('staff.role')} · ${p.locked ? L('owner.stLocked') : L('owner.stActive')}`} />
        ))}
      </ul>
      {!isMgr && <p className={s.muted} style={{ margin: '10px 4px 0' }}>{L('owner.roleHelpMgr')}</p>}
    </>
  );
}

function PersonScreen({ L, id, onToast, onGone }: { L: Lfn; id: string; onToast: (m: string) => void; onGone: () => void }) {
  const team = useLoad<Person[]>('/owner/team');
  const [temp, setTemp] = useState('');
  const [limit, setLimit] = useState('');
  const p = team.data?.find((x) => x.id === id);
  if (!p) return null;
  const act = async (path: string, body: object = {}) => authed<Record<string, unknown>>('owner', 'POST', `/owner/team/${id}/${path}`, body);
  return (
    <>
      <div className={`${s.card} ${s.pad}`}>
        <div className={s.rowTitle} style={{ fontSize: 18 }}>{p.name}</div>
        <div className={s.rowSub}>{p.phone} · {p.role === 'manager' ? L('owner.mgrTitle') : L('staff.role')}</div>
        <div className={s.rowSub}>{p.hourlyLimit ? L('owner.sdLimOwn', { a: p.hourlyLimit }) : ''}</div>
        {p.pinDaysLeft !== null && <div className={s.rowSub}>{p.pinDaysLeft <= 0 ? L('owner.sdPinToday') : ''}</div>}
      </div>
      {temp && (
        <div className={`${s.card} ${s.pad} tc-fade`}>
          <div className={s.pin}>{temp}</div>
          <ol className={s.help} style={{ paddingLeft: 18 }}><li>{L('owner.ps1')}</li><li>{L('owner.ps2')}</li><li>{L('owner.ps3')}</li></ol>
        </div>
      )}
      <div className={s.section}>{L('owner.sdActions')}</div>
      <ul className={`${s.card} ${s.rows}`}>
        <Row title={L('owner.sdReset')} sub={L('owner.sdResetSub')} onClick={async () => setTemp(String((await act('reset-pin')).tempPin))} />
        {p.locked && <Row title={L('owner.sdUnlock')} sub={L('owner.sdUnlockSub')} onClick={async () => { await act('unlock'); onToast(L('owner.snSavedToast')); team.reload(); }} />}
        <Row title={L('owner.sdOff')} sub={L('owner.sdOffSub')} onClick={async () => { await act('remove'); onToast(L('owner.snSavedToast')); onGone(); }} />
      </ul>
      <label htmlFor="lim" className={s.label}>{L('owner.limSecLbl')}</label>
      <div style={{ display: 'flex', gap: 8 }}>
        <input id="lim" className={s.input} inputMode="numeric" placeholder={String(p.hourlyLimit ?? '')} value={limit} onChange={(e) => setLimit(e.target.value.replace(/\D/g, '').slice(0, 4))} />
        <button type="button" className={s.smallDark} onClick={async () => { await act('limit', { limit: limit ? Number(limit) : null }); setLimit(''); onToast(L('owner.snSavedToast')); team.reload(); }}>{L('owner.save')}</button>
      </div>
    </>
  );
}

function AddPerson({ L, isMgr, branches }: { L: Lfn; isMgr: boolean; branches: Branch[] }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<'staff' | 'manager'>('staff');
  const [branch, setBranch] = useState(branches[0]?.id ?? '');
  const [err, setErr] = useState('');
  const [created, setCreated] = useState<{ tempPin: string } | null>(null);
  const create = async () => {
    if (name.trim().length < 2) return setErr(L('owner.snNeedName'));
    if (!branch && !branches[0]) return setErr(L('owner.snNeedBranch'));
    try {
      setCreated((await authed<{ tempPin: string }>('owner', 'POST', '/owner/team', { name, phone, role, branchId: branch || branches[0].id })));
    } catch (e) {
      setErr(e instanceof ApiFailure && e.code === 'phone_in_use' ? L('owner.snDup') : e instanceof ApiFailure && e.code === 'bad_phone' ? L('join.errPhone') : L('common.offline'));
    }
  };
  if (created) {
    return (
      <div className="tc-fade">
        <h1 className={s.h1}>{name}</h1>
        <div className={s.pin}>{created.tempPin}</div>
        <ol className={s.help} style={{ paddingLeft: 18 }}><li>{L('owner.ps1')}</li><li>{L('owner.ps2')}</li><li>{L('owner.ps3')}</li></ol>
      </div>
    );
  }
  return (
    <>
      <p className={s.help}>{L('owner.snHelp')}</p>
      <label htmlFor="sn" className={s.label}>{L('owner.snName')}</label>
      <input id="sn" className={s.input} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
      <label htmlFor="sp" className={s.label}>{L('owner.phoneLbl')}</label>
      <input id="sp" className={s.input} type="tel" inputMode="tel" placeholder="9XX XXX XXX" value={phone} onChange={(e) => setPhone(e.target.value.replace(/[^\d+ ]/g, '').slice(0, 16))} />
      {!isMgr && (
        <>
          <div className={s.label}>{L('owner.snRole')}</div>
          <div className={s.chips} style={{ marginTop: 0 }}>
            <button type="button" className={s.chip} aria-pressed={role === 'staff'} onClick={() => setRole('staff')}>{L('staff.role')}</button>
            <button type="button" className={s.chip} aria-pressed={role === 'manager'} onClick={() => setRole('manager')}>{L('owner.mgrTitle')}</button>
          </div>
          <p className={s.muted}>{role === 'staff' ? L('owner.roleHelpCash') : L('owner.roleHelpMgr')}</p>
          <div className={s.label}>{L('owner.snBranch')}</div>
          <div className={s.chips} style={{ marginTop: 0 }}>{branches.map((b) => <button key={b.id} type="button" className={s.chip} aria-pressed={branch === b.id} onClick={() => setBranch(b.id)}>{b.name}</button>)}</div>
        </>
      )}
      <p className={s.muted} style={{ marginTop: 14 }}>{L('owner.snPinNote')}</p>
      <p role="alert" className={s.alert}>{err}</p>
      <button type="button" className={s.cta} onClick={create}>{L('owner.snCreate')}</button>
    </>
  );
}

function CardEditor({ L, onSaved }: { L: Lfn; onSaved: (m: string) => void }) {
  const r = useLoad<Rules>('/owner/rules');
  const [full, setFull] = useState<number | null>(null);
  const [main, setMain] = useState('');
  const [early, setEarly] = useState<{ at: number; reward: string } | null>(null);
  useEffect(() => {
    if (!r.data) return;
    const l = r.data.ladder;
    setFull(r.data.stampsNeeded);
    setMain(l[l.length - 1]?.reward ?? '');
    setEarly(l.length > 1 ? { at: l[0].at, reward: l[0].reward } : null);
  }, [r.data]);
  if (!r.data || full === null) return null;
  const save = async () => {
    const ladder = [...(early ? [early] : []), { at: full, reward: main }];
    await authed('owner', 'POST', '/owner/rules', { ...r.data!, stampsNeeded: full, ladder });
    onSaved(L('owner.savedCard'));
  };
  return (
    <>
      <p className={s.help}>{L('owner.cdHelp')}</p>
      <div className={s.section}>{L('owner.cdMainName')}</div>
      <input className={s.input} aria-label={L('owner.cdMainName')} value={main} maxLength={60} onChange={(e) => setMain(e.target.value)} />
      <div className={s.label}>{L('owner.cdFull')}</div>
      <div className={s.chips} style={{ marginTop: 0 }}>{[5, 6, 8, 10, 12].map((n) => <button key={n} type="button" className={s.chip} aria-pressed={full === n} onClick={() => setFull(n)}>{n}</button>)}</div>
      <div className={s.section}>{L('owner.cdEarlyName')}</div>
      {early ? (
        <>
          <input className={s.input} aria-label={L('owner.cdEarlyName')} value={early.reward} maxLength={60} onChange={(e) => setEarly((x) => (x ? { ...x, reward: e.target.value } : x))} />
          <div className={s.label}>{L('owner.cdAt')}</div>
          <div className={s.chips} style={{ marginTop: 0 }}>{Array.from({ length: Math.max(0, full - 2) }, (_, i) => i + 2).map((n) => <button key={n} type="button" className={s.chip} aria-pressed={early.at === n} onClick={() => setEarly((x) => (x ? { ...x, at: n } : x))}>{n}</button>)}</div>
          <button type="button" className={s.ghost} onClick={() => setEarly(null)}>{L('owner.cancel')}</button>
        </>
      ) : (
        <ul className={`${s.card} ${s.rows}`}><Row title={L('owner.cdEarlyT')} sub={L('owner.cdEarlyS')} onClick={() => setEarly({ at: Math.max(2, Math.floor(full / 2)), reward: '' })} /></ul>
      )}
      <div className={`${s.card} ${s.pad}`} style={{ marginTop: 18 }}>
        <div className={s.rowTitle}>{L('owner.cdSameT')}</div>
        <div className={s.rowSub}>{L('owner.cdSame')}</div>
      </div>
      <button type="button" className={s.cta} disabled={!main || (!!early && !early.reward)} onClick={save}>{L('owner.save')}</button>
    </>
  );
}

function RulesEditor({ L, onSaved }: { L: Lfn; onSaved: (m: string) => void }) {
  const r = useLoad<Rules>('/owner/rules');
  const [v, setV] = useState<Rules | null>(null);
  useEffect(() => setV(r.data), [r.data]);
  if (!v) return null;
  const chips = <K extends keyof Rules>(key: K, opts: Array<[Rules[K], string]>) => (
    <div className={s.chips} style={{ marginTop: 0 }}>{opts.map(([val, label]) => <button key={String(val)} type="button" className={s.chip} aria-pressed={v[key] === val} onClick={() => setV((cur) => (cur ? { ...cur, [key]: val } : cur))}>{label}</button>)}</div>
  );
  return (
    <>
      <p className={s.help}>{L('owner.crHelp')}</p>
      <div className={s.label}>{L('owner.crGapLbl')}</div>
      {chips('gapHours', [1, 2, 4, 8, 24].map((n) => [n, L('owner.hoursN', { a: n })]))}
      <p className={s.muted}>{L('owner.crGapHelp')}</p>
      <div className={s.label}>{L('owner.crValidLbl')}</div>
      {chips('rewardValidDays', [7, 14, 30, 60, 90].map((n) => [n, L('owner.daysN', { a: n })]))}
      <div className={s.label}>{L('owner.ruLimitLbl')}</div>
      {chips('hourlyLimit', [20, 30, 40, 60].map((n) => [n, String(n)]))}
      <p className={s.muted}>{L('owner.ruOver')}</p>
      <div className={s.label}>{L('owner.ruHandLbl')}</div>
      {chips('handTyped', [['review', L('owner.hnReview')], ['allow', L('owner.hnAllow')], ['off', L('owner.hnOff')]])}
      <div className={s.label}>{L('owner.ruPinLbl')}</div>
      {chips('pinDays', [0, 60, 90, 180].map((n) => [n, n ? L('owner.pxDays', { a: n }) : L('owner.pxNever')]))}
      <p className={s.muted}>{v.pinDays ? L('owner.ruPinHelp') : L('owner.ruPinHelpNever')}</p>
      <button type="button" className={s.cta} onClick={async () => { await authed('owner', 'POST', '/owner/rules', v); onSaved(L('owner.savedCardRules')); }}>{L('owner.save')}</button>
    </>
  );
}

function Branches({ L, list, isMgr, onOpen }: { L: Lfn; list: Branch[]; isMgr: boolean; onOpen: (id: string | null) => void }) {
  return (
    <>
      <p className={s.help}>{L('owner.brHelp')}</p>
      <ul className={`${s.card} ${s.rows}`}>
        {list.map((b) => <Row key={b.id} icon={IC.store} title={b.name} sub={b.address ?? ''} onClick={isMgr ? undefined : () => onOpen(b.id)} />)}
      </ul>
      {!isMgr && <button type="button" className={s.outline} onClick={() => onOpen(null)}>{L('owner.brAdd')}</button>}
    </>
  );
}

function BranchForm({ L, lang, branch, onSaved }: { L: Lfn; lang: Lang; branch: Branch | null; onSaved: (m: string) => void }) {
  const [name, setName] = useState(branch?.name ?? '');
  const [address, setAddress] = useState(branch?.address ?? '');
  const [hours, setHours] = useState<Record<string, string[][]>>(branch?.hours ?? {});
  const [err, setErr] = useState('');
  const dayName = (i: number) => new Date(Date.UTC(2026, 0, 5 + i)).toLocaleDateString(lang === 'en' ? 'en-GB' : lang, { weekday: 'long', timeZone: 'UTC' });
  const save = async () => {
    if (name.trim().length < 2) return setErr(L('owner.snNeedName'));
    for (const d of DAYS) for (const [o, c] of hours[d] ?? []) if (c <= o) return setErr(L('owner.hrBad'));
    try {
      if (branch) await authed('owner', 'POST', `/owner/branches/${branch.id}`, { name, address, hours });
      else await authed('owner', 'POST', '/owner/branches', { name, address, hours });
      onSaved(L('owner.savedHours'));
    } catch {
      setErr(L('common.offline'));
    }
  };
  return (
    <>
      <label htmlFor="bn" className={s.label}>{L('owner.brName')}</label>
      <input id="bn" className={s.input} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
      <label htmlFor="ba" className={s.label}>{L('owner.dtAddr')}</label>
      <input id="ba" className={s.input} value={address} maxLength={200} onChange={(e) => setAddress(e.target.value)} />
      <div className={s.section}>{L('owner.shHours')}</div>
      <p className={s.help} style={{ marginTop: 0 }}>{L('owner.hrHelp')}</p>
      <ul className={`${s.card} ${s.rows}`}>
        {DAYS.map((d, i) => {
          const span = hours[d]?.[0];
          return (
            <li key={d}>
              <div className={s.row}>
                <span className={s.rowMain}><span className={s.rowTitle} style={{ fontSize: 14 }}>{dayName(i)}</span></span>
                {span ? (
                  <>
                    <input type="time" aria-label={L('owner.hrOpen')} value={span[0]} onChange={(e) => setHours({ ...hours, [d]: [[e.target.value, span[1]]] })} />
                    <input type="time" aria-label={L('owner.hrClose')} value={span[1]} onChange={(e) => setHours({ ...hours, [d]: [[span[0], e.target.value]] })} />
                    <button type="button" className={s.iconBtn} aria-label={L('owner.hrClosedT')} onClick={() => { const n = { ...hours }; delete n[d]; setHours(n); }}><Icon d={IC.x} size={18} /></button>
                  </>
                ) : (
                  <button type="button" className={s.small} onClick={() => setHours((h) => ({ ...h, [d]: [['08:00', '20:00']] }))}>{L('owner.hrClosedT')}</button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <button type="button" className={s.ghost} onClick={() => hours.mon && setHours(Object.fromEntries(DAYS.map((d) => [d, hours.mon])))}>{L('owner.hrAll')}</button>
      <p role="alert" className={s.alert}>{err}</p>
      <button type="button" className={s.cta} onClick={save}>{L('owner.save')}</button>
    </>
  );
}

function Details({ L, shop, onSaved }: { L: Lfn; shop: { name: string; shopCode: string } | null; onSaved: (m: string) => void }) {
  const [name, setName] = useState(shop?.name ?? '');
  const [city, setCity] = useState('');
  return (
    <>
      <label htmlFor="dn" className={s.label}>{L('owner.bizName')}</label>
      <input id="dn" className={s.input} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
      <label htmlFor="dc" className={s.label}>{L('owner.dtAddr')}</label>
      <input id="dc" className={s.input} value={city} maxLength={80} onChange={(e) => setCity(e.target.value)} />
      <button type="button" className={s.cta} onClick={async () => { await authed('owner', 'POST', '/owner/shop', { name, city }); onSaved(L('owner.savedDetails')); }}>{L('owner.save')}</button>
    </>
  );
}

function Reports({ L, isMgr, branches }: { L: Lfn; isMgr: boolean; branches: Branch[] }) {
  const [days, setDays] = useState(7);
  const [branch, setBranch] = useState('');
  const r = useLoad<{ stamps: number; customers: number; rewards: number; newCards: number; byDay: Array<{ day: string; stamps: number }> }>(`/owner/reports?days=${days}${branch ? `&branchId=${branch}` : ''}`);
  const max = Math.max(1, ...(r.data?.byDay ?? []).map((d) => d.stamps));
  return (
    <>
      <p className={s.help}>{L('owner.mnReportsSub')}</p>
      <div className={s.chips}>{[7, 14, 30].map((n) => <button key={n} type="button" className={s.chip} aria-pressed={days === n} onClick={() => setDays(n)}>{L('owner.daysN', { a: n })}</button>)}</div>
      {!isMgr && branches.length > 1 && (
        <div className={s.chips}>
          <button type="button" className={s.chip} aria-pressed={!branch} onClick={() => setBranch('')}>{L('owner.allBranches')}</button>
          {branches.map((b) => <button key={b.id} type="button" className={s.chip} aria-pressed={branch === b.id} onClick={() => setBranch(b.id)}>{b.name}</button>)}
        </div>
      )}
      <div className={s.stats}>
        <div className={s.stat}><div className={s.statN}>{r.data?.stamps ?? '–'}</div><div className={s.statL}>{L('main.hStamps')}</div></div>
        <div className={s.stat}><div className={s.statN}>{r.data?.customers ?? '–'}</div><div className={s.statL}>{L('owner.tabCustomers')}</div></div>
        <div className={s.stat}><div className={s.statN}>{r.data?.rewards ?? '–'}</div><div className={s.statL}>{L('main.hRewards')}</div></div>
      </div>
      <div className={s.section}>{L('owner.rpByDay')}</div>
      <ul className={`${s.card} ${s.rows}`}>
        {(r.data?.byDay ?? []).map((d) => (
          <li key={d.day}>
            <div className={s.row} style={{ minHeight: 44 }}>
              <span style={{ width: 86, fontSize: 13, color: '#595959' }}>{d.day}</span>
              <span style={{ flex: 1, height: 10, borderRadius: 5, background: '#e6e6e6', overflow: 'hidden' }}><span style={{ display: 'block', height: '100%', width: `${(d.stamps / max) * 100}%`, background: '#333' }} /></span>
              <span className={s.rowTitle} style={{ width: 36, textAlign: 'right' }}>{d.stamps}</span>
            </div>
          </li>
        ))}
      </ul>
      <p className={s.muted} style={{ margin: '10px 4px 0' }}>{L('owner.rpPrivacy')}</p>
    </>
  );
}

function Log({ L, lang }: { L: Lfn; lang: Lang }) {
  const log = useLoad<Array<{ at: string; actor: string | null; actorType: string; type: string; text: string }>>('/owner/log');
  return (
    <>
      <p className={s.help}>{L('owner.mnLogSub')}</p>
      {log.data?.length === 0 && <div className={s.empty}><div className={s.emptyT}>{L('owner.logNone')}</div></div>}
      <ul className={`${s.card} ${s.rows}`}>
        {(log.data ?? []).map((e, i) => <Row key={i} title={logText(lang, e.type, e.text)} sub={`${e.actor ?? (e.actorType === 'system' ? L('owner.logSystem') : e.actorType)} · ${when(e.at, lang)}`} />)}
      </ul>
      <p className={s.muted} style={{ margin: '10px 4px 0' }}>{L('owner.logKeep')}</p>
    </>
  );
}
