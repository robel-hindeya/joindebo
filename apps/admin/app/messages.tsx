'use client';

import { useState } from 'react';
import { authed } from '@temelash/ui';
import { A, Cols, GREY, Head, Kv, List, Note, Page, RED, Stats, failText, fd, signal401, useLoad, type Ctx, type ModalSpec } from './ui';

/** AdminMessages / AdminMessageCompose: messages to owners, opens and "send again". */

const post = <T = unknown>(path: string, body: object = {}) => authed<T>('admin', 'POST', '/admin' + path, body).catch((e) => { signal401(e); throw e; });
async function act(fn: () => Promise<unknown>) {
  try { await fn(); } catch (e) { throw new Error(failText(e)); }
}

const TPL = {
  pay: { t: 'tplPayT', x: 'tplPayX' },
  news: { t: 'tplNewsT', x: 'tplNewsX' },
} as const;

interface Msg { id: string; audience: string; audienceLabel: string; title: string; body: string; sms: boolean; at: string; by: string | null; recipients: number; opened: number }

/** "New message to owners": every business, payment due, one agent's businesses, or one business. */
export function composeMessage(ctx: Ctx, agents: Array<{ id: string; name: string }>, businesses: Array<{ id: string; name: string }>, start: { aud?: string; tpl?: 'pay' | 'news' }, done: () => void): ModalSpec {
  const tpl = start.tpl ? TPL[start.tpl] : null;
  return {
    title: A('mcTitle'), sub: A('mcSub'), ok: A('mcOk'), note: A('mcNote'),
    pre: [{ label: A('mcFindBiz'), key: 'find', ph: A('mcFindPh') }],
    groups: [
      { label: A('mcTo'), key: 'aud', initial: start.aud ?? 'all', opts: [{ v: 'all', l: A('audAll') }, { v: 'due', l: A('audDue') }, { v: 'agent', l: A('audAgent') }, { v: 'biz', l: A('audBiz') }] },
      { label: A('mcWhichAgent'), key: 'agent', when: (f) => f.aud === 'agent', opts: agents.map((g) => ({ v: g.id, l: g.name })) },
      { label: A('adPickBiz'), key: 'business', filterBy: 'find', when: (f) => f.aud === 'biz', opts: businesses.map((b) => ({ v: b.id, l: b.name })) },
      { label: A('mcStart'), key: 'tpl', initial: start.tpl ?? 'custom', opts: [{ v: 'pay', l: A('tplPayT') }, { v: 'news', l: A('tplNewsT') }, { v: 'custom', l: A('tplCustom') }],
        fills: { pay: { title: A('tplPayT'), body: A('tplPayX') }, news: { title: A('tplNewsT'), body: A('tplNewsX') }, custom: { title: '', body: '' } } },
      { label: A('mcSms'), key: 'sms', initial: start.tpl === 'pay' ? 'yes' : 'no', opts: [{ v: 'no', l: A('mcSmsNo') }, { v: 'yes', l: A('mcSmsYes') }] },
    ],
    inputs: [{ label: A('mcTitleLbl'), key: 'title', ph: A('mcTitlePh'), initial: tpl ? A(tpl.t) : '' }, { label: A('mcBody'), key: 'body', ph: A('mcBodyPh'), tall: true, initial: tpl ? A(tpl.x) : '' }],
    need: (f) => (f.title ?? '').trim().length > 2 && (f.body ?? '').trim().length > 5 && (f.aud !== 'agent' || !!f.agent) && (f.aud !== 'biz' || !!f.business),
    go: (f) => act(async () => {
      const r = await post<{ recipients: number }>('/messages', { audience: f.aud, agentId: f.agent, businessId: f.business, title: f.title.trim(), body: f.body.trim(), sms: f.sms === 'yes' });
      ctx.close(); ctx.toast(A('mcDone', { a: r.recipients }, r.recipients)); done();
    }),
  };
}

export function MessagesPage({ ctx }: { ctx: Ctx }) {
  const list = useLoad<Msg[]>('/admin/messages');
  const agents = useLoad<Array<{ id: string; name: string }>>(ctx.me.role === 'support' ? null : '/admin/agents');
  const biz = useLoad<Array<{ id: string; name: string }>>('/admin/businesses');
  const due = useLoad<{ overdue: unknown[]; businesses: Array<{ billing: string }> }>(ctx.me.role === 'support' ? null : '/admin/finance/summary');
  const [sel, setSel] = useState<string | null>(null);
  if (!list.data) return <Page title={A('msgTitle')}><Note t={list.error ? A('couldNotLoad') : A('loading')} tone="solid" /></Page>;
  const msgs = list.data;
  const m = msgs.find((x) => x.id === sel) ?? msgs[0];
  const month = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const mon = msgs.filter((x) => x.at >= month);
  const reach = mon.reduce((s, x) => s + x.recipients, 0);
  const read = mon.reduce((s, x) => s + x.opened, 0);
  const dueN = due.data ? due.data.businesses.filter((b) => ['due', 'overdue', 'partial'].includes(b.billing)).length : null;
  const open = (start: { aud?: string; tpl?: 'pay' | 'news' }) => ctx.open(composeMessage(ctx, agents.data ?? [], biz.data ?? [], start, list.reload));
  const again = (x: Msg) => ctx.open({
    title: A('maTitle'), sub: x.title, list: [A('maLeft', { a: x.recipients - x.opened }, x.recipients - x.opened), A('maText')], note: A('maNote'), ok: A('maOk'),
    go: () => act(async () => { const r = await post<{ recipients: number }>(`/messages/${x.id}/again`); ctx.close(); ctx.toast(A('maDone', { a: r.recipients }, r.recipients)); list.reload(); }),
  });
  return (
    <Page title={A('msgTitle')} sub={A('msgSub')} btns={[{ t: A('payReminders'), kind: 'outline', go: () => open({ aud: 'due', tpl: 'pay' }) }, { t: A('newMessage'), kind: 'primary', go: () => open({ aud: 'all' }) }]}>
      <Stats cols={4} items={[
        { v: String(mon.length), l: A('msgMonth'), s: A('last30') },
        { v: String(reach), l: A('ownersReached'), s: A('countedEach') },
        { v: reach ? `${Math.round((read / reach) * 100)}%` : '—', l: A('openedL'), s: A('ofN', { a: read, b: reach }) },
        { v: dueN === null ? '—' : String(dueN), l: A('ownersDue'), s: A('usePayRem'), sc: dueN ? RED : GREY },
      ]} />
      <Cols lw="440px" rw="1fr"
        left={<List title={A('msgN', { a: msgs.length }, msgs.length)} empty={A('noMessages')} rows={msgs.map((x) => ({
          t: x.title, s: `${x.audienceLabel} · ${A('ownersN', { a: x.recipients }, x.recipients)} · ${fd(x.at)}`, r: x.recipients ? `${Math.round((x.opened / x.recipients) * 100)}% ${A('openedSmall')}` : '', on: m?.id === x.id, go: () => setSel(x.id),
        }))} />}
        right={m ? <>
          <Head ini="M" title={m.title} sub={A('sentBy', { a: fd(m.at), b: m.by ?? '—' })} pill="pson" tags={[{ t: m.audienceLabel }, ...(m.sms ? [{ t: A('bySms') }] : [])]} />
          <Note t={m.body} tone="solid" />
          <Kv title={A('whoGotIt')} rows={[{ k: A('sentTo'), v: m.audienceLabel }, { k: A('ownersReached'), v: String(m.recipients) }, { k: A('openedIt'), v: A('ofN', { a: m.opened, b: m.recipients }) }, { k: A('notOpened'), v: String(m.recipients - m.opened) }, { k: A('shownIn'), v: A('shownInV') }]} />
          <List title={A('whatNext')} rows={[
            m.recipients - m.opened > 0 ? { t: A('sendAgainN', { a: m.recipients - m.opened }), s: A('sameText'), go: () => again(m) } : { t: A('everyoneOpened'), s: A('nothingAgain'), dim: true },
            { t: A('writeSimilar'), s: A('startFromThis'), go: () => ctx.open({ ...composeMessage(ctx, agents.data ?? [], biz.data ?? [], { aud: m.audience === 'biz' ? 'all' : m.audience }, list.reload), inputs: [{ label: A('mcTitleLbl'), key: 'title', initial: m.title }, { label: A('mcBody'), key: 'body', tall: true, initial: m.body }] }) },
          ]} />
        </> : <Note t={A('noMessages')} />} />
    </Page>
  );
}

/** "Message the owner" on a business page. */
export function messageOwner(ctx: Ctx, b: { id: string; name: string; owner: string; phone: string }, balance: string | null): ModalSpec {
  const first = b.owner.split(' ')[0];
  return {
    title: A('moTitle'), sub: `${b.owner} · ${b.phone}`, ok: A('mcOk'), note: A('moNote'),
    groups: [{ label: A('moStart'), key: 'tpl', opts: [{ v: 'pay', l: A('tplPayT') }, { v: 'verify', l: A('tplVerifyT') }, { v: 'custom', l: A('tplCustom') }],
      fills: { pay: { body: A('moPay', { a: first, b: b.name, c: balance ?? '' }) }, verify: { body: A('moVerify', { a: first, b: b.name }) }, custom: { body: '' } } },
      { label: A('mcSms'), key: 'sms', initial: 'yes', opts: [{ v: 'no', l: A('mcSmsNo') }, { v: 'yes', l: A('mcSmsYes') }] }],
    inputs: [{ label: A('mcBody'), key: 'body', tall: true, ph: A('moBodyPh') }],
    need: (f) => (f.body ?? '').trim().length > 3,
    go: (f) => act(async () => {
      const title = f.tpl === 'pay' ? A('tplPayT') : f.tpl === 'verify' ? A('tplVerifyT') : A('fromTemelash');
      await post(`/businesses/${b.id}/message`, { title, body: f.body.trim(), sms: f.sms === 'yes' });
      ctx.close(); ctx.toast(A('moDone', { a: first }));
    }),
  };
}
