'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { formatEthiopianDate, type Lang as CalLang } from '@temelash/ethiopian-calendar';
import { t, type Lang, type MessageKey } from '@temelash/i18n';
import { ApiFailure, authed } from '@temelash/ui';
import { DateTime, Look, Poster, Security, formatDay, formatWhen, logText, setPrefs, type Prefs } from './owner-more';
import { IC, Icon, Row, useLoad, type Lfn } from './owner-ui';
import { AlertSettings, Unusual, alertSub } from './owner-safety';
import { StandCart, StandOrderScreen, StandOrders, StandPlaced, StandRows, Stands, type Cart } from './owner-stands';
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
  | { name: 'look' } | { name: 'poster' } | { name: 'security' } | { name: 'datetime' } | { name: 'plan' }
  | { name: 'inbox' } | { name: 'msg'; id: string } | { name: 'myreq' } | { name: 'news' } | { name: 'compose' }
  | { name: 'stands' } | { name: 'standcart' } | { name: 'standplaced'; id: string } | { name: 'standorders' } | { name: 'standorder'; id: string }
  | { name: 'alert'; id: string } | { name: 'alertset' };
interface Branch { id: string; name: string; address: string | null; hours: Record<string, string[][]>; status: string }
interface Person { id: string; name: string; phone: string; role: string; hourlyLimit: number | null; branches: string[]; locked: boolean; pinDaysLeft: number | null }
interface Rules { version: number; stampsNeeded: number; ladder: Array<{ tier: number; at: number; reward: string }>; gapHours: number; rewardValidDays: number; hourlyLimit: number | null; handTyped: 'review' | 'allow' | 'off'; pinDays: number }

const EAT = 'Africa/Addis_Ababa';
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const when = (iso: string | null, lang: Lang) => (iso ? formatWhen(iso, lang) : '');

export function OwnerApp({ lang, me, onSignOut, onLang }: { lang: Lang; me: { actorType: string; businessId: string | null; name?: string | null; phone?: string | null }; onSignOut: () => void; onLang: (l: Lang) => void }) {
  const L = useCallback((k: string, v?: Record<string, string | number>, n?: number) => t(lang, k as MessageKey, v, n), [lang]);
  const isMgr = me.actorType === 'manager';
  const [stack, setStack] = useState<Screen[]>([{ name: 'today' }]);
  const [menu, setMenu] = useState(false);
  const [toast, setToast] = useState('');
  const [branch, setBranch] = useState<string>('');
  const [cart, setCart] = useState<Cart>({});
  const [, setPrefsLoaded] = useState(0);
  useEffect(() => {
    authed<Prefs>('owner', 'GET', '/owner/prefs').then((p) => { setPrefs(p); setPrefsLoaded((n) => n + 1); }).catch(() => {});
  }, []);
  const shop = useLoad<{ name: string; shopCode: string }>('/owner/shop');
  const branches = useLoad<Branch[]>('/owner/branches');
  // Unread messages from Temelash, for the menu (owners only).
  const inboxCount = useLoad<{ unread: number }>(isMgr ? null : '/owner/inbox');
  const cur = stack[stack.length - 1];
  const go = (sc: Screen) => setStack([...stack, sc]);
  const back = () => setStack(stack.length > 1 ? stack.slice(0, -1) : stack);
  const tab = (sc: Screen) => setStack([sc]);
  const q = branch ? `branchId=${branch}` : '';
  const today = useLoad<{ attention: { pendingApprovals: number; toCheck: number; locked: Array<{ id: string; name: string }>; pinsExpiringSoon: Array<{ id: string; name: string; daysLeft: number }>; standsWaiting: Array<{ id: string; code: string }>; unusual: Array<{ id: string; kind: string; staff: string | null }> }; today: { stamps: number; rewards: number }; killSwitch?: { on: boolean; message: string } }>(`/owner/today?${q}`);
  const attnCount = today.data ? today.data.attention.pendingApprovals + today.data.attention.toCheck + today.data.attention.locked.length + (today.data.attention.standsWaiting?.length ?? 0) + (today.data.attention.unusual?.length ?? 0) : 0;

  // The menu closes with Escape too (a dialog must be closable from the keyboard).
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menu]);

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
          {today.data?.killSwitch?.on && <p className={s.killNote} role="alert">{today.data.killSwitch.message}</p>}
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
                {(a.unusual ?? []).map((u) => <Row key={u.id} icon="M12 3l10 18H2zM12 10v5M12 18h.01" title={L('owner.attnUnusual')} sub={alertSub(L, u)} onClick={() => go({ name: 'alert', id: u.id })} />)}
                {a.pendingApprovals > 0 && <Row icon={IC.clock} title={L('owner.attnAppr', { a: a.pendingApprovals }, a.pendingApprovals)} sub={L('owner.attnApprSub')} onClick={() => go({ name: 'review', tab: 'appr' })} />}
                {a.toCheck > 0 && <Row icon={IC.hand} title={L('owner.attnHand', { a: a.toCheck }, a.toCheck)} sub={L('owner.attnHandSub')} onClick={() => go({ name: 'review', tab: 'hand' })} />}
                {a.locked.map((p) => <Row key={p.id} icon={IC.lock} title={L('owner.attnLocked', { a: p.name })} sub={L('owner.attnLockedSub')} onClick={() => go({ name: 'person', id: p.id })} />)}
                {(a.standsWaiting ?? []).map((o) => <Row key={o.id} icon={IC.store} title={L('owner.attnStand')} sub={L('owner.attnStandSub', { a: o.code })} onClick={() => go({ name: 'standorder', id: o.id })} />)}
                {a.pinsExpiringSoon.length > 0 && <Row icon={IC.lock} title={L('owner.attnPin', { a: a.pinsExpiringSoon.length }, a.pinsExpiringSoon.length)} sub={a.pinsExpiringSoon.map((p) => p.name).join(', ')} onClick={() => tab({ name: 'team' })} />}
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
          <Row title={L('owner.shBranches')} sub={L('owner.shBranchesSub', { a: branches.data?.length ?? 0 }, branches.data?.length ?? 0)} onClick={() => go({ name: 'branches' })} />
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
    poster: () => <><Poster L={L} shop={shop.data} />{!isMgr && <StandRows L={L} onOrder={() => go({ name: 'stands' })} onOrders={() => go({ name: 'standorders' })} />}</>,
    stands: () => <Stands L={L} lang={lang} cart={cart} setCart={setCart} onReview={() => go({ name: 'standcart' })} onToast={setToast} />,
    standcart: () => <StandCart L={L} lang={lang} cart={cart} onToast={setToast} onPlaced={(o) => { setCart({}); setStack([...stack.slice(0, -2), { name: 'standplaced', id: o.id }]); }} />,
    standplaced: () => <StandPlaced L={L} lang={lang} id={(cur as { id: string }).id} onOrders={() => setStack([...stack.slice(0, -1), { name: 'standorders' }])} onPoster={back} />,
    standorders: () => <StandOrders L={L} lang={lang} onOpen={(id) => go({ name: 'standorder', id })} />,
    alert: () => <Unusual L={L} lang={lang} isMgr={isMgr} id={(cur as { id: string }).id} onReview={() => go({ name: 'review', tab: 'hand' })} onPerson={(id) => go({ name: 'person', id })} onDone={(m) => { setToast(m); today.reload(); back(); }} />,
    alertset: () => <AlertSettings L={L} onSaved={(m) => { setToast(m); back(); }} />,
    standorder: () => <StandOrderScreen L={L} lang={lang} id={(cur as { id: string }).id} onToast={setToast} onChanged={today.reload} />,
    security: () => <Security L={L} onSaved={setToast} />,
    datetime: () => <DateTime L={L} lang={lang} onSaved={(m) => { setToast(m); back(); }} />,
    plan: () => <PlanScreen L={L} lang={lang} />,
    inbox: () => <Inbox L={L} lang={lang} onOpen={(id) => go({ name: 'msg', id })} />,
    msg: () => <MessageScreen L={L} lang={lang} id={(cur as { id: string }).id} onPlan={() => go({ name: 'plan' })} onOrder={(id) => go({ name: 'standorder', id })} onRead={inboxCount.reload} />,
    myreq: () => <MyRequests L={L} lang={lang} onOrder={(id) => go({ name: 'standorder', id })} />,
    news: () => <News L={L} lang={lang} onWrite={() => go({ name: 'compose' })} />,
    compose: () => <Compose L={L} shopName={shop.data?.name ?? ''} onDone={back} />,
  };

  const titles: Partial<Record<Screen['name'], string>> = {
    review: L('owner.attnLbl'), customer: L('owner.tabCustomers'), person: L('owner.tabTeam'), addPerson: L('owner.addPerson'),
    card: L('owner.shCard'), rules: L('owner.shRules'), branches: L('owner.shBranches'), branch: L('owner.shBranches'),
    details: L('owner.shDetails'), reports: L('owner.mnReports'), log: L('owner.mnLog'),
    look: L('owner.shLook'), poster: L('owner.shPoster'), security: L('owner.mnSecurity'), datetime: L('owner.mnDateTime'), plan: L('owner.ttl_plan'), inbox: L('owner.ttl_inbox'), msg: L('owner.ttl_msg'), myreq: L('owner.ttl_myreq'), news: L('owner.ttl_news'), compose: L('owner.ttl_compose'),
    stands: L('owner.ttl_stands'), standcart: L('owner.ttl_standcart'), standplaced: L('owner.ttl_standplaced'), standorders: L('owner.ttl_standorders'), standorder: L('owner.ttl_standorder'), alert: L('owner.ttl_alert'), alertset: L('owner.ttl_alertset'),
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
        <div className={`${s.menuWrap} tc-fade`}>
          <button type="button" className={s.menuDim} aria-label={L('owner.closeMenu')} onClick={() => setMenu(false)} />
          {/* Owner board menu: title and close, who is signed in with Sign out, the rows, then language. */}
          <div className={`${s.menu} tc-panel-work`} role="dialog" aria-modal="true" aria-label={L('owner.menuAria')}>
            <div className={s.menuHdr}>
              <h2 className={s.menuTitle}>{L('owner.menuAria')}</h2>
              <button type="button" className={s.iconBtn} style={{ marginRight: -10 }} aria-label={L('owner.closeMenu')} onClick={() => setMenu(false)} autoFocus><Icon d={IC.x} /></button>
            </div>
            <div className={s.menuMe}>
              <div style={{ minWidth: 0 }}>
                <div className={s.menuName}>{me.name ?? ''}</div>
                <div className={s.menuSub}>{isMgr ? L('owner.roManager') : L('owner.roOwner')}</div>
                <div className={s.menuSub} style={{ marginTop: 2 }}>{me.phone ?? ''}</div>
              </div>
              <button type="button" className={s.menuOut} onClick={onSignOut}><Icon d={IC.out} size={16} color="#444" /><span>{L('owner.signOut')}</span></button>
            </div>
            <ul className={`${s.menuRows} ${s.rows}`}>
              <Row icon={IC.chart} title={L('owner.mnReports')} sub={L('owner.mnReportsSub')} onClick={() => { setMenu(false); go({ name: 'reports' }); }} />
              {!isMgr && <Row icon={IC.card} title={L('owner.mnPlan')} sub={L('owner.mnPlanSub')} onClick={() => { setMenu(false); go({ name: 'plan' }); }} />}
              {!isMgr && <Row icon={IC.mega} title={L('owner.mnInbox')} sub={inboxCount.data?.unread ? L('owner.mnInboxSub', { a: inboxCount.data.unread }) : undefined} onClick={() => { setMenu(false); go({ name: 'inbox' }); }} right={inboxCount.data?.unread ? <span className={s.badge}>{inboxCount.data.unread}</span> : undefined} />}
              {!isMgr && <Row icon={IC.log} title={L('owner.mnMyReq')} sub={L('owner.mnMyReqSub')} onClick={() => { setMenu(false); go({ name: 'myreq' }); }} />}
              {!isMgr && <Row icon={IC.mega} title={L('owner.mnNews')} sub={L('owner.mnNewsSub')} onClick={() => { setMenu(false); go({ name: 'news' }); }} />}
              <Row icon={IC.log} title={L('owner.mnLog')} sub={L('owner.mnLogSub')} onClick={() => { setMenu(false); go({ name: 'log' }); }} />
              <Row icon="M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9zM10 20a2 2 0 0 0 4 0" title={L('owner.mnAlerts')} sub={L('owner.mnAlertsSub')} onClick={() => { setMenu(false); go({ name: 'alertset' }); }} />
              <Row icon={IC.lock} title={L('owner.mnSecurity')} sub={L('owner.mnSecuritySub')} onClick={() => { setMenu(false); go({ name: 'security' }); }} />
              <Row icon={IC.clock} title={L('owner.mnDateTime')} onClick={() => { setMenu(false); go({ name: 'datetime' }); }} />
            </ul>
            <div className={s.menuLang}>{L('owner.langLbl')}</div>
            <div className={s.chips} style={{ marginTop: 0 }}>
              {(['en', 'am', 'om'] as Lang[]).map((l) => <button key={l} type="button" className={s.chip} aria-pressed={lang === l} onClick={() => onLang(l)}>{{ en: 'English', am: 'አማርኛ', om: 'Afaan Oromoo' }[l]}</button>)}
            </div>
          </div>
        </div>
      )}
      {toast && <div className={`${s.toast} tc-fade`} role="status">{toast}</div>}
    </main>
  );
}

// ---------------------------------------------------------------- shared pieces

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
      <p className={s.muted} style={{ marginTop: 10 }}>{list.data ? (list.data.length ? L('owner.custShowing', { a: list.data.length }, list.data.length) : '') : ''}</p>
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
  const btn = { add: L('owner.fxBtnAdd', { a: count }, count), remove: L('owner.fxBtnRemove', { a: count }, count), undo: L('owner.fxBtnUndo'), extend: L('owner.fxBtnExtend', { a: days }), pause: L('owner.fixPause'), resume: L('owner.fixResume') }[kind];
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
            <div className={s.chips} style={{ marginTop: 0 }}>{[7, 14, 30].map((n) => <button key={n} type="button" className={s.chip} aria-pressed={days === n} onClick={() => setDays(n)}>{L('owner.daysN', { a: n }, n)}</button>)}</div>
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
        <div className={s.rowSub}>{p.hourlyLimit ? L('owner.sdLimOwn', { a: p.hourlyLimit }, p.hourlyLimit) : ''}</div>
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
      {/* OwnCard: "Card is full at" with a − / + stepper, 3 to 20 stamps. */}
      <div className={s.stepRow}>
        <span className={s.stepLabel}>{L('owner.cdFull')}</span>
        <span className={s.stepper}>
          <button type="button" className={s.stepBtn} aria-label="-" disabled={full <= 3} onClick={() => setFull((n) => Math.max(3, (n ?? 8) - 1))}><Icon d="M5 12h14" size={20} /></button>
          <span className={s.stepVal}>{full} <span className={s.stepUnit}>{L('owner.stampsUnit')}</span></span>
          <button type="button" className={s.stepBtn} aria-label="+" disabled={full >= 20} onClick={() => setFull((n) => Math.min(20, (n ?? 8) + 1))}><Icon d="M12 5v14M5 12h14" size={20} /></button>
        </span>
      </div>
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
      <button type="button" className={s.cta} disabled={!main || (!!early && (!early.reward || early.at >= full))} onClick={save}>{L('owner.save')}</button>
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
      {chips('gapHours', [1, 2, 4, 8, 24].map((n) => [n, L('owner.hoursN', { a: n }, n)]))}
      <p className={s.muted}>{L('owner.crGapHelp')}</p>
      <div className={s.label}>{L('owner.crValidLbl')}</div>
      {chips('rewardValidDays', [7, 14, 30, 60, 90].map((n) => [n, L('owner.daysN', { a: n }, n)]))}
      <div className={s.label}>{L('owner.ruLimitLbl')}</div>
      {chips('hourlyLimit', [20, 30, 40, 60].map((n) => [n, String(n)]))}
      <p className={s.muted}>{L('owner.ruOver')}</p>
      <div className={s.label}>{L('owner.ruHandLbl')}</div>
      {chips('handTyped', [['review', L('owner.hnReview')], ['allow', L('owner.hnAllow')], ['off', L('owner.hnOff')]])}
      <div className={s.label}>{L('owner.ruPinLbl')}</div>
      {chips('pinDays', [0, 60, 90, 180].map((n) => [n, n ? L('owner.pxDays', { a: n }, n) : L('owner.pxNever')]))}
      <p className={s.muted}>{v.pinDays ? L('owner.ruPinHelp') : L('owner.ruPinHelpNever')}</p>
      {/* A new business names its reward on the card screen first; rules alone cannot make a card. */}
      <button type="button" className={s.cta} disabled={!v.ladder.length} onClick={async () => { await authed('owner', 'POST', '/owner/rules', v); onSaved(L('owner.savedCardRules')); }}>{L('owner.save')}</button>
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
      <div className={s.chips}>{[7, 14, 30].map((n) => <button key={n} type="button" className={s.chip} aria-pressed={days === n} onClick={() => setDays(n)}>{L('owner.daysN', { a: n }, n)}</button>)}</div>
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

// ---------------------------------------------------------------- OwnPlan* (owners only)
interface PlanData {
  financeYear: number; status: string; trialEndsAt: string | null; plan: string | null; branches: number | null; fee: number; paid: number; balance: number;
  dueOn: string | null; billing: string; coversUntil: string | null; payments: Array<{ receiptNo: string; amount: number; method: string; reference: string | null; at: string }>;
}
function PlanScreen({ L, lang }: { L: Lfn; lang: Lang }) {
  const p = useLoad<PlanData>('/owner/plan');
  if (!p.data) return null;
  const d = p.data;
  const birr = (n: number) => L('owner.birr', { a: n.toLocaleString('en-US') });
  const day = (iso: string) => formatDay(new Date(iso.length === 10 ? iso + 'T12:00:00+03:00' : iso), lang);
  const eth = (fy: number, m: number, dd: number) => formatEthiopianDate({ year: fy, month: m, day: dd }, lang as CalLang);
  const paid = d.billing === 'paid' || d.billing === 'pilot';
  const trial = d.billing === 'btrial' && d.trialEndsAt;
  const daysLeft = trial ? Math.max(0, Math.ceil((Date.parse(d.trialEndsAt!) - Date.now()) / 86_400_000)) : 0;
  const title = paid ? L('owner.plPaidT') : trial ? L('owner.plTrialT', { a: daysLeft }) : L('owner.plDueT');
  const text = paid ? (d.coversUntil ? L('owner.plCovers', { a: day(d.coversUntil) }) : '') : trial ? L('owner.plTrialText', { a: day(d.trialEndsAt!), b: birr(d.fee) }) : L('owner.plDueText', { a: birr(d.balance), b: d.dueOn ? day(d.dueOn) : '' });
  const planName = d.plan === 'full' ? L('owner.plFull') : d.plan === 'starter' ? L('owner.plStarter') : L('owner.plPilot');
  const method = (m: string) => ({ telebirr: L('owner.soTele'), cbe_birr: L('owner.payCbe'), cash: L('owner.soCash'), bank: L('owner.payBank') }[m] ?? m);
  const rows: Array<[string, string]> = [[L('owner.plPlanK'), planName], [L('owner.plBrK'), L('owner.plBr', { a: d.branches ?? 1 }, d.branches ?? 1)], [L('owner.plPriceK'), birr(d.fee)], [L('owner.plPaidK'), birr(d.paid)], [L('owner.plBalK'), birr(d.balance)]];
  return (
    <>
      <div style={{ marginTop: 14, textAlign: 'center' }}>
        <div className={s.planIcon}><Icon d={paid ? IC.check : IC.clock} size={36} color="#333" /></div>
        <h1 className={s.planTitle}>{title}</h1>
        <p className={s.help}>{text}</p>
      </div>
      <div className={s.kvCard} style={{ marginTop: 16 }}>{rows.map(([k, v]) => <div key={k} className={s.kvLine}><span style={{ color: '#444' }}>{k}</span><span style={{ fontWeight: 700, color: '#333', textAlign: 'right' }}>{v}</span></div>)}</div>
      {paid && d.plan !== 'pilot' && (
        <>
          <div className={s.section}>{L('owner.plNextLbl')}</div>
          <div className={`${s.card} ${s.pad}`} style={{ marginTop: 0 }}>
            <p style={{ margin: 0, fontSize: 14, lineHeight: '20px', color: '#333' }}>{L('owner.plNextText', { a: eth(d.financeYear, 9, 1), b: eth(d.financeYear, 11, 1), c: eth(d.financeYear + 1, 10, 30) })}</p>
          </div>
        </>
      )}
      <div className={s.section}>{L('owner.plHistLbl')}</div>
      {d.payments.length ? (
        <div className={s.kvCard}>{d.payments.map((x) => <div key={x.receiptNo} className={s.kvLine}><span style={{ color: '#444' }}>{day(x.at)} · {method(x.method)}</span><span style={{ fontWeight: 700, color: '#333', textAlign: 'right' }}>{birr(x.amount)}</span></div>)}</div>
      ) : <p style={{ margin: 0, fontSize: 13, lineHeight: '18px', color: '#555' }}>{L('owner.plNoPay')}</p>}
      <div className={`${s.card}`} style={{ marginTop: 18, padding: 14 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <Icon d={IC.info} size={22} color="#444" />
          <div><div style={{ fontSize: 14, fontWeight: 700, color: '#333' }}>{L('owner.plHowT')}</div><p style={{ margin: '3px 0 0', fontSize: 13, lineHeight: '18px', color: '#555' }}>{L('owner.plHowText')}</p></div>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- OwnInbox, OwnMessage, OwnMyRequests, OwnNews* (owners only)
interface InboxMsg { id: string; title: string; body: string; at: string; action: 'plan' | 'standorder' | null; actionRef: string | null; unread?: boolean }
function Inbox({ L, lang, onOpen }: { L: Lfn; lang: Lang; onOpen: (id: string) => void }) {
  const r = useLoad<{ unread: number; messages: InboxMsg[] }>('/owner/inbox');
  if (!r.data) return null;
  return (
    <>
      <p className={s.help}>{L('owner.ibHelp')}</p>
      {r.data.messages.length === 0 && <p className={s.muted} style={{ marginTop: 12 }}>{L('owner.ibEmpty')}</p>}
      {r.data.messages.length > 0 && (
        <ul className={`${s.card} ${s.rows}`}>
          {r.data.messages.map((m) => <Row key={m.id} icon={IC.mega} title={m.title} sub={formatWhen(new Date(m.at), lang)} onClick={() => onOpen(m.id)} right={m.unread ? <span className={s.newTag}>{L('owner.ibNew')}</span> : undefined} />)}
        </ul>
      )}
    </>
  );
}

function MessageScreen({ L, lang, id, onPlan, onOrder, onRead }: { L: Lfn; lang: Lang; id: string; onPlan: () => void; onOrder: (id: string) => void; onRead: () => void }) {
  const r = useLoad<InboxMsg>(`/owner/inbox/${id}`);
  useEffect(() => { if (r.data) onRead(); }, [r.data, onRead]);
  if (!r.data) return null;
  return (
    <>
      <div style={{ marginTop: 6, fontSize: 13, color: '#595959' }}>{formatDay(new Date(r.data.at), lang)}</div>
      <h1 className={s.msgTitle}>{r.data.title}</h1>
      <div className={`${s.card} ${s.pad}`}><p style={{ margin: 0, fontSize: 15, lineHeight: '22px', color: '#333', whiteSpace: 'pre-wrap' }}>{r.data.body}</p></div>
      {r.data.action === 'plan' && <button type="button" className={s.cta} style={{ marginTop: 18 }} onClick={onPlan}>{L('owner.mnPlan')}</button>}
      {r.data.action === 'standorder' && r.data.actionRef && <button type="button" className={s.cta} style={{ marginTop: 18 }} onClick={() => onOrder(r.data!.actionRef!)}>{L('owner.soSeeOrder')}</button>}
    </>
  );
}

const REQ_TITLE: Record<string, string> = { closing: 'owner.mrCloseT', lost_phone: 'owner.mrLostT', deletion: 'owner.mrDelT', privacy: 'owner.mrDelT', stand_order: 'owner.mrStandT' };
function MyRequests({ L, lang, onOrder }: { L: Lfn; lang: Lang; onOrder: (id: string) => void }) {
  const r = useLoad<Array<{ id: string; type: string; createdAt: string; status: 'waiting' | 'progress' | 'done'; payload: Record<string, unknown> }>>('/owner/requests');
  if (!r.data) return null;
  const st = { waiting: 'owner.mrWait', progress: 'owner.mrWork', done: 'owner.mrOk' } as const;
  return (
    <>
      <p className={s.help}>{L('owner.mrHelp')}</p>
      {r.data.length === 0 && <p className={s.muted} style={{ marginTop: 12 }}>{L('owner.mrEmpty')}</p>}
      {r.data.length > 0 && (
        <ul className={`${s.card} ${s.rows}`}>
          {r.data.map((q) => <Row key={q.id} icon={IC.log} title={L(REQ_TITLE[q.type] ?? 'owner.mrCloseT', { a: String(q.payload.code ?? '') })} sub={formatWhen(new Date(q.createdAt), lang)} onClick={q.type === 'stand_order' && typeof q.payload.orderId === 'string' ? () => onOrder(q.payload.orderId as string) : undefined} right={<span className={q.status === 'done' ? s.muted : s.newTag}>{L(st[q.status])}</span>} />)}
        </ul>
      )}
    </>
  );
}

interface NewsState { perWeek: number; left: number; audience: { all: number; near: number; quiet: number }; past: Array<{ id: string; audience: string; texts: Record<string, { title: string; body: string }>; recipients: number; at: string }> }
const AUD_KEY = { all: 'owner.audAll', near: 'owner.audNear', quiet: 'owner.audQuiet' } as const;
function News({ L, lang, onWrite }: { L: Lfn; lang: Lang; onWrite: () => void }) {
  const r = useLoad<NewsState>('/owner/news');
  const [toast, setToast] = useState('');
  if (!r.data) return null;
  const n = r.data;
  const pick = (x: NewsState['past'][number]) => x.texts[lang] ?? x.texts.en;
  return (
    <>
      <p className={s.help}>{L('owner.nwHelp')}</p>
      <div className={`${s.card} ${s.pad}`} style={{ marginTop: 14 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#333' }}>{n.left > 0 ? L('owner.nwLeft', { a: n.left }) : L('owner.nwNone')}</div>
        <div style={{ marginTop: 2, fontSize: 13, lineHeight: '18px', color: '#555' }}>{n.left > 0 ? L('owner.nwLeftS') : L('owner.nwNoneS')}</div>
        <button type="button" className={s.cta} style={{ marginTop: 12, background: n.left > 0 ? '#333' : '#c9c9c9', color: n.left > 0 ? '#fff' : '#444' }} onClick={() => (n.left > 0 ? onWrite() : setToast(L('owner.nwNoneToast')))}>{L('owner.nwWrite')}</button>
        {toast && <p className={s.muted} role="status" style={{ marginTop: 8 }}>{toast}</p>}
      </div>
      <div className={s.section}>{L('owner.nwPast')}</div>
      {n.past.length === 0 && <p className={s.muted} style={{ marginTop: 8 }}>{L('owner.nwPastEmpty')}</p>}
      {n.past.map((x) => (
        <div key={x.id} className={s.card} style={{ marginTop: 8, padding: 14 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#333' }}>{pick(x).title}</div>
          <div style={{ marginTop: 2, fontSize: 14, lineHeight: '20px', color: '#444' }}>{pick(x).body}</div>
          <div style={{ marginTop: 6, fontSize: 13, color: '#595959' }}>{L('owner.nwSentLine', { a: formatWhen(new Date(x.at), lang), b: x.recipients })}</div>
        </div>
      ))}
      <div className={s.section} style={{ marginTop: 22 }}>{L('owner.nwAuto')}</div>
      <div className={s.kvCard}>
        {(['am1', 'am2', 'am3'] as const).map((k) => (
          <div key={k} className={s.kvLine} style={{ display: 'block' }}>
            <div style={{ fontSize: 14, lineHeight: '20px', fontWeight: 700, color: '#333' }}>{L(`owner.${k}`)}</div>
            <div style={{ fontSize: 13, lineHeight: '18px', color: '#555' }}>{L(`owner.${k}s`)}</div>
          </div>
        ))}
      </div>
      <p className={s.muted} style={{ margin: '12px 0 0' }}>{L('owner.nwConsent')}</p>
    </>
  );
}

/** OwnNewsCompose, OwnNewsPreview, OwnNewsSent: write in each language (English required), check, send. */
function Compose({ L, shopName, onDone }: { L: Lfn; shopName: string; onDone: () => void }) {
  const r = useLoad<NewsState>('/owner/news');
  const [aud, setAud] = useState<'all' | 'near' | 'quiet'>('all');
  const [wl, setWl] = useState<Lang>('en');
  const [texts, setTexts] = useState<Record<Lang, { title: string; body: string }>>({ en: { title: '', body: '' }, am: { title: '', body: '' }, om: { title: '', body: '' } });
  const [step, setStep] = useState<'write' | 'check' | 'sent'>('write');
  const [err, setErr] = useState<{ t?: boolean; b?: boolean }>({});
  const [sentN, setSentN] = useState(0);
  const [busy, setBusy] = useState(false);
  if (!r.data) return null;
  const n = r.data;
  const names: Record<Lang, string> = { en: 'English', am: 'አማርኛ', om: 'Afaan Oromoo' };
  const cur = texts[wl];
  const set = (k: 'title' | 'body', v: string) => setTexts((x) => ({ ...x, [wl]: { ...x[wl], [k]: v } }));
  const own = (l: Lang) => !!texts[l].title.trim() && !!texts[l].body.trim();
  const count = n.audience[aud];
  if (step === 'sent') {
    return (
      <>
        <div style={{ marginTop: 22, textAlign: 'center' }}>
          <div className={`${s.sentIcon} tc-slam-work`}><Icon d={IC.check} size={40} color="#fff" /></div>
          <h1 className={s.sentTitle}>{L('owner.nsTitle')}</h1>
          <p style={{ margin: '8px 0 0', fontSize: 15, lineHeight: '22px', color: '#444' }}>{L('owner.nsSub', { a: sentN })}</p>
        </div>
        <button type="button" className={s.cta} style={{ marginTop: 24 }} onClick={onDone}>{L('owner.done')}</button>
      </>
    );
  }
  if (step === 'check') {
    const send = async () => {
      setBusy(true);
      try {
        const body = Object.fromEntries((['en', 'am', 'om'] as Lang[]).filter(own).map((l) => [l, { title: texts[l].title.trim(), body: texts[l].body.trim() }]));
        const res = await authed<{ recipients: number }>('owner', 'POST', '/owner/news', { audience: aud, texts: body });
        setSentN(res.recipients);
        setStep('sent');
      } finally {
        setBusy(false);
      }
    };
    const rows: Array<[string, string]> = [[L('owner.npTo'), L(AUD_KEY[aud])], [L('owner.npCount'), String(count)], [L('owner.npLeft'), L('owner.npLeftV', { a: Math.max(0, n.left - 1) })]];
    return (
      <>
        <h1 style={{ margin: '4px 0 0', fontSize: 18, fontWeight: 700, color: '#333' }}>{L('owner.npTitle')}</h1>
        <p className={s.help}>{L('owner.npHelp')}</p>
        <div className={s.kvCard} style={{ marginTop: 12 }}>
          {rows.map(([k, v]) => <div key={k} className={s.kvLine}><span style={{ color: '#444' }}>{k}</span><span style={{ fontWeight: 700, color: '#333', textAlign: 'right' }}>{v}</span></div>)}
        </div>
        <div className={s.section}>{L('owner.nwPreview')}</div>
        {(['en', 'am', 'om'] as Lang[]).map((l) => (
          <div key={l} className={s.card} style={{ marginTop: 8, padding: 14, borderRadius: 12 }}>
            <div style={{ fontSize: 13, letterSpacing: 0.6, color: '#595959' }}>{names[l]}</div>
            <div style={{ marginTop: 4, fontSize: 15, fontWeight: 700, color: '#333' }}>{(own(l) ? texts[l] : texts.en).title}</div>
            <div style={{ marginTop: 2, fontSize: 14, lineHeight: '20px', color: '#444' }}>{(own(l) ? texts[l] : texts.en).body}</div>
            <div style={{ marginTop: 6, fontSize: 13, color: '#555' }}>{own(l) ? L('owner.npOwn') : L('owner.npFallback')}</div>
          </div>
        ))}
        <p className={s.muted} style={{ margin: '14px 0 0' }}>{L('owner.npCannotUndo')}</p>
        <button type="button" className={s.cta} style={{ marginTop: 18 }} aria-busy={busy} disabled={busy} onClick={send}>{L('owner.npSend', { a: count })}</button>
      </>
    );
  }
  const review = () => {
    const e = { t: !texts.en.title.trim(), b: !texts.en.body.trim() };
    if (e.t || e.b) { setErr(e); setWl('en'); return; }
    setErr({});
    setStep('check');
  };
  return (
    <>
      <div className={s.section} style={{ marginTop: 6 }}>{L('owner.nwAudience')}</div>
      <div className={s.chips} style={{ marginTop: 0 }}>{(['all', 'near', 'quiet'] as const).map((a) => <button key={a} type="button" className={s.chip} aria-pressed={aud === a} onClick={() => setAud(a)}>{L(AUD_KEY[a])}</button>)}</div>
      <p style={{ margin: '8px 0 0', fontSize: 14, lineHeight: '20px', color: '#444' }}>{aud === 'quiet' ? L('owner.audCountQuiet', { a: count }) : L('owner.audCount', { a: count })}</p>
      <div className={s.section} style={{ marginTop: 18 }}>{L('owner.cdLangLbl')}</div>
      <div className={s.chips} style={{ marginTop: 0 }}>{(['en', 'am', 'om'] as Lang[]).map((l) => <button key={l} type="button" className={s.chip} aria-pressed={wl === l} onClick={() => setWl(l)}>{names[l]}</button>)}</div>
      <p className={s.muted} style={{ margin: '8px 0 0' }}>{wl !== 'en' && !own(wl) ? L('owner.fallbackNote', { a: names[wl] }) : L('owner.fallbackOk')}</p>
      <label htmlFor="f_ntitle" className={s.fieldLbl}>{L('owner.nwTitleLbl')}</label>
      <input id="f_ntitle" type="text" className={s.input} maxLength={40} autoComplete="off" value={cur.title} onChange={(e) => set('title', e.target.value)} />
      {err.t && wl === 'en' && <p role="alert" className={s.alert}>{L('owner.ncNeedTitle')}</p>}
      <label htmlFor="f_nbody" className={s.fieldLbl}>{L('owner.nwBodyLbl')}</label>
      <textarea id="f_nbody" rows={4} maxLength={140} className={s.textarea} value={cur.body} onChange={(e) => set('body', e.target.value)} />
      <p style={{ margin: '4px 4px 0', textAlign: 'right', fontSize: 13, color: '#595959' }}>{cur.body.length} / 140</p>
      {err.b && wl === 'en' && <p role="alert" className={s.alert}>{L('owner.ncNeedBody')}</p>}
      <div className={s.section} style={{ marginTop: 12 }}>{L('owner.nwPreview')}</div>
      <div className={s.card} style={{ marginTop: 0, padding: 14, borderRadius: 12 }}>
        <div style={{ fontSize: 13, color: '#595959' }}>{L('owner.nwFrom', { a: shopName })}</div>
        <div style={{ marginTop: 2, fontSize: 15, fontWeight: 700, color: '#333' }}>{cur.title.trim() || texts.en.title.trim() || L('owner.nwNoTitle')}</div>
        <div style={{ marginTop: 2, fontSize: 14, lineHeight: '20px', color: '#444' }}>{cur.body.trim() || texts.en.body.trim() || L('owner.nwNoBody')}</div>
      </div>
      <button type="button" className={s.cta} style={{ marginTop: 18 }} onClick={review}>{L('owner.nwReview')}</button>
    </>
  );
}
