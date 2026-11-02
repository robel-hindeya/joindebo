'use client';

import { authed } from '@temelash/ui';
import { A, Cols, List, Note, RED, failText, fd, signal401, useLoad, type Ctx, type Row } from './ui';

/** AdminBusinessSupport (the Support tab), AdminFollowUp, AdminViewAsOwner, AdminEditBusiness, merge and close a branch. */

const post = <T = unknown>(path: string, body: object = {}) => authed<T>('admin', 'POST', '/admin' + path, body).catch((e) => { signal401(e); throw e; });
const get = <T,>(path: string) => authed<T>('admin', 'GET', '/admin' + path).catch((e) => { signal401(e); throw e; });
async function act(fn: () => Promise<unknown>) {
  try { await fn(); } catch (e) { throw new Error(failText(e)); }
}

interface FollowUp { id: string; text: string; due: string; doneAt: string | null; assignee: string | null }
interface Biz { id: string; name: string; category: string; city: string; branches: Array<{ id: string; name: string; status?: string }>; people: Array<{ name: string; role: string }> }
const CAT: Record<string, string> = { cafe: 'catCafe', salon: 'catSalon', spa: 'catSpa', restaurant: 'catRestaurant', car_wash: 'catCarWash', barber: 'catBarber', bakery: 'catBakery', food: 'catFood', other: 'catOther' };
const CATS = ['cafe', 'restaurant', 'food', 'bakery', 'salon', 'barber', 'spa', 'car_wash', 'other'];
const dueDay = (d: string) => fd(d + 'T12:00:00+03:00');

export function SupportTab({ ctx, biz, onChange }: { ctx: Ctx; biz: Biz; onChange: () => void }) {
  const fu = useLoad<FollowUp[]>(`/admin/businesses/${biz.id}/follow-ups`);
  const team = useLoad<Array<{ id: string; name: string; status: string }>>('/admin/team');
  const all = useLoad<Array<{ id: string; name: string; status: string }>>('/admin/businesses');
  const today = new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
  const reload = () => { fu.reload(); onChange(); };

  const addFollowUp = () => ctx.open({
    title: A('fuTitle'), sub: biz.name, note: A('fuNote'), ok: A('fuOk'),
    groups: [
      { label: A('fuWhen'), key: 'when', initial: 'tomorrow', opts: [{ v: 'today', l: A('fuToday') }, { v: 'tomorrow', l: A('fuTomorrow') }, { v: 'three', l: A('fuThree') }, { v: 'week', l: A('fuWeek') }] },
      { label: A('fuWho'), key: 'who', initial: ctx.me.id, opts: (team.data ?? []).filter((m) => m.status === 'active').map((m) => ({ v: m.id, l: m.name })) },
    ],
    inputs: [{ label: A('fuWhat'), key: 'text', ph: A('fuWhatPh'), tall: true }],
    need: (f) => (f.text ?? '').trim().length > 3 && !!f.when && !!f.who,
    go: (f) => act(async () => { await post(`/businesses/${biz.id}/follow-ups`, { text: f.text.trim(), when: f.when, assigneeId: f.who }); ctx.close(); ctx.toast(A('fuAdded')); reload(); }),
  });
  const flip = async (f: FollowUp) => { await post(`/follow-ups/${f.id}/done`); ctx.toast(f.doneAt ? A('fuReopened') : A('fuDone')); reload(); };

  const viewOwner = async () => {
    const v = await get<{ name: string; owner: string | null; customers: number; stamps30: number; team: number; branches: number; lastStamp: string | null; waiting: number; alerts: number }>(`/businesses/${biz.id}/owner-view`);
    ctx.open({
      title: A('voTitle', { a: (v.owner ?? '').split(' ')[0] }), sub: A('voSub', { a: v.name }), ok: A('close'), noCancel: true,
      list: [A('voStamps', { a: v.stamps30 }), A('voCustomers', { a: v.customers }), A('voTeam', { a: v.team, b: v.branches }), A('voLast', { a: v.lastStamp ? fd(v.lastStamp) : '—' }), A('voWaiting', { a: v.waiting, b: v.alerts })],
      note: A('voNote'), go: async () => ctx.close(),
    });
  };

  const edit = () => ctx.open({
    title: A('edTitle'), sub: A('edSub'), note: A('edNote'), ok: A('edOk'),
    groups: [{ label: A('edCat'), key: 'cat', initial: biz.category, opts: CATS.map((c) => ({ v: c, l: A(CAT[c]) })) }],
    inputs: [
      { label: A('edName'), key: 'name', initial: biz.name }, { label: A('edCity'), key: 'city', initial: biz.city },
      { label: A('edOwner'), key: 'owner', initial: biz.people.find((p) => p.role === 'owner')?.name ?? '' },
    ],
    need: (f) => (f.name ?? '').trim().length > 1 && (f.city ?? '').trim().length > 1 && (f.owner ?? '').trim().length > 1 && !!f.cat,
    go: (f) => act(async () => {
      const r = await post<{ changed: string[] }>(`/businesses/${biz.id}/details`, { name: f.name, city: f.city, owner: f.owner, category: f.cat });
      ctx.close(); ctx.toast(r.changed.length ? A('edSaved') : A('edNothing')); onChange();
    }),
  });

  const merge = () => ctx.open({
    title: A('mgTitle', { a: biz.name }), sub: A('mgSub'), note: A('mgNote'), ok: A('mgOk'), danger: true,
    pre: [{ label: A('mgFind'), key: 'find', ph: A('mgFindPh') }],
    groups: [{ label: A('mgPick'), key: 'from', filterBy: 'find', opts: (all.data ?? []).filter((x) => x.id !== biz.id && x.status !== 'closed' && x.status !== 'rejected').map((x) => ({ v: x.id, l: x.name })) }],
    list: [A('mgL1', { a: biz.name }), A('mgL2'), A('mgL3')],
    need: (f) => !!f.from,
    go: (f) => act(async () => {
      const r = await post<{ customers: number }>(`/businesses/${biz.id}/merge`, { from: f.from });
      ctx.close(); ctx.toast(A('mgDone', { a: r.customers }, r.customers)); onChange();
    }),
  });

  const open = biz.branches.filter((x) => (x.status ?? 'active') === 'active');
  const closeBranch = () => ctx.open({
    title: A('cbrTitle'), sub: A('cbrSub', { a: biz.name, b: open.length }), note: A('cbrNote'), ok: A('cbrOk'), danger: true,
    groups: [{ label: A('cbrWhich'), key: 'br', opts: open.map((x) => ({ v: x.id, l: x.name })) }],
    list: [A('cbrL1', { a: open.length - 1 }, open.length - 1), A('cbrL2'), A('cbrL3')],
    need: (f) => !!f.br,
    go: (f) => act(async () => { await post(`/branches/${f.br}/close`); ctx.close(); ctx.toast(A('cbrDone')); onChange(); }),
  });

  const list = fu.data ?? [];
  const tools: Row[] = [
    { t: A('stSee'), s: A('stSeeS'), go: viewOwner },
    { t: A('fuTitle'), s: A('stFuS'), go: addFollowUp },
    { t: A('edTitle'), s: A('stEditS'), go: edit },
    { t: A('stMerge'), s: A('stMergeS'), go: merge },
    ...(open.length > 1 ? [{ t: A('cbrTitle'), s: A('cbrRowS', { a: open.length }), go: closeBranch, sc: RED }] : []),
  ];
  return (
    <Cols lw="1fr" rw="380px"
      left={<List title={A('fuList')} empty={A('fuEmpty')} more={{ t: A('fuTitle'), go: addFollowUp }} rows={list.map((f) => ({
        t: f.text, s: `${f.assignee ?? '—'} · ${f.doneAt ? A('fuIsDone') : A('fuDue', { a: dueDay(f.due) })}`, go: () => flip(f), dim: !!f.doneAt,
        pill: f.doneAt ? 'rdone' : f.due < today ? 'overdue' : 'rnew',
      }))} />}
      right={<>
        <List title={A('stTools')} rows={tools} />
        <Note t={A('stNote')} />
      </>} />
  );
}

/** Overview: "Follow-ups due". */
export function FollowUpsDue({ ctx }: { ctx: Ctx }) {
  const r = useLoad<Array<{ id: string; text: string; due: string; assignee: string | null; businessId: string; business: string }>>('/admin/follow-ups?due=1');
  return (
    <List title={A('fuDueTitle')} empty={A('fuDueEmpty')} rows={(r.data ?? []).slice(0, 4).map((f) => ({
      t: `${f.business} · ${f.text}`, s: `${f.assignee ?? '—'} · ${A('fuDue', { a: dueDay(f.due) })}`, pill: 'rnew',
      go: () => ctx.nav({ v: 'business', id: f.businessId, tab: 'support' }),
    }))} />
  );
}
