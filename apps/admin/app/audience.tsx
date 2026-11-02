'use client';

import { useState } from 'react';
import { authed } from '@temelash/ui';
import { A, Bars, Cols, GREY, Kv, Note, Page, Stats, Table, Tool, ft, num, signal401, useLoad, type Ctx } from './ui';

/** AdminAudience: every client across all businesses, counted once by phone number. */

interface Audience {
  at: string; unique: number; cards: number; businesses: number; multi: number; dist: Record<'1' | '2' | '3', number>;
  per: Array<{ id: string; name: string; category: string; city: string; cards: number; only: number; shared: number }>;
}

export function AudiencePage({ ctx }: { ctx: Ctx }) {
  const r = useLoad<Audience>('/admin/audience');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  if (!r.data) return <Page title={A('auTitle')}><Note t={r.error ? A('couldNotLoad') : A('loading')} tone="solid" /></Page>;
  const d = r.data;
  const pct = (n: number) => (d.unique ? Math.round((n / d.unique) * 100) : 0);
  const next = new Date(new Date(d.at).getTime() + 12 * 3_600_000);
  const refresh = async () => {
    setBusy(true);
    try {
      const x = await authed<Audience>('admin', 'POST', '/admin/audience/refresh', {}).catch((e) => { signal401(e); throw e; });
      ctx.toast(A('auRefreshed', { a: num(x.unique) }));
      r.reload();
    } finally { setBusy(false); }
  };
  const rows = d.per.filter((b) => `${b.name} ${b.category} ${b.city}`.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <Page title={A('auTitle')} sub={A('auSub')} btns={[{ t: A('auRefresh'), kind: 'outline', go: refresh, disabled: busy }]}>
      <Stats cols={4} items={[
        { v: num(d.unique), l: A('auUnique'), s: A('auUniqueS'), sc: GREY },
        { v: num(d.cards), l: A('auCards'), s: A('auCardsS', { a: d.businesses }), sc: GREY },
        { v: num(d.multi), l: A('auMulti'), s: A('auMultiS', { a: pct(d.multi) }), sc: GREY },
        { v: ft(d.at), l: A('auLast'), s: A('auNext', { a: ft(next) }), sc: GREY },
      ]} />
      <Tool search={{ value: q, onChange: setQ, ph: A('auSearch') }} groups={[]} />
      <Cols lw="1fr" rw="340px"
        left={<Table title={A('auPerBiz')} cols="2fr 1fr 1fr 1fr" heads={[{ h: A('hBusiness') }, { h: A('auCardsH'), right: true }, { h: A('auOnly'), right: true }, { h: A('auAlso'), right: true }]}
          rows={rows.map((b) => ({ go: () => ctx.nav({ v: 'business', id: b.id, tab: 'customers' }), cells: [
            { t: b.name, s: b.city, b: true }, { t: num(b.cards), right: true }, { t: num(b.only), right: true },
            { t: num(b.shared), s: b.cards ? `${Math.round((b.shared / b.cards) * 100)}%` : '', right: true },
          ] }))}
          empty={A('auNone')} foot={A('auFoot')} />}
        right={<>
          <Bars title={A('auByShops')} sub={A('auUnique')} note={A('auBarsNote')} bars={[
            { l: A('auOne'), v: d.dist['1'] }, { l: A('auTwo'), v: d.dist['2'] }, { l: A('auThree'), v: d.dist['3'], on: true },
          ]} />
          <Kv title={A('auHow')} rows={[
            { k: A('auSame'), v: A('auSameV') }, { k: A('auMatched'), v: A('auMatchedV') }, { k: A('auUpdates'), v: A('auUpdatesV') },
            { k: A('auDeleted'), v: A('auDeletedV') },
          ]} />
        </>} />
    </Page>
  );
}
