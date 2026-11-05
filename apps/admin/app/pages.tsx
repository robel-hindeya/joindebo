'use client';

import { useMemo, useState } from 'react';
import { authed } from '@temelash/ui';
import {
  A, Bars, Check, Cols, GREY, Head, Input, Kv, List, Note, Page, RED, SetBlock, Stats, Table, Timeline, Tool,
  birr, failText, fd, fdy, ft, rel, signal401, useLoad, type Ctx, type Row, type View,
} from './ui';
import { BusinessFinance, exportButton } from './money';
import { messageOwner } from './messages';
import { StandRequest } from './stands';
import { AccountSecurity, PayAccounts, RecoveryWaiting, SupportContacts } from './account';
import { FollowUpsDue, SupportTab } from './support';

/** Admin board pages for Phase 4: Overview, Businesses, a business, Requests, Activity log, Settings. */

type Role = 'owner' | 'finance' | 'support';
const post = (path: string, body: object = {}) => authed('admin', 'POST', '/admin' + path, body).catch((e) => { signal401(e); throw e; });
/** Run an action; on refusal the dialog stays open with the reason. */
async function act(fn: () => Promise<unknown>) {
  try { await fn(); } catch (e) { throw new Error(failText(e)); }
}

const CAT: Record<string, string> = { cafe: 'catCafe', salon: 'catSalon', spa: 'catSpa', restaurant: 'catRestaurant', car_wash: 'catCarWash', barber: 'catBarber', bakery: 'catBakery', food: 'catFood', other: 'catOther' };
const cat = (c: string) => A(CAT[c] ?? 'catOther');
const TYPES: Array<[string, string, string]> = [['signup', 'tSignup', 'lSignup'], ['closing', 'tClosing', 'lClosing'], ['lost_phone', 'tLost', 'lLost'], ['deletion', 'tDeletion', 'lDeletion'], ['stand_order', 'tStand', 'lStand'], ['flag', 'tFlag', 'lFlag'], ['help', 'tHelp', 'lHelp']];
const typeL = (t: string) => A(TYPES.find((x) => x[0] === t)?.[2] ?? 'lPrivacy');
const roleL = (r: string) => A(r === 'owner' ? 'roleOwner' : r === 'finance' ? 'roleFinance' : 'roleSupport');
const planL = (p: string | null) => A(p === 'pilot' ? 'planPilot' : p === 'starter' ? 'planStarter' : p === 'full' ? 'planFull' : 'planNone');
const shortId = (id: string) => '#' + id.slice(0, 6).toUpperCase();
/** Payment column (money comes with Phase 5): pilot, trial, or nothing yet. */
const payPill = (b: { status: string; plan: string | null }) => (['pending', 'rejected', 'closed'].includes(b.status) ? 'none' : b.plan === 'pilot' ? 'pilot' : b.status === 'trial' ? 'btrial' : 'none');

interface Req { id: string; type: string; stage: string; result: string | null; createdAt: string; business: string | null; businessId?: string | null; assignee?: string | null; payload?: Record<string, unknown> }
const reqPill = (r: Req) => (r.stage !== 'done' ? 'rnew' : r.result && /^rejected|^Dismissed/i.test(r.result) ? 'rdeclined' : 'rdone');
const resultL = (r: Req) => (r.result === 'approved' ? A('pDone') : r.result === 'rejected' ? A('resRejected') : r.result ?? A('pDone'));

function Loading({ error, retry }: { error: unknown; retry: () => void }) {
  return error ? <div><Note t={A('couldNotLoad')} tone="solid" /><p><button type="button" onClick={retry} style={{ marginTop: 10 }}>{A('tryAgain')}</button></p></div> : <Note t={A('loading')} tone="solid" />;
}

// ---------------------------------------------------------------- Overview
interface Overview {
  businesses: Record<string, number>; newThisWeek: number; customers: number; cards: number; stamps30d: number;
  requests: { open: number }; newPerWeek: Array<{ weekStart: string; count: number }>;
  attention: Req[]; watch: Array<{ id: string; name: string; status: string }>;
}
export function OverviewPage({ ctx }: { ctx: Ctx }) {
  const o = useLoad<Overview>('/admin/overview');
  const today = new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Addis_Ababa' }).replace(',', '');
  if (!o.data) return <Page title={A('ovTitle')}><Loading error={o.error} retry={o.reload} /></Page>;
  const b = o.data.businesses;
  const verified = b.active + b.trial + b.paused + b.closing;
  return (
    <Page title={A('ovTitle')} sub={A('ovSub', { a: today })} btns={[{ t: A('reviewRequests'), kind: 'primary', go: () => ctx.nav({ v: 'requests' }) }]}>
      <Stats cols={5} items={[
        { v: String(verified), l: A('stBiz'), s: A('stBizS', { a: o.data.newThisWeek }) },
        { v: String(b.active), l: A('stActive'), s: A('stActiveS', { a: b.trial }) },
        { v: String(o.data.requests.open), l: A('stOpen'), s: '', sc: GREY },
        { v: o.data.stamps30d.toLocaleString('en-US'), l: A('stStamps') },
        { v: o.data.customers.toLocaleString('en-US'), l: A('stClients'), s: A('stClientsS', { a: o.data.cards.toLocaleString('en-US') }, o.data.cards) },
      ]} />
      <Cols lw="1fr" rw="380px"
        left={<>
          <List title={A('attnTitle')} empty={A('attnEmpty')} more={{ t: A('seeAllRequests'), go: () => ctx.nav({ v: 'requests' }) }}
            rows={o.data.attention.map((r) => ({ t: A('reqRow', { a: typeL(r.type), b: r.business ?? '—' }), s: A('asked', { a: fd(r.createdAt) }), pill: reqPill(r), go: () => ctx.nav({ v: 'requests', id: r.id, type: r.type }) }))} />
          <FollowUpsDue ctx={ctx} />
          <List title={A('watchTitle')} empty={A('watchEmpty')}
            rows={o.data.watch.map((w) => ({ t: w.name, s: w.status === 'paused' ? A('watchPaused') : A('watchClosing'), pill: w.status, go: () => ctx.nav({ v: 'business', id: w.id }) }))} />
        </>}
        right={<>
          <Bars title={A('barsTitle')} sub={A('barsSub')} note={A('barsNote')} bars={o.data.newPerWeek.map((w, i, all) => ({ l: fd(w.weekStart + 'T12:00:00Z'), v: w.count, on: i === all.length - 1 }))} />
          <Kv title={A('byStatus')} rows={[
            { k: A('ksActive'), v: String(b.active) }, { k: A('ksTrial'), v: String(b.trial) }, { k: A('ksPending'), v: String(b.pending) },
            { k: A('ksPaused'), v: String(b.paused) }, { k: A('ksClosing'), v: String(b.closing) }, { k: A('ksClosed'), v: String(b.closed) },
          ]} />
        </>} />
    </Page>
  );
}

// ---------------------------------------------------------------- Businesses
interface BizRow { id: string; name: string; category: string; city: string; status: string; plan: string | null; createdAt: string; owner: string | null; ownerPhone: string | null; agent: string | null; customers: number; stamps30d: number; lastActive: string | null }
export function BusinessesPage({ ctx }: { ctx: Ctx }) {
  const list = useLoad<BizRow[]>('/admin/businesses');
  const [q, setQ] = useState('');
  const [st, setSt] = useState('all');
  const [ct, setCt] = useState('all');
  const [sort, setSort] = useState('new');
  const [lim, setLim] = useState(12);
  const all = list.data ?? [];
  const L = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const f = all.filter((b) => (st === 'all' || b.status === st) && (ct === 'all' || b.category === ct)
      && (!needle || `${b.name} ${b.owner ?? ''} ${b.ownerPhone ?? ''} ${b.city}`.toLowerCase().includes(needle)));
    return f.sort((a, b) => (sort === 'stamps' ? b.stamps30d - a.stamps30d : sort === 'name' ? a.name.localeCompare(b.name) : b.createdAt.localeCompare(a.createdAt)));
  }, [all, q, st, ct, sort]);
  const cnt = (s: string) => all.filter((b) => s === 'all' || b.status === s).length;
  const cats = [...new Set(all.map((b) => b.category))];
  return (
    <Page title={A('bzTitle')} sub={A('bzSub', { a: all.length }, all.length)} btns={ctx.me.role === 'owner' ? [exportButton(ctx, 'businesses', A('exBusinesses'), true)] : []}>
      <Tool search={{ value: q, onChange: (v) => { setQ(v); setLim(12); }, ph: A('bzSearch') }} groups={[
        { label: A('fStatus'), cur: st, pick: (v) => { setSt(v); setLim(12); }, opts: [{ v: 'all', l: A('allN', { a: cnt('all') }) }, ...(['active', 'trial', 'pending', 'paused', 'closing', 'closed'] as const).map((k) => ({ v: k, l: A('chipN', { a: A({ active: 'pActive', trial: 'pTrial', pending: 'pPending', paused: 'pPaused', closing: 'pClosing', closed: 'pClosed' }[k]), b: cnt(k) }) }))] },
        { label: A('fType'), cur: ct, pick: (v) => { setCt(v); setLim(12); }, opts: [{ v: 'all', l: A('allTypes') }, ...cats.map((c) => ({ v: c, l: cat(c) }))] },
        { label: A('fSort'), cur: sort, pick: setSort, opts: [{ v: 'new', l: A('sNew') }, { v: 'stamps', l: A('sStamps') }, { v: 'name', l: A('sName') }] },
      ]} />
      {list.data ? (
        <Table cols="2.1fr 1.35fr 1.15fr 1.3fr .8fr .95fr 1fr .8fr"
          heads={[{ h: A('hBusiness') }, { h: A('hStatus') }, { h: A('hPayment') }, { h: A('hAgent') }, { h: A('hCustomers'), right: true }, { h: A('hStamps30'), right: true }, { h: A('hLast') }, { h: A('hJoined') }]}
          rows={L.slice(0, lim).map((b) => ({ go: () => ctx.nav({ v: 'business', id: b.id }), cells: [
            { t: b.name, s: `${cat(b.category)}${b.city ? ' · ' + b.city : ''}`, b: true }, { pill: b.status }, { pill: payPill(b) }, { t: b.agent ?? '—' },
            { t: String(b.customers), right: true }, { t: String(b.stamps30d), right: true }, { t: rel(b.lastActive) }, { t: fd(b.createdAt) },
          ] }))}
          empty={A('bzEmpty')} more={L.length > lim ? { t: A('more12', { a: L.length - lim }), go: () => setLim(lim + 12) } : null} foot={A('showing', { a: Math.min(lim, L.length), b: L.length })} />
      ) : <Loading error={list.error} retry={list.reload} />}
    </Page>
  );
}

// ---------------------------------------------------------------- One business
interface Person { id: string; name: string; role: string; phone: string; status: string; locked: boolean; pinSetAt: string | null; lastSignIn: string | null; branches: string[] }
interface Biz {
  id: string; name: string; category: string; city: string; status: string; plan: string | null; shopCode: string; createdAt: string; agent: string | null;
  branches: Array<{ id: string; name: string; address: string | null; status?: string }>; people: Person[];
  counts: { customers: number; branches: number; staff: number; stamps30d: number; lastActive: string | null };
  requests: Req[];
}
interface CustRow { cardId: string; phone: string | null; status: string; total: number; joined: string; lastVisit: string | null; rewardsEarned: number; rewardsUsed: number; stamps: number }
interface LogRow { id: string; at: string; actorType: string; actor: string | null; type: string; text: string; detail: Record<string, unknown> | null; businessId: string | null; business: string | null }

export function BusinessPage({ ctx, view }: { ctx: Ctx; view: Extract<View, { v: 'business' }> }) {
  const b = useLoad<Biz>(`/admin/businesses/${view.id}`);
  const tab = view.tab ?? 'overview';
  const setTab = (t: NonNullable<typeof view.tab>) => ctx.nav({ ...view, tab: t, card: undefined });
  if (!b.data) return <Page title={A('bzTitle')} crumbs={[{ t: A('bzTitle'), go: () => ctx.nav({ v: 'businesses' }) }]}><Loading error={b.error} retry={b.reload} /></Page>;
  const z = b.data;
  const owner = z.people.find((p) => p.role === 'owner');
  const signupReq = z.requests.find((r) => r.type === 'signup' && r.stage !== 'done');
  const reload = () => { b.reload(); ctx.refresh(); };
  const pause = () => ctx.open({
    title: A('pauseTitle', { a: z.name }), sub: A('pauseSub'), note: A('pauseNote'), ok: A('pauseOk'), danger: true,
    groups: [{ label: A('reason'), key: 'reason', opts: ['pzUnpaid', 'pzFraud', 'pzOwner', 'pzInvest', 'other'].map((k) => ({ v: A(k), l: A(k) })) }],
    inputs: [{ label: A('noteOpt'), key: 'note', ph: A('noteOptPh') }], need: (f) => !!f.reason,
    go: (f) => act(async () => { await post(`/businesses/${z.id}/pause`, { reason: f.note?.trim() ? `${f.reason}: ${f.note.trim()}` : f.reason }); ctx.close(); ctx.toast(A('paused', { a: z.name })); reload(); }),
  });
  const resume = () => ctx.open({
    title: A('resumeTitle', { a: z.name }), sub: A('resumeSub'), ok: A('resumeOk'),
    go: () => act(async () => { await post(`/businesses/${z.id}/resume`); ctx.close(); ctx.toast(A('resumed', { a: z.name })); reload(); }),
  });
  const msg = owner ? { t: A('moTitleShort'), kind: 'outline' as const, go: () => ctx.open(messageOwner(ctx, { id: z.id, name: z.name, owner: owner.name, phone: owner.phone }, null)) } : null;
  const btns = [...(msg ? [msg] : []), ...(z.status === 'pending' && signupReq ? [{ t: A('reviewSignup'), kind: 'primary' as const, go: () => ctx.nav({ v: 'requests', id: signupReq.id, type: 'signup' }) }] : [])];
  const head = (
    <Head ini={z.name.charAt(0).toUpperCase()} title={z.name} sub={owner ? A('owner', { a: owner.name, b: owner.phone }) : undefined} pill={z.status}
      tags={[
        { t: planL(z.plan) }, { t: A('branchesN', { a: z.counts.branches }, z.counts.branches), go: () => setTab('people') },
        { t: A('staffN', { a: z.counts.staff }), go: () => setTab('people') }, { t: A('customersN', { a: z.counts.customers }, z.counts.customers), go: () => setTab('customers') },
        { t: z.agent ? A('agentTag', { a: z.agent }) : A('noAgent') },
      ]} />
  );
  const banner = z.status === 'paused' ? <Note t={A('noteBizPaused')} tone="red" /> : z.status === 'pending' ? <Note t={A('noteBizPending')} tone="dark" /> : z.status === 'closing' ? <Note t={A('noteBizClosing')} tone="red" /> : null;
  const tabs = <Tool groups={[{ cur: tab, pick: (v) => setTab(v as typeof tab), opts: [{ v: 'overview', l: A('tabOverview') }, { v: 'people', l: A('tabPeople') }, { v: 'customers', l: A('tabCustomers', { a: z.counts.customers }) }, ...(ctx.me.role !== 'support' ? [{ v: 'finance', l: A('tabFinance') }] : []), { v: 'support', l: A('tabSupport') }, { v: 'history', l: A('tabHistory') }] }]} />;

  let body: React.ReactNode = null;
  if (tab === 'overview') {
    const acts: Row[] = [];
    if (z.status === 'pending' && signupReq) acts.push({ t: A('verifyApprove'), s: A('openChecklist'), go: () => ctx.nav({ v: 'requests', id: signupReq.id, type: 'signup' }) });
    if (z.status === 'active' || z.status === 'trial') acts.push({ t: A('pauseBiz'), s: A('pauseBizS'), go: pause, sc: RED });
    if (z.status === 'paused') acts.push({ t: A('resumeBiz'), s: A('resumeBizS'), go: resume });
    if (z.status === 'closing') acts.push({ t: A('cancelClosing'), s: A('cancelClosingS'), go: () => ctx.open({
      title: A('cancelClosing'), sub: A('cancelClosingSub', { a: z.name }), ok: A('cancelClosingOk'),
      go: async () => { try { await post(`/businesses/${z.id}/cancel-closing`); } catch (e) { throw new Error(failText(e)); } ctx.close(); ctx.toast(A('closingCancelled')); b.reload(); },
    }) });
    if (!['pending', 'closed', 'rejected'].includes(z.status)) acts.push({ t: A('seeCustomers'), s: A('seeCustomersS', { a: z.counts.customers }), go: () => setTab('customers') });
    body = (
      <>
        <Stats cols={4} items={[
          { v: String(z.counts.customers), l: A('stCustomers') }, { v: String(z.counts.stamps30d), l: A('stStamps30') },
          { v: String(z.counts.branches), l: z.counts.branches === 1 ? A('stBranch') : A('stBranches') },
          { v: String(z.counts.staff), l: A('stStaff'), s: A('lastActive', { a: rel(z.counts.lastActive).toLowerCase() }) },
        ]} />
        <Cols lw="1fr" rw="1fr"
          left={<>
            <Kv title={A('kvBusiness')} rows={[
              { k: A('kCategory'), v: cat(z.category) }, { k: A('kCity'), v: z.city || '—' }, { k: A('kJoined'), v: fdy(z.createdAt) },
              { k: A('kPlan'), v: planL(z.plan) }, { k: A('kAgent'), v: z.agent ?? A('none') }, { k: A('kBizId'), v: z.shopCode },
            ]} />
            <List title={A('openReqs')} empty={A('noneOpen')} rows={z.requests.filter((r) => r.stage !== 'done').map((r) => ({ t: typeL(r.type), s: A('asked', { a: fd(r.createdAt) }), pill: reqPill(r), go: () => ctx.nav({ v: 'requests', id: r.id, type: r.type }) }))} />
          </>}
          right={<List title={A('whatToDo')} rows={acts} empty={A('noActions')} />} />
      </>
    );
  } else if (tab === 'people') {
    const staff = z.people.filter((p) => p.role !== 'owner');
    body = (
      <Cols lw="1fr" rw="1fr"
        left={<>
          <Kv title={A('kvOwner')} rows={owner ? [
            { k: A('kName'), v: owner.name }, { k: A('kPhone'), v: owner.phone }, { k: A('kLastSignIn'), v: owner.lastSignIn ? `${rel(owner.lastSignIn)} ${ft(owner.lastSignIn)}` : A('never') },
            { k: A('kPinChanged'), v: owner.pinSetAt ? rel(owner.pinSetAt) : '—' }, { k: A('kSmsCode'), v: A('smsOn') },
          ] : []} />
          <Kv title={A('kvBranches', { a: z.branches.length })} rows={z.branches.map((br) => ({ k: br.name, v: br.address || '—' }))} />
        </>}
        right={<Table title={A('teamTitle', { a: staff.length })} cols="1.4fr 1fr 1.2fr 1fr" heads={[{ h: A('hName') }, { h: A('hRole') }, { h: A('hBranch') }, { h: A('hStatus') }]}
          rows={staff.map((p) => ({ cells: [{ t: p.name, b: true }, { t: p.role === 'manager' ? A('rManager') : A('rCashier') }, { t: p.branches.join(', ') || '—' }, { pill: p.locked ? 'locked' : 'active' }] }))}
          empty={A('noStaff')} foot={A('teamFoot')} />} />
    );
  } else if (tab === 'finance') {
    body = <BusinessFinance ctx={ctx} id={z.id} onChange={reload} />;
  } else if (tab === 'support') {
    body = <SupportTab ctx={ctx} biz={z} onChange={reload} />;
  } else if (tab === 'customers') {
    body = view.card ? <CustomerCard ctx={ctx} cardId={view.card} biz={z} onBack={() => ctx.nav({ ...view, card: undefined })} /> : <Customers ctx={ctx} biz={z} view={view} />;
  } else {
    body = <BizHistory ctx={ctx} biz={z} />;
  }
  return (
    <Page title={z.name} showTitle={false} crumbs={[{ t: A('bzTitle'), go: () => ctx.nav({ v: 'businesses' }) }, { t: z.name }]} btns={btns}>
      {head}
      {banner}
      {tabs}
      {body}
    </Page>
  );
}

function Customers({ ctx, biz, view }: { ctx: Ctx; biz: Biz; view: Extract<View, { v: 'business' }> }) {
  const list = useLoad<CustRow[]>(`/admin/businesses/${biz.id}/customers`);
  const [q, setQ] = useState('');
  const [cf, setCf] = useState('all');
  const [lim, setLim] = useState(12);
  const all = list.data ?? [];
  const digits = q.replace(/\D/g, '');
  const L = all.filter((c) => (cf === 'all' || c.status === cf) && (!digits || (c.phone ?? '').replace(/\D/g, '').includes(digits)));
  return (
    <>
      <Tool search={{ value: q, onChange: setQ, ph: A('cuSearch') }} groups={[{ label: A('fShow'), cur: cf, pick: (v) => { setCf(v); setLim(12); }, opts: [{ v: 'all', l: A('all') }, { v: 'active', l: A('cuActive') }, { v: 'paused', l: A('cuPaused', { a: all.filter((c) => c.status === 'paused').length }) }] }]} />
      {list.data ? (
        <Table title={A('cuTitle', { a: all.length, b: biz.name }, all.length)} cols="2fr 1fr 1fr 1.2fr 1.1fr"
          heads={[{ h: A('hCustomer') }, { h: A('hStampsNow'), right: true }, { h: A('hRewards'), right: true }, { h: A('hLastVisit') }, { h: A('hCard') }]}
          rows={L.slice(0, lim).map((c) => ({ go: () => ctx.nav({ ...view, card: c.cardId }), cells: [
            { t: c.phone ?? '—', s: A('kJoined') + ' ' + fd(c.joined), b: true }, { t: A('ofN', { a: c.stamps, b: c.total }), right: true },
            { t: String(c.rewardsEarned), s: A('usedN', { a: c.rewardsUsed }), right: true }, { t: rel(c.lastVisit) }, { pill: c.status === 'paused' ? 'paused' : 'active' },
          ] }))}
          empty={A('cuEmpty')} more={L.length > lim ? { t: A('more12', { a: L.length - lim }), go: () => setLim(lim + 12) } : null} foot={A('cuFoot', { a: Math.min(lim, L.length), b: L.length })} />
      ) : <Loading error={list.error} retry={list.reload} />}
    </>
  );
}

interface CardDetail { id: string; business: string; status: string; total: number; joined: string; phone: string | null; stamps: number; lastVisit: string | null; rewardsEarned: number; rewardsUsed: number; otherShops: number }
function CustomerCard({ ctx, cardId, biz, onBack }: { ctx: Ctx; cardId: string; biz: Biz; onBack: () => void }) {
  const c = useLoad<CardDetail>(`/admin/cards/${cardId}`);
  if (!c.data) return <Loading error={c.error} retry={c.reload} />;
  const d = c.data;
  const who = d.phone ?? '—';
  const pause = () => ctx.open({
    title: A('cpTitle', { a: who }), sub: A('cpSub'), note: A('cpNote'), ok: A('cpOk'), danger: true,
    groups: [{ label: A('reason'), key: 'reason', opts: ['cpLost', 'cpFraud', 'cpAsked', 'other'].map((k) => ({ v: A(k), l: A(k) })) }],
    inputs: [{ label: A('noteOpt'), key: 'note', ph: A('noteOptPh') }], need: (f) => !!f.reason,
    go: (f) => act(async () => { await post(`/cards/${d.id}/pause`, { reason: f.note?.trim() ? `${f.reason}: ${f.note.trim()}` : f.reason }); ctx.close(); ctx.toast(A('cpDone')); c.reload(); }),
  });
  const resume = () => ctx.open({
    title: A('crTitle', { a: who }), sub: A('crSub'), ok: A('crOk'),
    go: () => act(async () => { await post(`/cards/${d.id}/resume`); ctx.close(); ctx.toast(A('crDone')); c.reload(); }),
  });
  return (
    <>
      <Head ini="#" title={who} sub={A('cuJoined', { a: biz.name, b: fdy(d.joined) })} pill={d.status === 'paused' ? 'cardpaused' : 'active'}
        tags={[{ t: biz.name, go: onBack }]} btns={[{ t: A('backToCustomers'), kind: 'outline', go: onBack }]} />
      <Cols lw="1fr" rw="1fr"
        left={<>
          <Kv title={A('kvCard')} rows={[
            { k: A('kStampsNow'), v: A('ofN', { a: d.stamps, b: d.total }) }, { k: A('kRewardsEarned'), v: String(d.rewardsEarned) }, { k: A('kRewardsUsed'), v: String(d.rewardsUsed) },
            { k: A('kLastVisit'), v: rel(d.lastVisit) }, { k: A('kJoined'), v: fdy(d.joined) }, { k: A('kCard'), v: d.status === 'paused' ? A('cardPaused') : A('cardActive') },
            { k: A('kSamePhone'), v: d.otherShops ? A('otherShops', { a: d.otherShops }, d.otherShops) : A('onlyHere') },
          ]} />
          <Note t={A('cuNote')} />
        </>}
        right={<List title={A('whatToDo')} rows={[d.status === 'paused' ? { t: A('resumeCard'), s: A('resumeCardS'), go: resume } : { t: A('pauseCard'), s: A('pauseCardS'), go: d.status === 'active' ? pause : undefined, sc: RED }]} />} />
    </>
  );
}

const logRows = (rows: LogRow[]) => rows.map((e) => {
  const d = e.detail ?? {};
  const extra = typeof d.text === 'string' ? d.text : typeof d.reason === 'string' ? d.reason : '';
  return { t: e.text, s: extra, w: A('whenWho', { a: `${fd(e.at)} ${ft(e.at)}`, b: e.actor ?? (e.actorType === 'system' ? A('system') : e.actorType) }) };
});

function BizHistory({ ctx, biz }: { ctx: Ctx; biz: Biz }) {
  const log = useLoad<LogRow[]>(`/admin/log?businessId=${biz.id}`);
  return (
    <>
      <Input title={A('noteTitle')} ph={A('notePh')} btn={A('addNote')} onAdd={async (text) => { await post(`/businesses/${biz.id}/note`, { text }); ctx.toast(A('noteAdded')); log.reload(); }} />
      {log.data ? <Timeline title={A('happened')} rows={logRows(log.data.filter((e) => e.type !== 'admin.viewed'))} empty={A('nothingYet')} /> : <Loading error={log.error} retry={log.reload} />}
    </>
  );
}

// ---------------------------------------------------------------- Requests
interface ReqDetail extends Req { ownerDismissedAt?: string | null; ownerName: string | null; ownerPhone: string | null; category: string | null; businessStatus: string | null; agent: string | null; notes: Array<{ text: string; at: string; by: string }> }
export function RequestsPage({ ctx, view }: { ctx: Ctx; view: Extract<View, { v: 'requests' }> }) {
  const [rt, setRt] = useState(view.type ?? 'all');
  const [rs, setRs] = useState(view.id ? 'all' : 'open');
  const stage = rs === 'open' ? '' : rs === 'done' ? 'done' : 'all';
  const list = useLoad<Req[]>(`/admin/requests?stage=${stage}`);
  const open = useLoad<Req[]>('/admin/requests');
  const sel = view.id;
  const L = (list.data ?? []).filter((r) => rt === 'all' || r.type === rt);
  const openN = (t: string) => (open.data ?? []).filter((r) => t === 'all' || r.type === t).length;
  const reloadAll = () => { list.reload(); open.reload(); ctx.refresh(); };
  return (
    <Page title={A('rqTitle')} sub={A('rqSub', { a: openN('all') })}>
      <Tool groups={[
        { label: A('fType'), cur: rt, pick: (v) => { setRt(v); ctx.nav({ v: 'requests', type: v }); }, opts: [{ v: 'all', l: A('allN', { a: openN('all') }) }, ...TYPES.map(([k, l]) => ({ v: k, l: A('chipN', { a: A(l), b: openN(k) }) }))] },
        { label: A('fStatus'), cur: rs, pick: (v) => { setRs(v); ctx.nav({ v: 'requests', type: rt }); }, opts: [{ v: 'open', l: A('sOpen') }, { v: 'done', l: A('sDone') }, { v: 'all', l: A('all') }] },
      ]} />
      <Cols lw="400px" rw="1fr"
        left={list.data ? (
          <List title={A('rqN', { a: L.length }, L.length)} empty={A('rqEmpty')} rows={L.map((r) => ({
            t: r.business ?? '—', s: [typeL(r.type), shortId(r.id), A('asked', { a: fd(r.createdAt) }), r.assignee?.split(' ')[0]].filter(Boolean).join(' · '),
            pill: reqPill(r), on: r.id === sel, go: () => ctx.nav({ v: 'requests', id: r.id, type: rt }),
          }))} />
        ) : <Loading error={list.error} retry={list.reload} />}
        right={sel ? <RequestDetail key={sel} ctx={ctx} id={sel} onChange={reloadAll} /> : <Note t={A('rqPick')} />} />
    </Page>
  );
}

interface Team { id: string; name: string; email: string; role: Role; status: string; me: boolean; lastLoginAt: string | null }
function RequestDetail({ ctx, id, onChange }: { ctx: Ctx; id: string; onChange: () => void }) {
  const r = useLoad<ReqDetail>(`/admin/requests/${id}`);
  const team = useLoad<Team[]>('/admin/team');
  const settings = useLoad<Array<{ key: string; value: unknown }>>('/admin/settings');
  const bizList = useLoad<Array<{ id: string; name: string }>>(r.data?.type === 'lost_phone' && !r.data.businessId ? '/admin/businesses' : null);
  const [chk, setChk] = useState<boolean[]>([]);
  if (!r.data) return <Loading error={r.error} retry={r.reload} />;
  const q = r.data;
  const p = q.payload ?? {};
  const isOpen = q.stage !== 'done';
  const reload = () => { r.reload(); onChange(); };
  const num = (k: string) => Number(settings.data?.find((x) => x.key === k)?.value);
  const trialDays = num('plan.trial_days') || 30;
  const out: React.ReactNode[] = [];
  out.push(<Head key="h" ini={typeL(q.type).charAt(0)} title={typeL(q.type)} sub={A('rqHeadSub', { a: shortId(q.id), b: q.business ?? '—', c: fd(q.createdAt), d: ft(q.createdAt) })} pill={reqPill(q)}
    btns={q.businessId ? [{ t: A('openBiz', { a: q.business ?? '' }), kind: 'outline', go: () => ctx.nav({ v: 'business', id: q.businessId! }) }] : []} />);
  const assign = () => ctx.open({
    title: A('assignTitle'), sub: `${shortId(q.id)} · ${q.business ?? ''}`, note: A('assignNote'), ok: A('assignOk'),
    groups: [{ label: A('assignTo'), key: 'who', opts: (team.data ?? []).filter((m) => m.status === 'active').map((m) => ({ v: m.id, l: `${m.name} · ${roleL(m.role)}` })) }],
    need: (f) => !!f.who,
    go: (f) => act(async () => { await post(`/requests/${q.id}/assign`, { adminId: f.who }); ctx.close(); ctx.toast(A('assigned', { a: team.data?.find((m) => m.id === f.who)?.name ?? '' })); reload(); }),
  });
  out.push(<List key="as" rows={[{ t: A('assignedTo', { a: q.assignee ?? A('nobodyYet') }), s: A('tapAssign'), go: assign }]} />);
  if (!isOpen) out.push(<Note key="fin" t={A('finished', { a: resultL(q) })} tone="solid" />);
  if (q.type === 'signup') {
    const typed = typeof p.agentPhone === 'string' ? p.agentPhone : '';
    out.push(<Kv key="kv" title={A('kvTheBiz')} rows={[
      { k: A('hBusiness'), v: q.business ?? '—' }, { k: A('kType'), v: q.category ? cat(q.category) : '—' }, { k: A('kOwnerName'), v: String(p.ownerName ?? q.ownerName ?? '—') },
      { k: A('kPhone'), v: String(p.phone ?? q.ownerPhone ?? '—') }, { k: A('kAgentTyped'), v: typed || A('nothingTyped') },
      { k: A('kAgentMatched'), v: q.agent ?? (typed ? A('noAgentNumber') : A('none')) },
    ]} />);
    if (typed && !q.agent && isOpen) out.push(<Note key="mm" t={A('agentMismatch', { a: typed })} tone="red" />);
    if (isOpen) {
      const items = [A('chk1'), A('chk2'), A('chk3')].concat(q.agent ? [A('chkAgent', { a: q.agent })] : []);
      const on = (i: number) => !!chk[i];
      const allThree = on(0) && on(1) && on(2);
      out.push(<Check key="ck" title={A('checkTitle')} rows={items.map((t, i) => ({ t, on: on(i), go: () => setChk((c) => { const n = [...c]; n[i] = !n[i]; return n; }) }))} note={items.every((_, i) => on(i)) ? A('chkAll') : A('chkTick')} />);
      const prices = { starter: num('plan.starter.yearly_fee_birr'), full: num('plan.full.yearly_fee_birr') };
      const approve = () => ctx.open({
        title: A('approveTitle', { a: q.business ?? '' }), sub: A('approveSub'), ok: A('approveStart'), note: q.agent ? undefined : A('noAgentNote'),
        groups: [
          { label: A('howStart'), key: 'opt', opts: [{ v: 'trial', l: A('trialN', { a: trialDays }) }, { v: 'pilot', l: A('pilotFree') }] },
          { label: A('planAfter'), key: 'plan', opts: [
            { v: 'starter', l: prices.starter ? A('planStarterP', { a: birr(prices.starter) }) : A('planStarterN') },
            { v: 'full', l: prices.full ? A('planFullP', { a: birr(prices.full) }) : A('planFullN') },
          ] },
        ],
        need: (f) => f.opt === 'pilot' || (f.opt === 'trial' && !!f.plan),
        go: (f) => act(async () => {
          await post(`/requests/${q.id}/approve`, f.opt === 'pilot' ? { start: 'pilot' } : { start: 'trial', plan: f.plan });
          ctx.close(); ctx.toast(A('approved', { a: q.business ?? '' })); reload();
        }),
      });
      const reject = () => ctx.open({
        title: A('rejectTitle', { a: q.business ?? '' }), sub: A('rejectSub'), ok: A('rejectOk'), danger: true,
        groups: [{ label: A('reason'), key: 'reason', opts: ['rjNotFound', 'rjNoReach', 'rjFake', 'rjAlready', 'other'].map((k) => ({ v: A(k), l: A(k) })) }],
        inputs: [{ label: A('noteOpt'), key: 'note', ph: A('noteOptPh') }], need: (f) => !!f.reason,
        go: (f) => act(async () => { await post(`/requests/${q.id}/reject`, { reason: f.note?.trim() ? `${f.reason}: ${f.note.trim()}` : f.reason }); ctx.close(); ctx.toast(A('rejected')); reload(); }),
      });
      out.push(<List key="dec" title={A('decision')} rows={[
        allThree ? { t: A('approveStart'), s: A('approveStartS'), go: approve } : { t: A('approveStart'), s: A('tickThree'), dim: true },
        { t: A('rejectSignup'), s: A('rejectSignupS'), go: reject, sc: RED },
      ]} />);
    }
  }
  if (q.type === 'help') {
    out.push(<Kv key="kv" title={A('hlpFrom')} rows={[{ k: A('kName'), v: String(p.name ?? '—') }, { k: A('kPhone'), v: String(p.phone ?? '—') }, { k: A('kRole'), v: p.role === 'manager' ? A('hlpManager') : A('hlpOwner') }]} />);
    out.push(<Note key="tx" t={String(p.text ?? '')} tone="solid" />);
    if (isOpen) {
      out.push(<List key="act" title={A('whatToDo')} rows={[
        { t: A('hlpAnswered'), s: A('hlpAnsweredS'), go: () => ctx.open({
          title: A('hlpAnswered'), sub: q.business ?? '', ok: A('hlpClose'), inputs: [{ label: A('hlpWhat'), key: 'reason', ph: A('hlpWhatPh') }], need: (f) => !!f.reason?.trim(),
          go: (f) => act(async () => { await post(`/requests/${q.id}/answered`, { reason: f.reason.trim() }); ctx.close(); ctx.toast(A('hlpDone')); reload(); }),
        }) },
      ]} />);
    }
  }
  if (q.type === 'closing') {
    const after = num('promise.close_after_days') || 30;
    out.push(<Kv key="kv" title={A('kvTheReq')} rows={[
      { k: A('reason'), v: String(p.reason ?? '—') }, { k: A('kRef'), v: String(p.code ?? '—') },
      { k: A('kAnswerBy'), v: typeof p.answerBy === 'string' ? fd(p.answerBy + 'T12:00:00+03:00') : '—' },
      { k: A('kIfApproved'), v: A('closesAfter', { a: after }) },
    ]} />);
    if (isOpen) {
      const items = [A('clChk1'), A('clChk2'), A('clChk3')];
      const all = items.every((_, i) => !!chk[i]);
      out.push(<Check key="ck" title={A('checkTitle')} rows={items.map((t, i) => ({ t, on: !!chk[i], go: () => setChk((c) => { const x = [...c]; x[i] = !x[i]; return x; }) }))} note={all ? A('chkAll') : A('chkTick')} />);
      const approve = () => ctx.open({ title: A('clApproveTitle', { a: q.business ?? '' }), sub: A('clApproveSub', { a: after }), note: A('clApproveNote'), ok: A('clApproveOk'), danger: true,
        go: () => act(async () => { await post(`/requests/${q.id}/close-approve`); ctx.close(); ctx.toast(A('clApproved', { a: q.business ?? '' })); reload(); }) });
      const decline = () => ctx.open({ title: A('clDeclineTitle', { a: q.business ?? '' }), sub: A('clDeclineSub'), ok: A('clDeclineOk'), danger: true,
        groups: [{ label: A('reason'), key: 'reason', opts: ['clD1', 'clD2', 'clD3', 'other'].map((k) => ({ v: A(k), l: A(k) })) }], inputs: [{ label: A('noteOpt'), key: 'note', ph: A('noteOptPh') }], need: (f) => !!f.reason,
        go: (f) => act(async () => { await post(`/requests/${q.id}/close-decline`, { reason: f.note?.trim() ? `${f.reason}: ${f.note.trim()}` : f.reason }); ctx.close(); ctx.toast(A('clDeclined')); reload(); }) });
      out.push(<List key="dec" title={A('decision')} rows={[
        all ? { t: A('clApprove'), s: A('clApproveS', { a: after }), go: approve } : { t: A('clApprove'), s: A('tickAll', { a: 3 }), dim: true },
        { t: A('clDecline'), s: A('clDeclineS'), go: decline, sc: RED },
        { t: A('calledOwner'), s: A('calledOwnerS'), go: async () => { await post(`/requests/${q.id}/note`, { text: A('calledNote') }); ctx.toast(A('noteAdded')); reload(); } },
      ]} />);
    }
  }
  if (q.type === 'lost_phone') {
    out.push(<Kv key="kv" title={A('lpTold')} rows={[
      { k: A('lpBizGiven'), v: String(p.businessName ?? '—') }, { k: A('lpNameGiven'), v: String(p.name ?? '—') },
      { k: A('lpOwnerRec'), v: q.ownerName ?? A('lpNoMatch') }, { k: A('lpOldRec'), v: q.ownerPhone ?? '—' },
      { k: A('lpOldGiven'), v: String(p.oldPhone ?? '—') }, { k: A('lpNewPh'), v: String(p.newPhone ?? '—') }, { k: A('kRef'), v: String(p.code ?? '—') },
    ]} />);
    if (isOpen && !q.businessId) out.push(<Note key="nm" t={A('lpNoMatchNote')} tone="red" />);
    if (isOpen) {
      const items = [A('lpChk1'), A('lpChk2'), A('lpChk3'), A('lpChk4')];
      const all = items.every((_, i) => !!chk[i]);
      out.push(<Check key="ck" title={A('checkTitle')} rows={items.map((t, i) => ({ t, on: !!chk[i], go: () => setChk((c) => { const x = [...c]; x[i] = !x[i]; return x; }) }))} note={all ? A('chkAll') : A('chkTick')} />);
      const change = () => ctx.open({ title: A('lpChangeTitle', { a: q.business ?? String(p.businessName ?? '') }), sub: A('lpChangeSub', { a: String(p.newPhone ?? '') }), ok: A('lpChangeOk'),
        ...(q.businessId ? {} : { pre: [{ label: A('mcFindBiz'), key: 'find', ph: A('mcFindPh') }], groups: [{ label: A('adPickBiz'), key: 'biz', filterBy: 'find', opts: (bizList.data ?? []).map((x) => ({ v: x.id, l: x.name })) }] }),
        note: q.ownerPhone ? A('lpOldGone', { a: q.ownerPhone }) : undefined, need: (f) => !!q.businessId || !!f.biz,
        go: (f) => act(async () => { await post(`/requests/${q.id}/phone`, q.businessId ? {} : { businessId: f.biz }); ctx.close(); ctx.toast(A('lpChanged')); reload(); }) });
      const reject = () => ctx.open({ title: A('lpRejectTitle'), sub: A('lpRejectSub'), ok: A('rejectOk'), danger: true,
        groups: [{ label: A('reason'), key: 'reason', opts: ['lpR1', 'lpR2', 'lpR3', 'other'].map((k) => ({ v: A(k), l: A(k) })) }], inputs: [{ label: A('noteOpt'), key: 'note', ph: A('noteOptPh') }], need: (f) => !!f.reason,
        go: (f) => act(async () => { await post(`/requests/${q.id}/reject`, { reason: f.note?.trim() ? `${f.reason}: ${f.note.trim()}` : f.reason }); ctx.close(); ctx.toast(A('rejected')); reload(); }) });
      out.push(<List key="dec" title={A('decision')} rows={[
        all ? { t: A('lpChange'), s: A('lpChangeS', { a: String(p.newPhone ?? '') }), go: change } : { t: A('lpChange'), s: A('tickAll', { a: 4 }), dim: true },
        { t: A('lpReject'), s: A('lpRejectS'), go: reject, sc: RED },
      ]} />);
    }
  }
  if (q.type === 'deletion') {
    out.push(<Kv key="kv" title={A('kvTheReq')} rows={[
      { k: A('delCustomer'), v: `+251 •• ••• ${String(p.last4 ?? '')}` }, { k: A('delShop'), v: q.business ?? '—' },
      { k: A('delHow'), v: p.how === 'shop' ? A('delHowShop') : A('delHowApp') }, { k: A('kRef'), v: String(p.code ?? '—') },
      { k: A('delBy'), v: A('delWithin', { a: num('promise.delete_days') || 30 }) },
    ]} />);
    out.push(<Note key="dn" t={A('delNote')} />);
    if (isOpen) {
      out.push(<Check key="ck" title={A('checkTitle')} rows={[{ t: A('delChk'), on: !!chk[0], go: () => setChk((c) => [!c[0]]) }]} note={chk[0] ? A('chkAll') : A('chkTick')} />);
      const del = () => ctx.open({ title: A('delTitle'), sub: A('delSub', { a: q.business ?? '' }), note: A('delCannotUndo'), ok: A('delOk'), danger: true,
        go: () => act(async () => { await post(`/requests/${q.id}/delete-customer`); ctx.close(); ctx.toast(A('delDone')); reload(); }) });
      const reject = () => ctx.open({ title: A('delRejectTitle'), sub: A('delRejectSub'), ok: A('rejectOk'), danger: true,
        groups: [{ label: A('reason'), key: 'reason', opts: ['delR1', 'delR2', 'other'].map((k) => ({ v: A(k), l: A(k) })) }], inputs: [{ label: A('noteOpt'), key: 'note', ph: A('noteOptPh') }], need: (f) => !!f.reason,
        go: (f) => act(async () => { await post(`/requests/${q.id}/reject`, { reason: f.note?.trim() ? `${f.reason}: ${f.note.trim()}` : f.reason }); ctx.close(); ctx.toast(A('rejected')); reload(); }) });
      out.push(<List key="dec" title={A('decision')} rows={[
        chk[0] ? { t: A('delTitle'), s: A('delRowS'), go: del } : { t: A('delTitle'), s: A('tickFirst'), dim: true },
        { t: A('delReject'), s: A('delRejectS'), go: reject, sc: RED },
      ]} />);
    }
  }
  if (q.type === 'flag') {
    out.push(<Kv key="kv" title={A('kvSaw')} rows={[
      { k: A('kSignal'), v: p.kind === 'hand_typed_share' ? A('signalHand', { a: String(p.share ?? '—'), b: String(p.typed ?? '—'), c: String(p.total ?? '—') })
        : p.kind === 'new_cards_per_hour' ? A('signalCards', { a: String(p.cards ?? '—') }) : A('signalV', { a: String(p.stamps ?? '—') }) },
      { k: A('kLimit'), v: p.kind === 'hand_typed_share' ? `${String(p.limit ?? '—')}%` : String(p.limit ?? '—') },
      typeof p.week === 'string' ? { k: A('kWeek'), v: A('weekOf', { a: fd(p.week + 'T12:00:00+03:00') }) }
        : { k: A('kHour'), v: typeof p.hour === 'string' ? `${fd(p.hour + ':00:00+03:00')} ${p.hour.slice(11)}:00` : '—' },
      ...(q.ownerDismissedAt ? [{ k: A('kOwnerSaw'), v: A('ownerDismissed', { a: fd(q.ownerDismissedAt) }) }] : []),
      { k: A('kBizStatus'), v: q.businessStatus ? A({ active: 'pActive', trial: 'pTrial', paused: 'pPaused', pending: 'pPending', closing: 'pClosing', closed: 'pClosed', rejected: 'pRejected' }[q.businessStatus] ?? 'pActive') : '—' },
    ]} />);
    if (isOpen) {
      const dismiss = () => ctx.open({
        title: A('dmTitle'), sub: A('dmSub'), ok: A('dmOk'),
        groups: [{ label: A('reason'), key: 'reason', opts: ['dmNormal', 'dmExplained', 'dmMistake', 'other'].map((k) => ({ v: A(k), l: A(k) })) }],
        inputs: [{ label: A('noteOpt'), key: 'note', ph: A('noteOptPh') }], need: (f) => !!f.reason,
        go: (f) => act(async () => { await post(`/requests/${q.id}/dismiss`, { reason: f.note?.trim() ? `${f.reason}: ${f.note.trim()}` : f.reason }); ctx.close(); ctx.toast(A('dmDone')); reload(); }),
      });
      const rows: Row[] = [{ t: A('calledOwner'), s: A('calledOwnerS'), go: async () => { await post(`/requests/${q.id}/note`, { text: A('calledNote') }); ctx.toast(A('noteAdded')); reload(); } }];
      if (q.businessId && (q.businessStatus === 'active' || q.businessStatus === 'trial')) rows.push({ t: A('pauseBiz'), s: A('pauseFlagS'), go: () => ctx.nav({ v: 'business', id: q.businessId! }), sc: RED });
      rows.push({ t: A('dismissFlag'), s: A('dismissFlagS'), go: dismiss });
      out.push(<List key="act" title={A('whatToDo')} rows={rows} />);
    }
  }
  if (q.type === 'stand_order' && typeof p.orderId === 'string') out.push(<StandRequest key="so" ctx={ctx} orderId={p.orderId} onChange={reload} />);
  out.push(<Input key="in" title={A('noteTitle')} ph={A('notePh')} btn={A('addNote')} onAdd={async (text) => { await post(`/requests/${q.id}/note`, { text }); ctx.toast(A('noteAdded')); r.reload(); }} />);
  if (q.notes.length) out.push(<Timeline key="nt" title={A('notes')} rows={q.notes.map((n) => ({ t: n.text, w: A('whenWho', { a: `${fd(n.at)} ${ft(n.at)}`, b: n.by }) }))} />);
  return <>{out}</>;
}

// ---------------------------------------------------------------- Activity log
export function AuditPage({ ctx }: { ctx: Ctx }) {
  const [au, setAu] = useState('all');
  const [q, setQ] = useState('');
  const types: Record<string, string> = { all: '', business: 'business.,card.', request: 'request.', settings: 'setting.,safety.,admin.team,admin.role,admin.disabled' };
  const log = useLoad<LogRow[]>(`/admin/log?actorType=admin&type=${encodeURIComponent(types[au])}&q=${encodeURIComponent(q.trim())}`);
  const rows = (log.data ?? []).filter((e) => e.type !== 'admin.viewed' && e.type !== 'admin.searched');
  return (
    <Page title={A('lgTitle')} sub={A('lgSub')} btns={ctx.me.role === 'owner' ? [exportButton(ctx, 'log', A('exLog'), true)] : []}>
      <Tool search={{ value: q, onChange: setQ, ph: A('lgSearch') }} groups={[{ label: A('fType'), cur: au, pick: setAu, opts: [{ v: 'all', l: A('all') }, { v: 'business', l: A('lgBusinesses') }, { v: 'request', l: A('lgRequests') }, { v: 'settings', l: A('lgSettings') }] }]} />
      {log.data ? (
        <Table cols="1.2fr .8fr 2.6fr 1.6fr 2.2fr" heads={[{ h: A('hWhen') }, { h: A('hWho') }, { h: A('hWhat') }, { h: A('hBusiness') }, { h: A('hDetail') }]}
          rows={rows.map((e) => {
            const d = e.detail ?? {};
            const det = typeof d.text === 'string' ? d.text : typeof d.reason === 'string' ? d.reason : '';
            return { cells: [{ t: fd(e.at), s: ft(e.at) }, { t: e.actor ?? '—' }, { t: e.text, b: true }, { t: e.business ?? '—' }, { t: det || '—', c: GREY }] };
          })}
          empty={A('lgEmpty')} foot={A('lgFoot', { a: rows.length }, rows.length)} />
      ) : <Loading error={log.error} retry={log.reload} />}
    </Page>
  );
}

// ---------------------------------------------------------------- Settings
interface Setting { key: string; value: unknown }
interface Kill { on: boolean; message: string; reason: string; changedBy: string | null; changedAt: string | null }
export function SettingsPage({ ctx, view }: { ctx: Ctx; view: Extract<View, { v: 'settings' }> }) {
  const tab = view.tab ?? 'rules';
  const set = useLoad<Setting[]>('/admin/settings');
  const isOwner = ctx.me.role === 'owner';
  const val = (k: string) => { const v = set.data?.find((x) => x.key === k)?.value; return typeof v === 'number' ? v : undefined; };
  /** A − / + row for a numeric setting; only Owners change it, each change is logged. */
  const row = (key: string, t: string, sub: string, step: number, lo: number, hi: number, unit: (n: number) => string) => {
    const cur = val(key);
    if (cur === undefined) return null;
    const change = (d: number) => {
      const nv = Math.max(lo, Math.min(hi, cur + d));
      if (nv === cur) return undefined;
      return async () => { await post('/settings', { key, value: nv }); ctx.toast(A('isNow', { a: t, b: unit(nv) })); set.reload(); };
    };
    return { t, s: isOwner ? sub : `${sub ? sub + ' · ' : ''}${A('ownerOnly')}`, v: unit(cur), dec: isOwner ? change(-step) : undefined, inc: isOwner ? change(step) : undefined };
  };
  const rows = (r: Array<ReturnType<typeof row>>) => r.filter((x): x is NonNullable<typeof x> => !!x);
  const days = (n: number) => A('uDays', { a: n }, n);
  const subs = { rules: 'subRules', team: 'subTeam', safety: 'subSafety', account: 'subAccount' } as const;
  let body: React.ReactNode = null;
  if (tab === 'rules') {
    const prices = rows([row('plan.starter.yearly_fee_birr', A('pStarter'), A('pStarterS'), 1000, 0, 100000, birr), row('plan.full.yearly_fee_birr', A('pFull'), A('pFullS'), 1000, 0, 100000, birr), row('plan.extra_branch.yearly_fee_birr', A('pExtra'), A('pExtraS'), 500, 0, 50000, birr)]);
    const comm = rows([row('agent.commission_birr.starter', A('cmStarter'), A('cmPaid'), 500, 0, 50000, birr), row('agent.commission_birr.full', A('cmFull'), A('cmPaid'), 500, 0, 50000, birr), row('agent.commission_birr.extra_branch', A('cmExtra'), A('cmExtraS'), 500, 0, 20000, birr), row('government.share_percent_of_commission', A('govPct'), A('govPctS'), 5, 0, 60, (n) => A('uPct', { a: n }))]);
    body = (
      <Cols lw="1fr" rw="1fr"
        left={<><SetBlock title={A('promises')} rows={rows([
          row('promise.close_answer_days', A('prCloseAns'), A('prCloseAnsS'), 1, 1, 10, days),
          row('promise.close_after_days', A('prCloseAfter'), A('prCloseAfterS'), 5, 5, 90, days),
          row('promise.lost_answer_days', A('prLost'), A('prWorking'), 1, 1, 5, days),
          row('promise.signup_check_days', A('prSignup'), A('prWorking'), 1, 1, 5, days),
          row('promise.delete_days', A('prDelete'), A('prDeleteS'), 5, 5, 60, days),
          row('plan.trial_days', A('trialLen'), A('trialLenS'), 7, 7, 90, days),
        ])} /><SupportContacts ctx={ctx} settings={set.data ?? []} isOwner={isOwner} onSaved={set.reload} /><PayAccounts ctx={ctx} settings={set.data ?? []} isOwner={isOwner} onSaved={set.reload} /></>}
        right={<>
          {prices.length > 0 && <SetBlock title={A('prices')} rows={prices} />}
          {comm.length > 0 && <SetBlock title={A('commission')} rows={comm} />}
          <Kv title={A('finYear')} rows={[{ k: A('fyOpen'), v: A('fyOpenV') }, { k: A('fyStart'), v: A('fyStartV') }, { k: A('fyEnd'), v: A('fyEndV') }]} />
        </>} />
    );
  } else if (tab === 'team') body = <TeamTab ctx={ctx} />;
  else if (tab === 'safety') body = <SafetyTab ctx={ctx} flags={rows([
    row('flags.stamps_per_hour', A('flagHour'), A('flagHourS'), 5, 10, 200, (n) => A('uStamps', { a: n })),
    row('flags.hand_typed_share_pct', A('flagHand'), A('flagHandS'), 5, 10, 90, (n) => A('uPct', { a: n })),
    row('flags.hand_typed_min_stamps', A('flagHandMin'), A('flagHandMinS'), 5, 5, 500, (n) => A('uStamps', { a: n })),
    row('flags.new_cards_per_hour', A('flagNew'), A('flagNewS'), 5, 5, 200, (n) => A('uCards', { a: n })),
  ])} />;
  else {
    body = (
      <Cols lw="1fr" rw="1fr"
        left={<>
          <Kv title={A('myAccount')} rows={[
            { k: A('kName'), v: ctx.me.name }, { k: A('email'), v: ctx.me.email },
            { k: A('kRole'), v: A(ctx.me.role === 'owner' ? 'roleOwnerV' : ctx.me.role === 'finance' ? 'roleFinanceV' : 'roleSupportV') },
            { k: A('kLastSignInMe'), v: ctx.me.lastLoginAt ? `${rel(ctx.me.lastLoginAt)} ${ft(ctx.me.lastLoginAt)}` : '—' },
          ]} />
          <SetBlock title={A('signInRules')} rows={rows([
            row('auth.admin.max_failed_attempts', A('rTries'), A('rTriesS'), 1, 3, 10, (n) => A('uTries', { a: n })),
            row('auth.lock_minutes', A('rLock'), '', 5, 5, 60, (n) => A('uMinutes', { a: n })),
            row('auth.admin_idle_signout_minutes', A('rIdle'), '', 5, 10, 120, (n) => A('uMinutes', { a: n })),
          ])} />
        </>}
        right={<AccountSecurity ctx={ctx} />} />
    );
  }
  return (
    <Page title={A('setTitle')} sub={A(subs[tab])}>
      <Tool groups={[{ label: A('fShow'), cur: tab, pick: (v) => ctx.nav({ v: 'settings', tab: v as typeof tab }), opts: [{ v: 'rules', l: A('tRules') }, { v: 'team', l: A('tTeam') }, { v: 'safety', l: A('tSafety') }, { v: 'account', l: A('tAccount') }] }]} />
      {set.data ? body : <Loading error={set.error} retry={set.reload} />}
    </Page>
  );
}

function TeamTab({ ctx }: { ctx: Ctx }) {
  const team = useLoad<Team[]>('/admin/team');
  const [selId, setSelId] = useState<string | null>(null);
  const isOwner = ctx.me.role === 'owner';
  if (!team.data) return <Loading error={team.error} retry={team.reload} />;
  const sel = team.data.find((m) => m.id === selId) ?? team.data[0];
  const roles = [{ v: 'owner', l: A('roleOwner') }, { v: 'finance', l: A('roleFinance') }, { v: 'support', l: A('roleSupport') }];
  const invite = () => ctx.open({
    title: A('invTitle'), sub: A('invSub'), list: [A('rolesList1'), A('rolesList2'), A('rolesList3')], ok: A('invOk'),
    groups: [{ label: A('role'), key: 'role', opts: roles }],
    inputs: [{ label: A('fullName'), key: 'name', ph: A('fullNamePh') }, { label: A('email'), key: 'email', ph: A('emailPh'), type: 'email' }],
    need: (f) => (f.name ?? '').trim().length > 2 && /@/.test(f.email ?? '') && !!f.role,
    go: (f) => act(async () => {
      const r = await post('/team', { name: f.name.trim(), email: f.email.trim(), role: f.role }) as { tempPassword: string };
      team.reload();
      // The temporary password is shown this once.
      ctx.open({ title: A('tempTitle', { a: f.name.trim() }), sub: A('tempSub'), list: [r.tempPassword], ok: A('done'), noCancel: true, go: async () => ctx.close() });
    }),
  });
  const changeRole = (m: Team) => ctx.open({
    title: A('roleTitle'), sub: A('roleSub', { a: m.name, b: roleL(m.role) }), list: m.me ? [A('roleSelf')] : [], note: A('roleNote'), ok: A('roleTitle'),
    groups: [{ label: A('newRole'), key: 'role', opts: roles }], need: (f) => !m.me && !!f.role && f.role !== m.role,
    go: (f) => act(async () => { await post(`/team/${m.id}/role`, { role: f.role }); ctx.close(); ctx.toast(A('roleChanged')); team.reload(); }),
  });
  const turnOff = (m: Team) => ctx.open({
    title: A('offTitle', { a: m.name }), sub: A('offSub', { a: roleL(m.role), b: m.email }), list: [A('off1'), A('off2')], ok: A('turnOff'), danger: true,
    go: () => act(async () => { await post(`/team/${m.id}/disable`); ctx.close(); ctx.toast(A('offDone', { a: m.name })); team.reload(); }),
  });
  return (
    <Cols lw="1fr" rw="400px"
      left={<>
        <RecoveryWaiting ctx={ctx} />
        <List title={A('admins', { a: team.data.length })} more={isOwner ? { t: A('invite'), go: invite } : undefined}
          rows={team.data.map((m) => ({ t: m.me ? A('you', { a: m.name }) : m.name, s: A('adminSub', { a: roleL(m.role), b: m.email, c: m.lastLoginAt ? rel(m.lastLoginAt) : A('never') }), pill: m.status === 'active' ? 'aon' : 'toff', on: m.id === sel.id, go: () => setSelId(m.id) }))} />
        <Kv title={A('rolesCan')} rows={[1, 2, 3, 4, 5, 6, 7, 8].map((i) => ({ k: A(`perm${i}`), v: A(`perm${i}v`) }))} />
      </>}
      right={<>
        {isOwner && sel && (
          <List title={A('memberHead', { a: sel.name, b: roleL(sel.role) })} rows={[
            { t: A('changeRole'), s: A('nowRole', { a: roleL(sel.role) }), go: () => changeRole(sel) },
            ...(sel.status === 'active' ? [sel.me ? { t: A('turnOffSelf'), s: A('askOwner') } : { t: A('turnOff'), s: A('turnOffS'), go: () => turnOff(sel), sc: RED }] : []),
          ]} />
        )}
        <Note t={A('twoOwnersNote')} />
        <Kv title={A('newAdmins')} rows={[{ k: A('theySetUp'), v: A('theySetUpV') }, { k: A('bkCodes'), v: A('bkCodesV') }]} />
      </>} />
  );
}

function SafetyTab({ ctx, flags }: { ctx: Ctx; flags: Array<{ t: string; s?: string; v: string; dec?: () => void; inc?: () => void }> }) {
  const k = useLoad<Kill>('/admin/kill-switch');
  const isOwner = ctx.me.role === 'owner';
  if (!k.data) return <Loading error={k.error} retry={k.reload} />;
  const kill = k.data;
  const flip = (on: boolean) => ctx.open({
    title: on ? A('kmOnTitle') : A('kmOffTitle'), sub: on ? A('kmOnSub') : A('kmOffSub'), list: on ? [A('km1'), A('km2'), A('km3')] : [],
    ok: on ? A('kmOk') : A('kmOkOff'), danger: on,
    inputs: [
      ...(on ? [{ label: A('kmWhy'), key: 'reason', ph: A('kmWhyPh'), tall: true }, { label: A('kmMsg'), key: 'msg', tall: true, initial: A('kmMsgDefault') }] : []),
      // The build plan asks for the password and a code here (the board shows the code only).
      { label: A('password'), key: 'password', ph: A('passwordPh'), type: 'password' },
      { label: A('kmCode'), key: 'code', ph: '000000' },
    ],
    need: (f) => (f.code ?? '').replace(/\D/g, '').length === 6 && !!f.password && (!on || ((f.reason ?? '').trim().length > 3 && !!(f.msg ?? '').trim())),
    go: (f) => act(async () => {
      await post('/kill-switch', { on, message: on ? f.msg.trim() : undefined, reason: on ? f.reason.trim() : undefined, password: f.password, code: f.code.replace(/\D/g, '') });
      ctx.close(); ctx.toast(on ? A('kmPaused') : A('kmBack')); k.reload(); ctx.refresh();
    }),
  });
  return (
    <Cols lw="1fr" rw="1fr"
      left={<>
        <List title={A('allStamping')} rows={[
          kill.on ? { t: A('stampingPaused'), s: A('killBy', { a: kill.reason, b: kill.changedAt ? `${fd(kill.changedAt)} ${ft(kill.changedAt)}` : '', c: kill.changedBy ?? '' }), pill: 'killp' } : { t: A('stampingOn'), s: A('stampingOnS'), pill: 'pson' },
          kill.on ? { t: A('killOff'), s: A('killOffS'), go: isOwner ? () => flip(false) : undefined } : { t: A('killOn'), s: isOwner ? A('killOnS') : A('ownerOnly'), go: isOwner ? () => flip(true) : undefined, sc: RED },
        ]} />
        <Note t={A('killNote')} />
      </>}
      right={<>
        {flags.length > 0 && <SetBlock title={A('flagsTitle')} rows={flags} />}
        <Note t={A('flagsNote')} />
      </>} />
  );
}
