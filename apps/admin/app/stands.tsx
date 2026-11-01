'use client';

import { authed } from '@temelash/ui';
import { A, GREY, Kv, List, Note, Page, RED, Stats, Steps, Table, Timeline, Tool, birr, failText, fd, ft, signal401, useLoad, type Ctx, type Row, type View } from './ui';

/** AdminStandsProduction / Prices / Stock, and AdminReqStand* inside a request. */

const post = <T = unknown>(path: string, body: object = {}) => authed<T>('admin', 'POST', '/admin' + path, body).catch((e) => { signal401(e); throw e; });
async function act(fn: () => Promise<unknown>) {
  try { await fn(); } catch (e) { throw new Error(failText(e)); }
}

type Names = Record<string, string>;
interface Item { id: string; name: Names; price: number; visible: boolean; stock: number; lowAt: number }
interface Line { itemId: string; qty: number; price: number; name: Names }
interface Stands {
  items: Item[]; low: number;
  production: Array<{ id: string; name: Names; price: number; ordered: number; stock: number; toMake: number }>;
  orders: Array<{ id: string; code: string; stage: Stage; createdAt: string; requestId: string | null; business: string; branch: string; address: string | null; lines: Line[] }>;
}
type Stage = 'placed' | 'confirmed' | 'printing' | 'way' | 'delivered';
const STAGES: Stage[] = ['placed', 'confirmed', 'printing', 'way', 'delivered'];
const STAGE_KEY: Record<Stage, string> = { placed: 'sgPlaced', confirmed: 'sgConfirmed', printing: 'sgPrinting', way: 'sgWay', delivered: 'sgDelivered' };
const stageL = (st: Stage) => A(STAGE_KEY[st]);
const linesText = (lines: Line[]) => lines.map((l) => `${l.name.en} × ${l.qty}`).join(', ');

export function StandsPage({ ctx, view }: { ctx: Ctx; view: Extract<View, { v: 'stands' }> }) {
  const r = useLoad<Stands>('/admin/stands');
  const tab = view.tab ?? 'prod';
  const canPrice = ctx.me.role === 'owner' || ctx.me.role === 'finance';
  if (!r.data) return <Page title={A('stdTitle')}><Note t={r.error ? A('couldNotLoad') : A('loading')} tone="solid" /></Page>;
  const d = r.data;
  const tabs = <Tool groups={[{ label: A('fShow'), cur: tab, pick: (v) => ctx.nav({ v: 'stands', tab: v as 'prod' | 'price' | 'stock' }), opts: [{ v: 'prod', l: A('stdProd') }, { v: 'price', l: A('stdPrices') }, { v: 'stock', l: A('stdStockN', { a: d.low }) }] }]} />;
  const price = (it: Item) => ctx.open({
    title: it.name.en, sub: A('stdNow', { a: birr(it.price) }), note: A('stdPriceNote'), ok: A('save'),
    groups: [{ label: A('stdCanOrder'), key: 'on', initial: it.visible ? 'yes' : 'no', opts: [{ v: 'yes', l: A('yes') }, { v: 'no', l: A('stdHide') }] }],
    inputs: [{ label: A('stdPriceLbl'), key: 'price', type: 'number', initial: String(it.price) }],
    need: (f) => Number(f.price) > 0,
    go: (f) => act(async () => { await post(`/stands/items/${it.id}`, { price: Number(f.price), visible: f.on !== 'no' }); ctx.close(); ctx.toast(A('stdSaved')); r.reload(); }),
  });
  const stock = (it: Item) => ctx.open({
    title: A('stdStockTitle', { a: it.name.en }), sub: A('stdStockSub', { a: it.stock, b: it.lowAt }), note: A('stdStockNote'), ok: A('save'),
    groups: [{ label: A('why'), key: 'reason', initial: 'stdMade', opts: ['stdMade', 'stdBought', 'stdUsed', 'stdCounted', 'stdDamaged'].map((k) => ({ v: k, l: A(k) })) }],
    inputs: [{ label: A('stdChangeLbl'), key: 'qty', ph: A('stdChangePh') }],
    need: (f) => /^-?\d+$/.test((f.qty ?? '').trim()) && Number(f.qty) !== 0 && !!f.reason,
    go: (f) => act(async () => {
      const res = await post<{ stock: number }>(`/stands/stock/${it.id}`, { change: Number(f.qty), reason: A(f.reason) });
      ctx.close(); ctx.toast(A('stdStockNow', { a: res.stock })); r.reload(); ctx.refresh();
    }),
  });
  let body: React.ReactNode;
  if (tab === 'prod') {
    const need = d.production.filter((p) => p.ordered > 0);
    body = <>
      <Stats cols={4} items={[
        { v: String(d.orders.length), l: A('stdToPrep'), s: A('stdToPrepS'), sc: GREY },
        { v: String(d.production.reduce((a, p) => a + p.ordered, 0)), l: A('stdOrdered'), s: A('stdOrderedS'), sc: GREY },
        { v: String(d.production.reduce((a, p) => a + p.toMake, 0)), l: A('stdToMake'), s: A('stdToMakeS'), sc: GREY },
        { v: String(d.low), l: A('stdLow'), s: A('stdLowS'), sc: d.low ? RED : GREY },
      ]} />
      <Table title={A('stdWhat')} cols="2fr 1fr 1fr 1.2fr" heads={[{ h: A('hItem') }, { h: A('hOrdered'), right: true }, { h: A('hInStock'), right: true }, { h: A('hToMake'), right: true }]}
        rows={need.map((p) => ({ cells: [{ t: p.name.en, s: A('stdEach', { a: birr(p.price) }), b: true }, { t: String(p.ordered), right: true }, { t: String(p.stock), right: true }, { t: p.toMake ? String(p.toMake) : A('stdEnough'), right: true, b: !!p.toMake, c: p.toMake ? RED : '#333' }] }))}
        empty={A('stdNoPrep')} foot={A('stdProdFoot')} />
      <Table title={A('stdOrders')} cols="1fr 1.6fr 2.2fr 1fr" heads={[{ h: A('hOrder') }, { h: A('hBusiness') }, { h: A('hItems') }, { h: A('hStep') }]}
        rows={d.orders.map((o) => ({ go: o.requestId ? () => ctx.nav({ v: 'requests', id: o.requestId!, type: 'stand_order' }) : undefined, cells: [{ t: o.code, s: fd(o.createdAt) }, { t: o.business, s: [o.branch, o.address].filter(Boolean).join(' · ') }, { t: linesText(o.lines) }, { t: stageL(o.stage) }] }))}
        empty={A('stdNoWaiting')} />
    </>;
  } else if (tab === 'price') {
    body = <>
      <Table title={A('stdPriceList')} cols="2fr 1fr 1fr" heads={[{ h: A('hItem') }, { h: A('hPrice'), right: true }, { h: A('hOwnersOrder') }]}
        rows={d.items.map((it) => ({ go: canPrice ? () => price(it) : undefined, cells: [{ t: it.name.en, b: true }, { t: birr(it.price), right: true, b: true }, { pill: it.visible ? 'okst' : 'toff' }] }))}
        foot={canPrice ? A('stdPriceFoot') : A('stdPriceFootRo')} />
    </>;
  } else {
    body = <Table title={A('stdStock')} cols="2fr 1fr 1fr 1fr" heads={[{ h: A('hItem') }, { h: A('hInStock'), right: true }, { h: A('hWarnAt'), right: true }, { h: A('hStatus') }]}
      rows={d.items.map((it) => ({ go: () => stock(it), cells: [{ t: it.name.en, b: true }, { t: String(it.stock), right: true, b: true }, { t: String(it.lowAt), right: true }, { pill: it.stock <= it.lowAt ? 'lowst' : 'okst' }] }))}
      foot={A('stdStockFoot')} />;
  }
  return (
    <Page title={A('stdTitle')} sub={A('stdSub')} btns={tab === 'prod' ? [{ t: A('printList'), kind: 'outline', go: () => window.print() }] : []}>
      {tabs}
      {body}
    </Page>
  );
}

interface Order {
  id: string; code: string; stage: Stage; status: 'open' | 'done' | 'cancelled'; total: number; phone: string; language: string;
  received: 'ok' | 'problem' | null; receivedAt: string | null; receivedPay: 'cash' | 'telebirr' | null; receivedNote: string | null;
  cashReceived: number | null; result: string | null; createdAt: string; branch: string; address: string | null; business: string; businessId: string;
  lines: Line[]; history: Array<{ kind: string; stage: string | null; note: string | null; actorType: string; at: string }>;
}

/** AdminReqStand, AdminReqStandProblem, AdminReqStandDone: the steps, the owner's receipt, the order and the next step. */
export function StandRequest({ ctx, orderId, onChange }: { ctx: Ctx; orderId: string; onChange: () => void }) {
  const r = useLoad<Order>(`/admin/stands/orders/${orderId}`);
  if (!r.data) return <Note t={r.error ? A('couldNotLoad') : A('loading')} />;
  const o = r.data;
  const at = STAGES.indexOf(o.stage);
  const reload = () => { r.reload(); onChange(); };
  const step = (path: string, body: object, toast: string) => act(async () => { await post(`/stands/orders/${o.id}/${path}`, body); ctx.toast(toast); reload(); });
  const out: React.ReactNode[] = [<Steps key="st" steps={STAGES.map(stageL)} at={at} />];
  out.push(<Kv key="rc" title={A('stdReceipt')} rows={[
    { k: A('hStatus'), v: o.received === 'ok' ? A('stdRcOk') : o.received === 'problem' ? A('stdRcProb') : at >= 3 ? A('stdRcWait') : A('stdRcNotYet') },
    { k: A('hWhen'), v: o.receivedAt ? `${fd(o.receivedAt)} ${A('at')} ${ft(o.receivedAt)}` : '–' },
    { k: A('stdOwnerSaid'), v: o.received === 'ok' ? A('stdAllFine') + (o.receivedPay ? A('stdPaidBy', { a: A(o.receivedPay === 'telebirr' ? 'mTelebirr' : 'mCash').toLowerCase() }) : '') : o.received === 'problem' ? (o.receivedNote ?? '') : '–' },
  ]} />);
  out.push(<Kv key="or" title={A('stdTheOrder')} rows={[
    { k: A('hOrder'), v: o.code }, { k: A('hItems'), v: linesText(o.lines) }, { k: A('total'), v: birr(o.total) },
    { k: A('stdPayment'), v: o.cashReceived !== null ? A('stdCashIn') : A('stdCod') },
    { k: A('stdDeliverTo'), v: [o.business, o.branch, o.address].filter(Boolean).join(', ') }, { k: A('stdCall'), v: o.phone },
    { k: A('stdPrinted'), v: o.language === 'all' ? A('stdAllThree') : ({ en: 'English', am: 'Amharic', om: 'Afaan Oromoo' } as Record<string, string>)[o.language] ?? o.language },
    { k: A('stdPlaced'), v: `${fd(o.createdAt)} ${A('at')} ${ft(o.createdAt)}` },
  ]} />);
  if (o.status !== 'open') {
    out.push(<Note key="fin" t={o.result ?? ''} tone="solid" />);
  } else {
    const rows: Row[] = [];
    const nxt = STAGES[at + 1];
    if (nxt) {
      rows.push({ t: A('stdMoveTo', { a: stageL(nxt) }), s: at === 0 ? A('stdAfterCall', { a: o.phone }) : at === 3 ? A('stdOwnerConfirms') : A('stdOwnerFollows'), go: () => step('stage', { stage: nxt }, `${o.code}: ${stageL(nxt)}.`) });
    } else if (o.received === 'problem') {
      rows.push({ t: A('stdReplace'), s: A('stdReplaceS'), go: () => step('replace', {}, A('stdReplaced', { a: o.code })) });
      rows.push({ t: A('stdCloseNo'), s: A('stdCloseNoS'), sc: RED, go: () => ctx.open({
        title: A('stdCloseNo'), sub: o.code, ok: A('stdCloseOk'), danger: true,
        inputs: [{ label: A('stdAgreed'), key: 'reason', ph: A('stdAgreedPh') }], need: (f) => !!f.reason?.trim(),
        go: (f) => act(async () => { await post(`/stands/orders/${o.id}/close`, { reason: f.reason.trim() }); ctx.close(); ctx.toast(A('stdClosed', { a: o.code })); reload(); }),
      }) });
    }
    if (o.stage === 'delivered' && o.received !== 'problem') {
      if (!o.received) rows.push({ t: A('stdRemind'), s: A('stdRemindS'), go: () => step('remind', {}, A('stdReminded')) });
      rows.push({ t: A('stdCash'), s: A('stdCashS', { a: birr(o.total) }), go: () => step('cash', {}, A('stdCashDone', { a: o.code, b: birr(o.total) })) });
    }
    if (at < 3) {
      rows.push({ t: A('stdCancel'), s: A('stdCancelS'), sc: RED, go: () => ctx.open({
        title: A('stdCancelTitle', { a: o.code }), sub: A('stdCancelSub'), ok: A('stdCancelOk'), danger: true,
        groups: [{ label: A('reason'), key: 'reason', opts: ['stdC1', 'stdC2', 'stdC3', 'other'].map((k) => ({ v: A(k), l: A(k) })) }],
        inputs: [{ label: A('noteOpt'), key: 'note', ph: A('noteOptPh') }], need: (f) => !!f.reason,
        go: (f) => act(async () => { await post(`/stands/orders/${o.id}/cancel`, { reason: f.note?.trim() ? `${f.reason}: ${f.note.trim()}` : f.reason }); ctx.close(); ctx.toast(A('stdCancelled', { a: o.code })); reload(); }),
      }) });
    }
    out.push(<List key="act" title={A('nextStep')} rows={rows} />);
  }
  const KIND: Record<string, string> = { placed: 'hkPlaced', stage: 'hkStage', received: 'hkReceived', problem: 'hkProblem', replacement: 'hkReplacement', reminded: 'hkReminded', closed: 'hkClosed', cancelled: 'hkCancelled' };
  out.push(<Timeline key="hist" title={A('stdHistory')} rows={o.history.map((h) => ({
    t: A(KIND[h.kind] ?? 'hkStage', { a: h.stage ? stageL(h.stage as Stage) : '' }), s: h.note ?? undefined, w: `${fd(h.at)} ${ft(h.at)} · ${h.actorType === 'owner' ? A('stdByOwner') : A('stdByTeam')}`,
  }))} />);
  return <>{out}</>;
}
