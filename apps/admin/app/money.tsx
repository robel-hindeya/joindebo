'use client';

import { useState } from 'react';
import { MONTH_NAMES, ethiopianDateOf, formatEthiopianDate } from '@temelash/ethiopian-calendar';
import { authed } from '@temelash/ui';
import {
  A, Bars, Cols, GREY, Head, Kv, List, Note, Page, RED, Stats, Table, Tool, birr, failText, fd, fdy, num, signal401, useLoad,
  type Btn, type Ctx, type ModalSpec, type View,
} from './ui';

/**
 * Phase 5 money screens (Admin board): Finance, a business's Finance tab,
 * Receipt, Agents, an agent, Statement, Leaderboard, Finance report with the
 * government share, and the export check. Owner and Finance only.
 */

const post = <T = unknown>(path: string, body: object = {}) => authed<T>('admin', 'POST', '/admin' + path, body).catch((e) => { signal401(e); throw e; });
async function act(fn: () => Promise<unknown>) {
  try { await fn(); } catch (e) { throw new Error(failText(e)); }
}
/** "Tikimt 20, 2019" */
const ec = (d: string | Date) => formatEthiopianDate(ethiopianDateOf(new Date(d)));
const ecMonth = (m: number) => MONTH_NAMES.en[m - 1];
const METHODS = [{ v: 'telebirr', k: 'mTelebirr' }, { v: 'cbe_birr', k: 'mCbe' }, { v: 'cash', k: 'mCash' }, { v: 'bank', k: 'mBank' }];
const methodL = (m: string | null) => A(METHODS.find((x) => x.v === m)?.k ?? 'mCash');
const planName = (p: string | null) => A(p === 'pilot' ? 'planPilot' : p === 'starter' ? 'pnStarter' : p === 'full' ? 'pnFull' : 'planNone');
const brN = (n: number) => A('branchesN', { a: n }, n);

// ---------------------------------------------------------------- exports (AdminExportAuth)
/** "Export CSV": asks for the password and a fresh code every time, then downloads the file. */
export function exportButton(ctx: Ctx, kind: string, name: string, pii: boolean, label = A('exportCsv')): Btn {
  const spec: ModalSpec = {
    title: A('exTitle', { a: name }), sub: A('exSub'), list: [pii ? A('exPii') : A('exMoney')], note: A('exNote'), ok: A('exOk'),
    inputs: [{ label: A('exPw'), key: 'password', type: 'password' }, { label: A('exCode'), key: 'code', ph: '000000' }],
    need: (f) => !!f.password && (f.code ?? '').replace(/\D/g, '').length === 6,
    go: (f) => act(async () => {
      const r = await post<{ file: string; csv: string }>(`/exports/${kind}`, { password: f.password, code: f.code.replace(/\D/g, '') });
      const url = URL.createObjectURL(new Blob([r.csv], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url; link.download = r.file; link.click();
      URL.revokeObjectURL(url);
      ctx.close(); ctx.toast(A('exDone'));
    }),
  };
  return { t: label, kind: 'outline', go: () => ctx.open(spec) };
}

function Loading({ error }: { error: unknown }) {
  return <Note t={error ? A('couldNotLoad') : A('loading')} tone="solid" />;
}

// ---------------------------------------------------------------- Finance (AdminFinance*)
interface FinRow { id: string; name: string; status: string; agent: string | null; plan: string | null; branches: number | null; fee: number; paid: number; balance: number; dueOn: string | null; billing: string }
interface Summary { financeYear: number; yearEnds: string; collected: number; overdueBirr: number; overdue: FinRow[]; dueSoon: FinRow[]; commissionOwed: number; businesses: FinRow[] }
export function FinancePage({ ctx }: { ctx: Ctx }) {
  const s = useLoad<Summary>('/admin/finance/summary');
  const settings = useLoad<Array<{ key: string; value: unknown }>>('/admin/settings');
  const [bf, setBf] = useState('all');
  const [q, setQ] = useState('');
  if (!s.data) return <Page title={A('finTitle')}><Loading error={s.error} /></Page>;
  const d = s.data;
  const price = (k: string) => Number(settings.data?.find((x) => x.key === k)?.value ?? 0);
  const waiting = d.businesses.filter((b) => ['due', 'overdue', 'partial'].includes(b.billing));
  const trials = d.businesses.filter((b) => b.billing === 'btrial');
  const match = (b: FinRow) => (bf === 'all' || (bf === 'overdue' && b.billing === 'overdue') || (bf === 'due' && ['due', 'partial'].includes(b.billing)) || (bf === 'paid' && b.billing === 'paid') || (bf === 'trial' && b.billing === 'btrial') || (bf === 'pilot' && b.billing === 'pilot'))
    && (!q.trim() || b.name.toLowerCase().includes(q.trim().toLowerCase()));
  const L = d.businesses.filter(match);
  return (
    <Page title={A('finTitle')} sub={A('finSub', { a: d.financeYear, b: ec(d.yearEnds) })} btns={[exportButton(ctx, 'finance-list', A('exFinList', { a: d.financeYear }), false)]}>
      <Stats cols={5} items={[
        { v: birr(d.collected), l: A('fCollected'), s: A('fPaidFull', { a: d.businesses.filter((b) => b.billing === 'paid').length }) },
        { v: birr(waiting.reduce((x, b) => x + b.balance, 0)), l: A('fWaiting'), s: A('bizN', { a: waiting.length }, waiting.length) },
        { v: birr(d.overdueBirr), l: A('fOverdue'), s: A('bizN', { a: d.overdue.length }, d.overdue.length), sc: d.overdue.length ? RED : GREY },
        { v: birr(trials.reduce((x, b) => x + b.fee, 0)), l: A('fAfterTrials'), s: A('fOnTrial', { a: trials.length }) },
        { v: birr(d.commissionOwed), l: A('fCommOwed'), s: A('fEarnedNotPaid'), sc: d.commissionOwed ? RED : GREY, go: () => ctx.nav({ v: 'agents', owed: true }) },
      ]} />
      <Tool search={{ value: q, onChange: setQ, ph: A('fSearch') }} groups={[{ label: A('fShow'), cur: bf, pick: setBf, opts: [
        { v: 'all', l: A('all') }, { v: 'overdue', l: A('pOverdue') }, { v: 'due', l: A('fDueOrPart') }, { v: 'paid', l: A('pPaid') }, { v: 'trial', l: A('fOnTrialChip') }, { v: 'pilot', l: A('pPilot') },
      ] }]} />
      <Cols lw="1fr" rw="340px"
        left={<Table title={A('fThisYear')} cols="1.9fr 1.1fr 1fr 1fr 1fr 1.2fr"
          heads={[{ h: A('hBusiness') }, { h: A('kPlan') }, { h: A('hFee'), right: true }, { h: A('hPaid'), right: true }, { h: A('hBalance'), right: true }, { h: A('hStatus') }]}
          rows={L.map((b) => ({ go: () => ctx.nav({ v: 'business', id: b.id, tab: 'finance' }), cells: [
            { t: b.name, s: b.agent ?? '', b: true }, { t: planName(b.plan), s: b.branches ? brN(b.branches) : '' },
            { t: b.fee ? num(b.fee) : A('noFee'), right: true }, { t: num(b.paid), right: true },
            { t: b.fee ? num(b.balance) : '—', s: b.billing === 'overdue' && b.dueOn ? A('dueOn', { a: fd(b.dueOn) }) : '', right: true, c: b.billing === 'overdue' ? RED : '#333' },
            { pill: b.billing },
          ] }))} empty={A('nothingHere')} foot={A('fFoot')} />}
        right={<>
          <Kv title={A('priceList')} rows={[{ k: A('plStarter1'), v: birr(price('plan.starter.yearly_fee_birr')) }, { k: A('plFull2'), v: birr(price('plan.full.yearly_fee_birr')) }, { k: A('plExtraBr'), v: '+ ' + birr(price('plan.extra_branch.yearly_fee_birr')) }]} />
          <Kv title={A('howYear')} rows={[{ k: A('fyOpen'), v: A('fyOpenV') }, { k: A('fyStart'), v: A('fyStartV') }, { k: A('fyEnd'), v: `${ec(d.yearEnds)} (${fdy(d.yearEnds)})` }, { k: A('today'), v: ec(new Date()) }]} />
          <List title={A('dueSoonT')} empty={A('nothingDueSoon')} rows={d.dueSoon.map((b) => ({ t: b.name, s: A('dueOn', { a: fd(b.dueOn!) }), r: birr(b.balance), go: () => ctx.nav({ v: 'business', id: b.id, tab: 'finance' }) }))} />
        </>} />
    </Page>
  );
}

// ---------------------------------------------------------------- a business's Finance tab
interface Pay { id: string; receiptNo: string; original: number; amount: number; reversed: boolean; method: string; reference: string | null; at: string; financeYear: number; by: string }
interface BizFin { id: string; name: string; status: string; financeYear: number; yearEnds: string; plan: string | null; branches: number | null; fee: number; paid: number; balance: number; dueOn: string | null; billing: string; coversUntil: string | null; payments: Pay[] }
export function BusinessFinance({ ctx, id, onChange }: { ctx: Ctx; id: string; onChange: () => void }) {
  const f = useLoad<BizFin>(`/admin/businesses/${id}/finance`);
  const settings = useLoad<Array<{ key: string; value: unknown }>>('/admin/settings');
  if (!f.data) return <Loading error={f.error} />;
  const b = f.data;
  const price = (k: string) => Number(settings.data?.find((x) => x.key === k)?.value ?? 0);
  const reload = () => { f.reload(); onChange(); };
  const record = () => ctx.open({
    title: A('rpTitle'), sub: A('rpSub', { a: b.name, b: planName(b.plan), c: b.financeYear, d: birr(b.fee), e: birr(b.paid) }), ok: A('rpOk'),
    groups: [{ label: A('rpHow'), key: 'method', opts: METHODS.map((m) => ({ v: m.v, l: A(m.k) })) }],
    inputs: [{ label: A('rpAmount'), key: 'amount', ph: '0', type: 'number', initial: b.balance ? String(b.balance) : '' }, { label: A('rpRef'), key: 'reference', ph: A('rpRefPh') }],
    note: A('rpNote', { a: b.financeYear, b: fdy(b.yearEnds), c: birr(b.balance) }),
    need: (x) => Number(x.amount) > 0 && Number.isInteger(Number(x.amount)) && !!x.method,
    go: (x) => act(async () => {
      const r = await post<{ receiptNo: string }>(`/businesses/${id}/payments`, { amount: Number(x.amount), method: x.method, reference: x.reference?.trim() || undefined });
      ctx.close(); ctx.toast(A('rpDone', { a: r.receiptNo })); reload();
    }),
  });
  const addBranch = () => {
    const n = (b.branches ?? 1) + 1;
    const note = b.plan === 'pilot' ? A('abPilot') : b.plan === 'starter' ? A('abStarter', { a: birr(price('plan.full.yearly_fee_birr')) }) : A('abFull', { a: birr(price('plan.extra_branch.yearly_fee_birr')) });
    ctx.open({
      title: A('abTitle', { a: b.name }), sub: A('abSub', { a: n }), note, ok: A('abOk'),
      inputs: [{ label: A('abName'), key: 'name', ph: A('abNamePh') }],
      go: (x) => act(async () => { const r = await post<{ fee: number }>(`/businesses/${id}/branches`, { name: x.name?.trim() || undefined }); ctx.close(); ctx.toast(A('abDone', { a: birr(Math.max(0, r.fee - b.paid)) })); reload(); }),
    });
  };
  const changePlan = () => ctx.open({
    title: A('cpTitle2'), sub: A('cpSub2', { a: b.name, b: planName(b.plan), c: brN(b.branches ?? 1) }), ok: A('cpOk2'),
    groups: [{ label: A('cpNew'), key: 'plan', opts: [
      { v: 'pilot', l: A('planPilot') },
      { v: 'starter', l: (b.branches ?? 1) > 1 ? A('cpStarterOne', { a: birr(price('plan.starter.yearly_fee_birr')) }) : A('cpStarterP', { a: birr(price('plan.starter.yearly_fee_birr')) }) },
      { v: 'full', l: A('cpFullP', { a: birr(price('plan.full.yearly_fee_birr')) }) },
    ] }],
    note: A('cpNote', { a: birr(b.paid) }),
    need: (x) => !!x.plan && x.plan !== b.plan && !(x.plan === 'starter' && (b.branches ?? 1) > 1),
    go: (x) => act(async () => { const r = await post<{ fee: number }>(`/businesses/${id}/plan`, { plan: x.plan }); ctx.close(); ctx.toast(A('cpDone2', { a: r.fee ? birr(r.fee) : A('noFee') })); reload(); }),
  });
  const remind = () => ctx.open({
    title: A('remindT'), sub: b.name, ok: A('mcOk'), note: A('moNote'),
    groups: [{ label: A('mcSms'), key: 'sms', initial: 'yes', opts: [{ v: 'no', l: A('mcSmsNo') }, { v: 'yes', l: A('mcSmsYes') }] }],
    inputs: [{ label: A('mcBody'), key: 'body', tall: true, initial: A('remindText', { a: b.name, b: birr(b.balance) }) }],
    need: (x) => (x.body ?? '').trim().length > 3,
    go: (x) => act(async () => { await post(`/businesses/${id}/message`, { title: A('tplPayT'), body: x.body.trim(), sms: x.sms === 'yes' }); ctx.close(); ctx.toast(A('remindDone')); }),
  });
  const extras = b.plan === 'full' ? Math.max(0, (b.branches ?? 2) - 2) : 0;
  return (
    <>
      <Stats cols={5} items={[
        { v: planName(b.plan), l: A('kPlan'), s: b.branches ? brN(b.branches) : '' },
        { v: b.plan === 'pilot' ? A('noFee') : birr(b.fee), l: A('feeForYear', { a: b.financeYear }), s: extras ? A('feeExtras', { a: birr(price('plan.full.yearly_fee_birr')), b: extras }, extras) : '' },
        { v: birr(b.paid), l: A('hPaid'), s: A('paymentsN', { a: b.payments.filter((p) => !p.reversed).length }, b.payments.filter((p) => !p.reversed).length) },
        { v: b.billing === 'paid' ? A('paidInFull') : b.plan === 'pilot' ? A('nothingDue') : birr(b.balance), l: b.billing === 'paid' || b.plan === 'pilot' ? A('hBalance') : A('balToPay'),
          s: b.billing === 'btrial' && b.dueOn ? A('trialEnds', { a: fd(b.dueOn) }) : b.billing === 'overdue' && b.dueOn ? A('wasDue', { a: fd(b.dueOn) }) : ['due', 'partial'].includes(b.billing) ? (b.dueOn ? A('dueOn', { a: fd(b.dueOn) }) : A('dueNow')) : '',
          sc: b.billing === 'overdue' ? RED : GREY },
        { v: b.coversUntil ? A('fyEndV') : '—', l: A('coversUntil'), s: b.coversUntil ? `${ec(b.coversUntil)} · ${fdy(b.coversUntil)}` : A('notPaidYet') },
      ]} />
      <Cols lw="1fr" rw="380px"
        left={<Table title={A('payments')} cols="1.3fr 1fr 1.2fr 1.4fr .8fr" heads={[{ h: A('hDate') }, { h: A('hAmount') }, { h: A('hMethod') }, { h: A('hRef') }, { h: A('hYear') }]}
          rows={b.payments.map((p) => ({ go: () => ctx.nav({ v: 'receipt', id: p.id }), cells: [
            { t: fdy(p.at), s: ec(p.at) },
            p.reversed ? { t: birr(p.original), s: A('reversedL'), b: true, c: RED } : { t: birr(p.amount), s: p.amount !== p.original ? A('wasN', { a: birr(p.original) }) : '', b: true },
            { t: methodL(p.method) }, { t: p.reference ?? '—' }, { t: String(p.financeYear) },
          ] }))} empty={A('noPayments')} foot={A('paymentsFoot')} />}
        right={<List title={A('finActions')} rows={[
          { t: A('rpTitle'), s: A('rpS'), go: ['pending', 'rejected', 'closed'].includes(b.status) ? undefined : record },
          { t: A('abTitleShort'), s: A('abS'), go: addBranch },
          { t: A('cpTitle2'), s: A('nowPlan', { a: planName(b.plan) }), go: changePlan },
          { t: A('remindT'), s: A('remindS'), go: b.balance > 0 ? remind : undefined },
        ]} />} />
    </>
  );
}

// ---------------------------------------------------------------- Receipt (AdminReceipt*)
interface Receipt { id: string; receiptNo: string; original: number; amount: number; reversed: boolean; method: string; reference: string | null; at: string; financeYear: number; businessId: string; business: string; by: string; coversUntil: string; fixes: Array<{ kind: string; amount: number; reason: string; at: string; by: string }> }
export function ReceiptPage({ ctx, id }: { ctx: Ctx; id: string }) {
  const r = useLoad<Receipt>(`/admin/payments/${id}`);
  if (!r.data) return <Page title={A('receipt')}><Loading error={r.error} /></Page>;
  const p = r.data;
  const back = () => ctx.nav({ v: 'business', id: p.businessId, tab: 'finance' });
  const correct = () => ctx.open({
    title: A('pcTitle'), sub: A('pcSub', { a: p.receiptNo, b: birr(p.amount), c: methodL(p.method) }), note: A('pcNote'), ok: A('pcOk'),
    groups: [{ label: A('reason'), key: 'reason', opts: ['pcWrong', 'pcCounted', 'other'].map((k) => ({ v: A(k), l: A(k) })) }],
    inputs: [{ label: A('pcAmount'), key: 'amount', type: 'number' }, { label: A('noteOpt'), key: 'note', ph: A('noteOptPh') }],
    need: (x) => Number(x.amount) > 0 && Number(x.amount) !== p.amount && !!x.reason,
    go: (x) => act(async () => { await post(`/payments/${p.id}/correct`, { amount: Number(x.amount), reason: x.note?.trim() ? `${x.reason}: ${x.note.trim()}` : x.reason }); ctx.close(); ctx.toast(A('pcDone')); r.reload(); }),
  });
  const reverse = () => ctx.open({
    title: A('prTitle'), sub: A('pcSub', { a: p.receiptNo, b: birr(p.amount), c: methodL(p.method) }), note: A('prNote'), ok: A('prOk'), danger: true,
    groups: [{ label: A('reason'), key: 'reason', opts: ['prMistake', 'prWrongBiz', 'prNoMoney', 'other'].map((k) => ({ v: A(k), l: A(k) })) }],
    inputs: [{ label: A('noteOpt'), key: 'note', ph: A('noteOptPh') }], need: (x) => !!x.reason,
    go: (x) => act(async () => { await post(`/payments/${p.id}/reverse`, { reason: x.note?.trim() ? `${x.reason}: ${x.note.trim()}` : x.reason }); ctx.close(); ctx.toast(A('prDone')); r.reload(); }),
  });
  const pill = p.reversed ? 'rev' : p.amount !== p.original ? 'fixd' : 'paid';
  return (
    <Page title={A('receiptN', { a: p.receiptNo })} sub={`${p.business} · ${fdy(p.at)}`} crumbs={[{ t: A('bzTitle'), go: () => ctx.nav({ v: 'businesses' }) }, { t: p.business, go: back }, { t: A('receipt') }]}
      btns={[{ t: A('print'), kind: 'outline', go: () => window.print() }]}>
      <Head ini="R" title={birr(p.reversed ? p.original : p.amount)} sub={A('receiptN', { a: p.receiptNo })} pill={pill} tags={[{ t: methodL(p.method) }, { t: A('yearN', { a: p.financeYear }) }]} />
      <Cols lw="1fr" rw="380px"
        left={<>
          <Kv title={A('receipt')} rows={[
            { k: A('rcNo'), v: p.receiptNo }, { k: A('rcFrom'), v: p.business }, { k: A('rcCovers'), v: A('rcCoversV', { a: p.financeYear, b: ec(p.coversUntil) }) },
            { k: A('hAmount'), v: birr(p.reversed ? p.original : p.amount) }, { k: A('rcPaidBy'), v: methodL(p.method) }, { k: A('hRef'), v: p.reference ?? '—' },
            { k: A('hDate'), v: `${fdy(p.at)} · ${ec(p.at)}` }, { k: A('rcRecBy'), v: p.by },
          ]} />
          {p.fixes.map((x, i) => (
            <Kv key={i} title={x.kind === 'reversal' ? A('whyReversed') : A('whyCorrected')} rows={[
              { k: A('hWhen'), v: `${fdy(x.at)}` }, { k: A('hWho'), v: x.by }, { k: A('reason'), v: x.reason }, { k: A('amountBefore'), v: birr(x.kind === 'reversal' ? -x.amount : p.original) },
            ]} />
          ))}
        </>}
        right={<>
          <List title={A('whatDo')} rows={p.reversed ? [] : [
            { t: A('srTitle'), s: A('srS'), go: async () => { await post(`/payments/${p.id}/send`); ctx.toast(A('srDone')); } },
            { t: A('pcTitle'), s: A('pcS'), go: correct }, { t: A('prTitle'), s: A('prS'), go: reverse, sc: RED },
          ]} empty={A('nothingToDo')} />
          <Note t={A('rcTaxNote')} />
        </>} />
    </Page>
  );
}

// ---------------------------------------------------------------- Agents (AdminAgents*, AdminAgentPay, AdminAddDeal*)
interface AgentRow { id: string; name: string; phone: string; area: string | null; status: string; deals: number; leads: number; earned: number; paid: number; owed: number }
function agentPayModal(ctx: Ctx, a: { id: string; name: string }, owed: number, govOnOwed: number, done: () => void): ModalSpec {
  return {
    title: A('apTitle', { a: birr(owed), b: a.name }), sub: A('apSub'), ok: A('apOk'),
    inputs: [{ label: A('apHow'), key: 'how', ph: A('apHowPh') }, { label: A('rpRef'), key: 'reference', ph: '' }],
    note: A('apNote', { a: birr(govOnOwed), b: birr(owed + govOnOwed) }),
    go: (x) => act(async () => { await post(`/agents/${a.id}/payout`, { how: x.how?.trim() || undefined, reference: x.reference?.trim() || undefined }); ctx.close(); ctx.toast(A('apDone', { a: a.name })); done(); }),
  };
}

function addAgentModal(ctx: Ctx, done: (id: string) => void): ModalSpec {
  return {
    title: A('aaTitle'), sub: A('aaSub'), ok: A('aaOk'), note: A('aaNote'),
    inputs: [{ label: A('fullName'), key: 'name', ph: A('aaNamePh') }, { label: A('aaPhone'), key: 'phone', ph: '+251 9' }, { label: A('aaArea'), key: 'area', ph: A('aaAreaPh') }],
    need: (x) => (x.name ?? '').trim().length > 2 && (x.phone ?? '').replace(/\D/g, '').length >= 9,
    go: (x) => act(async () => { const r = await post<{ id: string }>('/agents', { name: x.name.trim(), phone: x.phone, area: x.area?.trim() || undefined }); ctx.close(); ctx.toast(A('aaDone', { a: x.name.trim() })); done(r.id); }),
  };
}

/** AdminAddDeal: a company already on Temelash (found by name), or one not registered yet. */
export function openAddDeal(ctx: Ctx, agents: AgentRow[], businesses: Array<{ id: string; name: string; agent: string | null }>, agentId: string | undefined, done: () => void) {
  const active = agents.filter((a) => a.status === 'active');
  ctx.open({
    title: A('adTitle'), sub: A('adSub'), ok: A('adOk'),
    pre: [{ label: A('adFind'), key: 'find', ph: A('adFindPh') }],
    groups: [
      { label: A('adAgent'), key: 'agent', opts: active.map((a) => ({ v: a.id, l: a.name })), initial: agentId },
      { label: A('adWhich'), key: 'mode', opts: [{ v: 'reg', l: A('adReg') }, { v: 'new', l: A('adNew') }], initial: 'reg' },
      { label: A('adPickBiz'), key: 'business', filterBy: 'find', when: (f) => f.mode !== 'new', opts: businesses.map((b) => ({ v: b.id, l: b.agent ? A('adNowAgent', { a: b.name, b: b.agent }) : b.name })) },
      { label: A('adPlan'), key: 'plan', when: (f) => f.mode === 'new', opts: [{ v: 'starter', l: A('pnStarter') }, { v: 'full', l: A('pnFull') }] },
    ],
    inputs: [{ label: A('adNewName'), key: 'bname', ph: A('adNewNamePh'), when: (f) => f.mode === 'new' }, { label: A('adNewPhone'), key: 'phone', ph: '+251 9', when: (f) => f.mode === 'new' }],
    note: A('adNote'),
    need: (x) => !!x.agent && (x.mode === 'reg' ? !!x.business : x.mode === 'new' && (x.bname ?? '').trim().length > 1 && (x.phone ?? '').replace(/\D/g, '').length >= 9 && !!x.plan),
    go: (x) => act(async () => {
      await post('/deals', x.mode === 'reg' ? { agentId: x.agent, businessId: x.business } : { agentId: x.agent, lead: { businessName: x.bname.trim(), ownerPhone: x.phone, plan: x.plan } });
      ctx.close(); ctx.toast(A('adDone')); done();
    }),
  });
}

export function AgentsPage({ ctx, view }: { ctx: Ctx; view: Extract<View, { v: 'agents' }> }) {
  const list = useLoad<AgentRow[]>('/admin/agents');
  const biz = useLoad<Array<{ id: string; name: string; agent: string | null }>>('/admin/businesses');
  const pct = useLoad<Array<{ key: string; value: unknown }>>('/admin/settings');
  const [aq, setAq] = useState(view.owed ? 'owed' : 'all');
  const [q, setQ] = useState('');
  if (!list.data) return <Page title={A('agTitle')}><Loading error={list.error} /></Page>;
  const all = list.data;
  const gov = Number(pct.data?.find((x) => x.key === 'government.share_percent_of_commission')?.value ?? 30);
  const owedList = all.filter((a) => a.owed > 0).sort((x, y) => y.owed - x.owed);
  const L = all.filter((a) => (aq === 'all' || (aq === 'owed' ? a.owed > 0 : aq === 'active' ? a.status === 'active' : a.status !== 'active'))
    && (!q.trim() || `${a.name} ${a.area ?? ''} ${a.phone}`.toLowerCase().includes(q.trim().toLowerCase())));
  const owed = all.reduce((s, a) => s + a.owed, 0);
  return (
    <Page title={A('agTitle')} sub={A('agSub')} btns={[
      exportButton(ctx, 'agents', A('exAgents'), true),
      { t: A('aaTitle'), kind: 'outline', go: () => ctx.open(addAgentModal(ctx, (id) => ctx.nav({ v: 'agent', id }))) },
      { t: A('adTitle'), kind: 'primary', go: () => openAddDeal(ctx, all, biz.data ?? [], undefined, list.reload) },
    ]}>
      <Stats cols={5} items={[
        { v: String(all.filter((a) => a.status === 'active').length), l: A('agActive'), s: A('inTotal', { a: all.length }) },
        { v: String(all.reduce((s, a) => s + a.deals, 0)), l: A('agDeals'), s: A('notRegN', { a: all.reduce((s, a) => s + a.leads, 0) }) },
        { v: birr(owed), l: A('fCommOwed'), s: owed ? A('agClickOwed') : A('fEarnedNotPaid'), sc: owed ? RED : GREY, go: () => setAq(aq === 'owed' ? 'all' : 'owed') },
        { v: birr(all.reduce((s, a) => s + a.paid, 0)), l: A('agPaidOut'), s: A('soFar') },
        { v: birr(all.reduce((s, a) => s + a.earned, 0)), l: A('agEarned'), s: A('agEarnedS') },
      ]} />
      <Tool search={{ value: q, onChange: setQ, ph: A('agSearch') }} groups={[{ label: A('fStatus'), cur: aq, pick: setAq, opts: [
        { v: 'all', l: A('allN', { a: all.length }) }, { v: 'active', l: A('pActive') }, { v: 'inactive', l: A('pInactive') }, { v: 'owed', l: A('chipN', { a: A('pOwed'), b: owedList.length }) },
      ] }]} />
      {aq === 'owed' && (
        <List title={A('whoToPay', { a: owedList.length, b: birr(owed) })} empty={A('nobodyOwed')} rows={owedList.map((a) => ({
          t: `${a.name} · ${a.phone}`, s: A('setAside', { a: birr(Math.round((a.owed * gov) / 100)) }), r: birr(a.owed), rc: RED,
          go: () => ctx.open(agentPayModal(ctx, a, a.owed, Math.round((a.owed * gov) / 100), list.reload)),
        }))} />
      )}
      <Table cols="1.9fr 1.2fr .7fr 1fr 1fr 1fr" heads={[{ h: A('hAgent') }, { h: A('hArea') }, { h: A('agDeals'), right: true }, { h: A('agEarned'), right: true }, { h: A('agPaidOut'), right: true }, { h: A('pOwed'), right: true }]}
        rows={L.map((a) => ({ go: () => ctx.nav({ v: 'agent', id: a.id }), cells: [
          { t: a.name, s: a.phone + (a.status === 'active' ? '' : ' · ' + A('pInactive').toLowerCase()), b: true }, { t: a.area ?? '—' }, { t: String(a.deals), right: true },
          { t: birr(a.earned), right: true }, { t: birr(a.paid), right: true }, { t: birr(a.owed), right: true, c: a.owed ? RED : '#333', b: !!a.owed },
        ] }))} empty={A('noAgentMatch')} foot={A('agFoot')} />
    </Page>
  );
}

interface AgentPage { id: string; name: string; phone: string; area: string | null; status: string; createdAt: string; stats: { earned: number; paid: number; owed: number; govShareOnOwed: number };
  deals: Array<{ id: string; name: string; status: string; plan: string | null; fee: number; paid: number; billing: string; earned: number }>;
  leads: Array<{ id: string; businessName: string; ownerPhone: string; plan: string; branches: number; at: string; linked: boolean }>;
  payouts: Array<{ amount: number; how: string | null; reference: string | null; at: string; by: string }> }
export function AgentPageView({ ctx, id }: { ctx: Ctx; id: string }) {
  const g = useLoad<AgentPage>(`/admin/agents/${id}`);
  const list = useLoad<AgentRow[]>('/admin/agents');
  const biz = useLoad<Array<{ id: string; name: string; agent: string | null }>>('/admin/businesses');
  if (!g.data) return <Page title={A('agTitle')} crumbs={[{ t: A('agTitle'), go: () => ctx.nav({ v: 'agents' }) }]}><Loading error={g.error} /></Page>;
  const a = g.data;
  const leads = a.leads.filter((l) => !l.linked);
  const linkLead = (l: AgentPage['leads'][number]) => ctx.open({
    title: A('llTitle', { a: l.businessName }), sub: A('llSub', { a: l.ownerPhone }), ok: A('llOk'),
    pre: [{ label: A('adFind'), key: 'find', ph: A('adFindPh') }],
    groups: [{ label: A('adPickBiz'), key: 'business', filterBy: 'find', opts: (biz.data ?? []).map((b) => ({ v: b.id, l: b.name })) }],
    need: (x) => !!x.business,
    go: (x) => act(async () => { await post('/deals', { agentId: a.id, businessId: x.business, leadId: l.id }); ctx.close(); ctx.toast(A('adDone')); g.reload(); }),
  });
  const btns: Btn[] = [{ t: A('statement'), kind: 'outline', go: () => ctx.nav({ v: 'statement', id: a.id }) }];
  if (a.stats.owed) btns.push({ t: A('markPaid', { a: birr(a.stats.owed) }), kind: 'outline', go: () => ctx.open(agentPayModal(ctx, a, a.stats.owed, a.stats.govShareOnOwed, g.reload)) });
  btns.push({ t: A('adTitle'), kind: 'primary', go: () => openAddDeal(ctx, list.data ?? [], biz.data ?? [], a.id, g.reload) });
  const payoutPill = (d: AgentPage['deals'][number]) => (d.plan === 'pilot' ? 'nofee' : d.earned > 0 && d.billing === 'paid' ? 'apaid' : d.earned > 0 ? 'owed' : 'await');
  return (
    <Page title={a.name} sub={`${a.area ?? '—'} · ${a.phone} · ${A('joinedOn', { a: fdy(a.createdAt) })}`} crumbs={[{ t: A('agTitle'), go: () => ctx.nav({ v: 'agents' }) }, { t: a.name }]} btns={btns}>
      <Head ini={a.name.charAt(0)} title={a.name} sub={`${a.phone} · ${a.area ?? '—'}`} pill={a.status === 'active' ? 'aon' : 'aoff'} tags={[{ t: A('dealsN', { a: a.deals.length + leads.length }, a.deals.length + leads.length) }, { t: A('recordOnly') }]} />
      <Stats cols={5} items={[
        { v: String(a.deals.length + leads.length), l: A('agDeals'), s: A('notRegN', { a: leads.length }) },
        { v: String(a.deals.filter((d) => d.billing === 'paid').length), l: A('paidUp'), s: A('paidUpS') },
        { v: birr(a.stats.earned), l: A('agEarned') }, { v: birr(a.stats.paid), l: A('agPaidOut') },
        { v: birr(a.stats.owed), l: A('pOwed'), sc: a.stats.owed ? RED : GREY },
      ]} />
      <List title={A('payoutHistory')} empty={A('noPayouts')} more={{ t: A('openStatement'), go: () => ctx.nav({ v: 'statement', id: a.id }) }}
        rows={a.payouts.map((p) => ({ t: fdy(p.at), s: A('payoutBy', { a: p.how ?? A('methodNotWritten'), b: p.by }), r: birr(p.amount), rc: '#333' }))} />
      <Table title={A('agDeals')} cols="2fr 1fr 1.1fr 1.1fr 1.6fr" heads={[{ h: A('hCompany') }, { h: A('kPlan') }, { h: A('hPaidBirr') }, { h: A('hCommission'), right: true }, { h: A('hPayout') }]}
        rows={[
          ...a.deals.map((d) => ({ go: () => ctx.nav({ v: 'business', id: d.id, tab: 'finance' }), cells: [
            { t: d.name, b: true }, { t: planName(d.plan) }, { t: num(d.paid), s: A('ofFee', { a: num(d.fee) }) }, { t: d.earned ? num(d.earned) : '—', right: true }, { pill: payoutPill(d) },
          ] })),
          ...leads.map((l) => ({ go: () => linkLead(l), cells: [
            { t: l.businessName, s: A('leadAdded', { a: l.ownerPhone, b: fd(l.at) }), b: true }, { t: planName(l.plan), s: brN(l.branches) }, { t: '—', s: A('notRegistered') }, { t: '—', right: true }, { pill: 'await' },
          ] })),
        ]} empty={A('noDeals')} foot={A('dealsFoot')} />
    </Page>
  );
}

export function StatementPage({ ctx, id }: { ctx: Ctx; id: string }) {
  const g = useLoad<AgentPage>(`/admin/agents/${id}`);
  const pct = useLoad<Array<{ key: string; value: unknown }>>('/admin/settings');
  if (!g.data) return <Page title={A('statementT')}><Loading error={g.error} /></Page>;
  const a = g.data;
  const gov = Number(pct.data?.find((x) => x.key === 'government.share_percent_of_commission')?.value ?? 30);
  const gp = (n: number) => Math.round((n * gov) / 100);
  return (
    <Page title={A('statementT')} sub={`${a.name} · ${a.area ?? '—'} · ${A('madeOn', { a: fdy(new Date()) })}`} crumbs={[{ t: A('agTitle'), go: () => ctx.nav({ v: 'agents' }) }, { t: a.name, go: () => ctx.nav({ v: 'agent', id: a.id }) }, { t: A('statement') }]}
      btns={[{ t: A('print'), kind: 'outline', go: () => window.print() }]}>
      <Stats cols={3} items={[{ v: birr(a.stats.earned), l: A('agEarned'), s: A('bizThatPaid') }, { v: birr(a.stats.paid), l: A('agPaidOut'), s: A('payoutsRec', { a: a.payouts.length }) }, { v: birr(a.stats.owed), l: A('stillOwed'), s: a.stats.owed ? A('readyToPay') : A('nothingOwed'), sc: a.stats.owed ? RED : GREY }]} />
      <Table title={A('companies')} cols="2fr 1fr 1fr" heads={[{ h: A('hCompany') }, { h: A('kPlan') }, { h: A('agEarned'), right: true }]}
        rows={a.deals.map((d) => ({ cells: [{ t: d.name, b: true }, { t: planName(d.plan) }, { t: num(d.earned), right: true }] }))} empty={A('noDeals')} foot={A('netFoot')} />
      <Table title={A('payoutsT')} cols="1.2fr 1fr 1.4fr 1fr" heads={[{ h: A('hDate') }, { h: A('hAmount'), right: true }, { h: A('hHow') }, { h: A('recBy') }]}
        rows={a.payouts.map((p) => ({ cells: [{ t: fdy(p.at), s: ec(p.at) }, { t: num(p.amount), right: true, b: true }, { t: p.how ?? '—' }, { t: p.by }] }))} empty={A('noPayouts')} foot={A('payoutsFoot')} />
      <Kv title={A('costT')} rows={[
        { k: A('paidOutNet'), v: birr(a.stats.paid) }, { k: A('govPctK', { a: gov }), v: birr(gp(a.stats.paid)) }, { k: A('totalCost'), v: birr(a.stats.paid + gp(a.stats.paid)) },
        { k: A('stillOwedNet'), v: birr(a.stats.owed) }, { k: A('govOnIt'), v: birr(gp(a.stats.owed)) },
      ]} />
      <Note t={A('netNote')} />
    </Page>
  );
}

interface Board { days: number; noAgent: number; agents: Array<{ id: string; name: string; area: string | null; status: string; deals: number; paid: number; before: number }> }
export function LeaderboardPage({ ctx }: { ctx: Ctx }) {
  const [days, setDays] = useState('30');
  const b = useLoad<Board>(`/admin/agents/leaderboard?days=${days}`);
  const rows = b.data?.agents ?? [];
  let rank = 0; let last = -1;
  const ranked = rows.map((o, i) => { if (o.deals !== last) { rank = i + 1; last = o.deals; } return { ...o, rank }; });
  const lead = ranked.filter((o) => o.rank === 1 && o.deals > 0);
  const tot = rows.reduce((s, o) => s + o.deals, 0);
  return (
    <Page title={A('lbTitle')} sub={A('lbSub')}>
      <Tool groups={[{ label: A('period'), cur: days, pick: setDays, opts: [{ v: '7', l: A('d7') }, { v: '14', l: A('d14') }, { v: '30', l: A('d30') }, { v: '60', l: A('d60') }, { v: '90', l: A('d90') }] }]} />
      {b.data ? (
        <>
          <Stats cols={4} items={[
            { v: String(tot), l: A('lbWithAgent'), s: A('lastNDays', { a: days }) },
            { v: lead.length > 1 ? A('tied', { a: lead.length }) : lead[0]?.name ?? A('noOneYet'), l: A('leading'), s: lead[0] ? A('bizN', { a: lead[0].deals }, lead[0].deals) : '' },
            { v: String(rows.filter((o) => o.deals > 0).length), l: A('lbWhoReg'), s: A('ofActive', { a: rows.filter((o) => o.status === 'active').length }) },
            { v: String(b.data.noAgent), l: A('lbNoAgent'), s: A('lbByHand') },
          ]} />
          <Cols lw="1fr" rw="380px"
            left={<Table title={A('ranking', { a: days })} cols=".5fr 2fr 1fr .8fr 1fr .9fr" heads={[{ h: '#' }, { h: A('hAgent') }, { h: A('registered'), right: true }, { h: A('hPaid'), right: true }, { h: A('before'), right: true }, { h: A('change'), right: true }]}
              rows={ranked.map((o) => {
                const d = o.deals - o.before;
                return { go: () => ctx.nav({ v: 'agent', id: o.id }), cells: [
                  { t: o.deals === 0 ? '—' : String(o.rank), b: true }, { t: o.name, s: (o.area ?? '') + (o.status === 'active' ? '' : ' · ' + A('pInactive').toLowerCase()), b: true },
                  { t: String(o.deals), right: true, b: true }, { t: String(o.paid), right: true }, { t: String(o.before), right: true },
                  { t: d === 0 ? A('same') : d > 0 ? `+${d}` : String(d), right: true, c: d < 0 ? RED : '#333' },
                ] };
              })} empty={A('noAgents')} foot={A('lbFoot')} />}
            right={<Bars title={A('perAgent')} sub={A('lastNDays', { a: days })} note={A('darkest')} bars={ranked.map((o) => ({ l: o.name.split(' ')[0], v: o.deals, on: o.deals > 0 && o.rank === 1 }))} />} />
        </>
      ) : <Loading error={b.error} />}
    </Page>
  );
}

// ---------------------------------------------------------------- Finance report and government share (AdminFinanceReport*, AdminGovMark)
interface Report { financeYear: number; months: Array<{ month: number; payments: number; commission: number; govShare: number; left: number; handedOver: { amount: number; how: string | null; reference: string | null; at: string } | null }>;
  byAgent: Array<{ agentId: string | null; agent: string | null; payments: number; commission: number; govShare: number; left: number }>; total: { payments: number; commission: number; govShare: number; left: number } }
export function ReportPage({ ctx }: { ctx: Ctx }) {
  const r = useLoad<Report>('/admin/finance/report');
  const settings = useLoad<Array<{ key: string; value: unknown }>>('/admin/settings');
  if (!r.data) return <Page title={A('rptTitle')}><Loading error={r.error} /></Page>;
  const d = r.data;
  const pct = Number(settings.data?.find((x) => x.key === 'government.share_percent_of_commission')?.value ?? 30);
  const shown = d.months.filter((m, i) => m.payments || m.commission || d.months.slice(0, i).some((x) => x.payments));
  const mark = (m: Report['months'][number]) => ctx.open(m.handedOver ? {
    title: A('gmDoneTitle', { a: ecMonth(m.month) }), sub: A('gmDoneSub', { a: birr(m.handedOver.amount) }),
    list: [A('gmDate', { a: fdy(m.handedOver.at) }), A('gmHow', { a: m.handedOver.how ?? '—' }), A('gmRef', { a: m.handedOver.reference ?? '—' })],
    note: A('gmUndoNote'), ok: A('gmUndo'), danger: true,
    go: () => act(async () => { await post('/gov-share', { financeYear: d.financeYear, month: m.month, handedOver: false }); ctx.close(); ctx.toast(A('gmUndone')); r.reload(); }),
  } : {
    title: A('gmTitle', { a: ecMonth(m.month) }), sub: A('gmSub'), note: A('gmNote'), ok: A('gmOk'),
    groups: [{ label: A('gmHowQ'), key: 'how', opts: ['gmBank', 'mCash', 'other'].map((k) => ({ v: A(k), l: A(k) })) }],
    inputs: [{ label: A('rpAmount'), key: 'amount', type: 'number', initial: String(m.govShare) }, { label: A('gmRefLbl'), key: 'reference', ph: A('gmRefPh') }],
    need: (x) => !!x.how && Number(x.amount) >= 0 && x.amount !== '',
    go: (x) => act(async () => { await post('/gov-share', { financeYear: d.financeYear, month: m.month, handedOver: true, amount: Number(x.amount), how: x.how, reference: x.reference?.trim() || undefined }); ctx.close(); ctx.toast(A('gmDone')); r.reload(); }),
  });
  const govRows = d.months.filter((m) => m.commission > 0 || m.handedOver);
  const handed = govRows.filter((m) => m.handedOver).reduce((s, m) => s + (m.handedOver?.amount ?? 0), 0);
  const toHand = govRows.filter((m) => !m.handedOver).reduce((s, m) => s + m.govShare, 0);
  const t = d.total;
  return (
    <Page title={A('rptTitle')} sub={A('rptSub', { a: d.financeYear, b: pct })} btns={[exportButton(ctx, 'finance', A('exReport', { a: d.financeYear }), false)]}>
      <Stats cols={5} items={[
        { v: birr(t.payments), l: A('revenue'), s: '' }, { v: birr(t.commission), l: A('commNet'), s: A('earnedPeriod') },
        { v: birr(t.govShare), l: A('govShare'), s: A('pctOfComm', { a: pct }) }, { v: birr(t.commission + t.govShare), l: A('totalCommCost'), s: A('netPlusGov') },
        { v: birr(t.left), l: A('leftForUs'), s: A('afterComm'), sc: t.left < 0 ? RED : GREY },
      ]} />
      <Cols lw="1fr" rw="360px"
        left={<>
          <Table title={A('monthByMonth')} cols="1.4fr 1fr 1fr 1fr 1fr" heads={[{ h: A('month') }, { h: A('revenueH'), right: true }, { h: A('hCommission'), right: true }, { h: A('government'), right: true }, { h: A('leftH'), right: true }]}
            rows={[...shown.map((m) => ({ cells: [{ t: ecMonth(m.month), b: true }, { t: num(m.payments), right: true }, { t: num(m.commission), right: true }, { t: num(m.govShare), right: true }, { t: num(m.left), right: true, b: true }] })),
              { cells: [{ t: A('total'), b: true }, { t: num(t.payments), right: true, b: true }, { t: num(t.commission), right: true, b: true }, { t: num(t.govShare), right: true, b: true }, { t: num(t.left), right: true, b: true }] }]}
            foot={A('monthsFoot')} />
          <Table title={A('byAgent')} cols="1.8fr 1fr 1fr 1fr 1fr" heads={[{ h: A('hAgent') }, { h: A('revenueH'), right: true }, { h: A('hCommission'), right: true }, { h: A('govPctH', { a: pct }), right: true }, { h: A('totalCost'), right: true }]}
            rows={d.byAgent.filter((x) => x.agentId).map((x) => ({ go: () => ctx.nav({ v: 'agent', id: x.agentId! }), cells: [{ t: x.agent ?? '—', b: true }, { t: num(x.payments), right: true }, { t: num(x.commission), right: true }, { t: num(x.govShare), right: true }, { t: num(x.commission + x.govShare), right: true, b: true }] }))}
            empty={A('noComm')} foot={A('byAgentFoot')} />
          <Table title={A('govByMonth', { a: d.financeYear })} cols="1.4fr 1fr 1fr 1.2fr 1.6fr" heads={[{ h: A('month') }, { h: A('hCommission'), right: true }, { h: A('govPctH', { a: pct }), right: true }, { h: A('hStatus') }, { h: A('handedOverH') }]}
            rows={govRows.map((m) => ({ go: () => mark(m), cells: [{ t: ecMonth(m.month), b: true }, { t: num(m.commission), right: true }, { t: num(m.govShare), right: true, b: true },
              { pill: m.handedOver ? 'ghand' : 'gnot' }, m.handedOver ? { t: fd(m.handedOver.at), s: [m.handedOver.how, m.handedOver.reference].filter(Boolean).join(' · ') } : { t: '—' }] }))}
            empty={A('noCommYear')} foot={A('govFoot', { a: birr(handed), b: birr(toHand) })} />
        </>}
        right={<>
          <Kv title={A('addsUp')} rows={[{ k: A('revenue'), v: birr(t.payments) }, { k: A('commNet'), v: '− ' + birr(t.commission) }, { k: A('govPctK', { a: pct }), v: '− ' + birr(t.govShare) }, { k: A('leftForUs'), v: birr(t.left) }]} />
          <Note t={A('govExample', { a: num(Math.round((5000 * pct) / 100)), b: num(5000 + Math.round((5000 * pct) / 100)) })} />
        </>} />
    </Page>
  );
}

