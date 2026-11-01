'use client';

import { useState } from 'react';
import type { Lang } from '@temelash/i18n';
import { ApiFailure, authed } from '@temelash/ui';
import { formatDay, formatWhen } from './owner-more';
import { IC, Icon, Row, useLoad, type Lfn } from './owner-ui';
import s from './app.module.css';

/**
 * Owner board stands: OwnStands (the shop), OwnStandCart, OwnStandPlaced,
 * OwnStandOrders and OwnStandOrder with the receiving report. Owners only.
 * Prices come from the admin price list (AdminStandsPrices).
 */

type Names = Record<string, string>;
export interface StandItem { id: string; name: Names; description: Names; price: number }
interface Line { itemId: string; qty: number; price: number; name: Names }
export interface StandOrder {
  id: string; code: string; stage: 'placed' | 'confirmed' | 'printing' | 'way' | 'delivered'; status: 'open' | 'done' | 'cancelled';
  total: number; phone: string; branch: string; address: string | null; createdAt: string; result: string | null;
  cashReceived: number | null; received: 'ok' | 'problem' | null; receivedAt: string | null; receivedPay: 'cash' | 'telebirr' | null; receivedNote: string | null; lines: Line[];
}
export type Cart = Record<string, number>;
interface Shop { items: StandItem[]; branches: Array<{ id: string; name: string; address: string | null }>; phone: string; orders: number }

const RED = '#b3261e';
const MINUS = 'M5 12h14';
const PLUS = 'M12 5v14M5 12h14';
const QR = 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2v2h-2zM14 18h2v2h-2zM18 18h2v2h-2zM16 16h2v2h-2z';
const name = (n: Names, lang: Lang) => n[lang] ?? n.en;
export const birr = (L: Lfn, n: number) => L('owner.birr', { a: n.toLocaleString('en-US') });

/** The owner's view of where an order is (OwnStandOrders pills). */
type Shown = 'placed' | 'prep' | 'way' | 'recv' | 'prob' | 'done' | 'cancel';
function shown(o: StandOrder): Shown {
  if (o.status === 'cancelled') return 'cancel';
  if (o.status !== 'open') return 'done';
  if (o.received === 'ok') return 'recv';
  if (o.received === 'problem') return 'prob';
  if (o.stage === 'placed') return 'placed';
  if (o.stage === 'way' || o.stage === 'delivered') return 'way';
  return 'prep';
}
const SHOWN_KEY: Record<Shown, string> = { placed: 'owner.stOrdNew', prep: 'owner.stOrdPrep', way: 'owner.stOrdWay', recv: 'owner.stOrdRecv', prob: 'owner.stOrdProb', done: 'owner.stOrdDone', cancel: 'owner.stOrdCancel' };
export const standStatus = (L: Lfn, o: StandOrder) => L(SHOWN_KEY[shown(o)]);
const itemsLine = (o: StandOrder, lang: Lang) => o.lines.map((l) => `${name(l.name, lang)} × ${l.qty}`).join(', ');

function Kv({ rows }: { rows: Array<[string, string]> }) {
  return (
    <div className={s.kvCard}>
      {rows.map(([k, v], i) => <div key={i} className={s.kvLine}><span style={{ color: '#444' }}>{k}</span><span style={{ fontWeight: 700, color: '#333', textAlign: 'right' }}>{v}</span></div>)}
    </div>
  );
}

/** QR and posters: the PRINTED STANDS rows. */
export function StandRows({ L, onOrder, onOrders }: { L: Lfn; onOrder: () => void; onOrders: () => void }) {
  const shop = useLoad<Shop>('/owner/stands');
  return (
    <>
      <div className={s.section}>{L('owner.psStandLbl')}</div>
      <ul className={`${s.card} ${s.rows}`}>
        <Row icon={IC.card} title={L('owner.psOrder')} sub={L('owner.psOrderSub')} onClick={onOrder} />
        <Row icon={IC.log} title={L('owner.psOrders')} sub={L('owner.psOrdersSub', { a: shop.data?.orders ?? 0 }, shop.data?.orders ?? 0)} onClick={onOrders} />
      </ul>
    </>
  );
}

/** OwnStands: pick items and quantities (0 to 20). */
export function Stands({ L, lang, cart, setCart, onReview, onToast }: { L: Lfn; lang: Lang; cart: Cart; setCart: (c: Cart) => void; onReview: () => void; onToast: (m: string) => void }) {
  const shop = useLoad<Shop>('/owner/stands');
  if (!shop.data) return null;
  const items = shop.data.items;
  const n = items.reduce((a, it) => a + (cart[it.id] ?? 0), 0);
  const total = items.reduce((a, it) => a + (cart[it.id] ?? 0) * it.price, 0);
  const set = (id: string, q: number) => setCart({ ...cart, [id]: Math.max(0, Math.min(20, q)) });
  return (
    <>
      <p className={s.help}>{L('owner.stHelp')}</p>
      {items.map((it) => {
        const q = cart[it.id] ?? 0;
        return (
          <div key={it.id} style={{ marginTop: 12, boxSizing: 'border-box', padding: 14, borderRadius: 10, background: '#fff', border: q > 0 ? '1.5px solid #333' : '1.5px solid transparent', filter: 'drop-shadow(0 3px 5px rgba(0,0,0,0.13))' }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <div style={{ flex: 'none', width: 52, height: 52, borderRadius: 8, background: '#f3f3f3', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon d={QR} size={26} color="#444" /></div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, lineHeight: '20px', fontWeight: 700, color: '#333' }}>{name(it.name, lang)}</div>
                <div style={{ marginTop: 2, fontSize: 13, lineHeight: '18px', color: '#555' }}>{name(it.description, lang)}</div>
              </div>
            </div>
            <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <span style={{ fontSize: 16, fontWeight: 700, color: '#222' }}>{birr(L, it.price)}</span>
              <span className={s.stepper}>
                <button type="button" className={s.stepBtn} aria-label={`- ${name(it.name, lang)}`} onClick={() => set(it.id, q - 1)} disabled={q === 0}><Icon d={MINUS} size={20} /></button>
                <span style={{ minWidth: 28, textAlign: 'center', fontSize: 17, fontWeight: 700, color: '#333' }} aria-live="polite">{q}</span>
                <button type="button" className={s.stepBtn} aria-label={`+ ${name(it.name, lang)}`} onClick={() => set(it.id, q + 1)} disabled={q === 20}><Icon d={PLUS} size={20} /></button>
              </span>
            </div>
          </div>
        );
      })}
      <p style={{ margin: '12px 0 0', fontSize: 13, lineHeight: '18px', color: '#555' }}>{L('owner.stNote')}</p>
      <button type="button" className={s.cta} style={{ background: n ? '#333' : '#8a8a8a' }} onClick={() => (n ? onReview() : onToast(L('owner.stPickToast')))}>
        {n ? L('owner.stReview', { a: n, b: birr(L, total) }, n) : L('owner.stPick')}
      </button>
    </>
  );
}

/** OwnStandCart: the order, printed language, branch, phone; pay on delivery. */
export function StandCart({ L, lang, cart, onPlaced, onToast }: { L: Lfn; lang: Lang; cart: Cart; onPlaced: (o: { id: string }) => void; onToast: (m: string) => void }) {
  const shop = useLoad<Shop>('/owner/stands');
  const [plang, setPlang] = useState<'en' | 'am' | 'om' | 'all'>(lang);
  const [br, setBr] = useState('');
  const [phone, setPhone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!shop.data) return null;
  const lines = shop.data.items.filter((it) => (cart[it.id] ?? 0) > 0);
  const total = lines.reduce((a, it) => a + cart[it.id] * it.price, 0);
  const branch = shop.data.branches.find((b) => b.id === br) ?? shop.data.branches[0];
  const ph = phone ?? shop.data.phone;
  const place = async () => {
    if (!lines.length) { onToast(L('owner.stPickToast')); return; }
    setBusy(true);
    try {
      const o = await authed<{ id: string }>('owner', 'POST', '/owner/stands/orders', { items: Object.fromEntries(lines.map((it) => [it.id, cart[it.id]])), branchId: branch?.id, phone: ph, language: plang });
      onPlaced(o);
    } catch (e) {
      onToast(e instanceof ApiFailure && e.code === 'bad_phone' ? L('owner.badPhone') : L('owner.tryAgain'));
    } finally { setBusy(false); }
  };
  return (
    <>
      <div className={s.section} style={{ marginTop: 4 }}>{L('owner.stCartLbl')}</div>
      <Kv rows={lines.map((it) => [`${name(it.name, lang)} × ${cart[it.id]}`, birr(L, it.price * cart[it.id])])} />
      <div style={{ height: 10 }} />
      <Kv rows={[[L('owner.stSub'), birr(L, total)], [L('owner.stDelivery'), L('owner.stFree')], [L('owner.stTotal'), birr(L, total)]]} />
      <div className={s.section} style={{ marginTop: 20 }}>{L('owner.stLangLbl')}</div>
      <div className={s.chips} style={{ marginTop: 0 }}>
        {([['en', 'English'], ['am', 'አማርኛ'], ['om', 'Afaan Oromoo'], ['all', L('owner.stAll')]] as const).map(([v, l]) => <button key={v} type="button" className={s.chip} aria-pressed={plang === v} onClick={() => setPlang(v)}>{l}</button>)}
      </div>
      <div className={s.section} style={{ marginTop: 20 }}>{L('owner.stBrLbl')}</div>
      <div className={s.chips} style={{ marginTop: 0 }}>
        {shop.data.branches.map((b) => <button key={b.id} type="button" className={s.chip} aria-pressed={branch?.id === b.id} onClick={() => setBr(b.id)}>{b.name}</button>)}
      </div>
      {branch?.address && <p style={{ margin: '8px 0 0', fontSize: 13, lineHeight: '18px', color: '#555' }}>{branch.address}</p>}
      <label htmlFor="f_stphone" className={s.label} style={{ marginTop: 18 }}>{L('owner.stPhoneLbl')}</label>
      <input id="f_stphone" className={s.input} type="tel" inputMode="tel" value={ph} onChange={(e) => setPhone(e.target.value)} maxLength={16} autoComplete="off" placeholder="+251 9X XXX XXXX" />
      <div style={{ marginTop: 16, boxSizing: 'border-box', padding: 14, borderRadius: 10, background: '#fff', filter: 'drop-shadow(0 3px 5px rgba(0,0,0,0.13))' }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <Icon d={IC.card} size={22} color="#444" />
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#333' }}>{L('owner.stPayT')}</div>
            <p style={{ margin: '3px 0 0', fontSize: 13, lineHeight: '18px', color: '#555' }}>{L('owner.stPayText')}</p>
          </div>
        </div>
      </div>
      <p style={{ margin: '10px 0 0', fontSize: 13, lineHeight: '18px', color: '#555' }}>{L('owner.stEta')}</p>
      <button type="button" className={s.cta} onClick={place} disabled={busy}>{L('owner.stPlace', { a: birr(L, total) })}</button>
    </>
  );
}

/** OwnStandPlaced. */
export function StandPlaced({ L, lang, id, onOrders, onPoster }: { L: Lfn; lang: Lang; id: string; onOrders: () => void; onPoster: () => void }) {
  const o = useLoad<StandOrder>(`/owner/stands/orders/${id}`);
  if (!o.data) return null;
  return (
    <>
      <div style={{ marginTop: 14, textAlign: 'center' }}>
        <div style={{ display: 'inline-flex', width: 72, height: 72, boxSizing: 'border-box', borderRadius: '50%', border: '3px solid #333', background: '#fff', alignItems: 'center', justifyContent: 'center' }}><Icon d={IC.check} size={36} /></div>
        <h1 style={{ margin: '14px 0 0', fontSize: 20, fontWeight: 700, color: '#333' }}>{L('owner.stPlacedT', { a: o.data.code })}</h1>
        <p style={{ margin: '6px 0 0', fontSize: 14, lineHeight: '20px', color: '#444' }}>{L('owner.stPlacedText', { a: o.data.phone })}</p>
      </div>
      <div style={{ height: 16 }} />
      <Kv rows={[...o.data.lines.map((l): [string, string] => [`${name(l.name, lang)} × ${l.qty}`, birr(L, l.price * l.qty)]), [L('owner.stTotal'), birr(L, o.data.total)]]} />
      <button type="button" className={s.cta} style={{ marginTop: 18 }} onClick={onOrders}>{L('owner.stSeeOrders')}</button>
      <button type="button" className={s.ghost} onClick={onPoster}>{L('owner.stBackPoster')}</button>
    </>
  );
}

/** OwnStandOrders: the last 12 months. */
export function StandOrders({ L, lang, onOpen }: { L: Lfn; lang: Lang; onOpen: (id: string) => void }) {
  const r = useLoad<StandOrder[]>('/owner/stands/orders');
  if (!r.data) return null;
  return (
    <>
      <p className={s.help}>{L('owner.stOrdersHelp')}</p>
      {r.data.length === 0 && <p className={s.muted} style={{ marginTop: 12 }}>{L('owner.stOrdersNone')}</p>}
      {r.data.length > 0 && (
        <div className={s.kvCard} style={{ marginTop: 12 }}>
          {r.data.map((o, i) => {
            const st = shown(o);
            const pill = st === 'done' || st === 'recv' || st === 'cancel' ? { c: '#555', b: '1.5px solid #bdbdbd' } : st === 'prob' ? { c: RED, b: `1.5px solid ${RED}` } : { c: '#222', b: '1.5px solid #444' };
            return (
              <button key={o.id} type="button" className={s.rowBtn} onClick={() => onOpen(o.id)} style={{ display: 'block', width: '100%', padding: '12px 0', borderTop: i === 0 ? 'none' : '1.5px dashed #e0e0e0', textAlign: 'left' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                  <div style={{ fontSize: 14, lineHeight: '20px', fontWeight: 700, color: '#333' }}>{L('owner.stOrderLine', { a: o.code, b: formatWhen(o.createdAt, lang) })}</div>
                  <span style={{ flex: 'none', display: 'inline-block', padding: '3px 10px', borderRadius: 12, border: pill.b, fontSize: 13, lineHeight: '18px', fontWeight: 700, color: pill.c }}>{L(SHOWN_KEY[st])}</span>
                </div>
                <div style={{ marginTop: 3, fontSize: 13, lineHeight: '18px', color: '#555' }}>{L('owner.stOrderSub', { a: itemsLine(o, lang), b: birr(L, o.total) })}</div>
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}

/** OwnStandOrder (Wait, Bad, Done, Prob): the order and "Did your order arrive?". */
export function StandOrderScreen({ L, lang, id, onToast, onChanged }: { L: Lfn; lang: Lang; id: string; onToast: (m: string) => void; onChanged: () => void }) {
  const r = useLoad<StandOrder>(`/owner/stands/orders/${id}`);
  const [cond, setCond] = useState<'' | 'ok' | 'missing' | 'damaged'>('');
  const [pay, setPay] = useState<'cash' | 'telebirr'>('cash');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  if (!r.data) return null;
  const o = r.data;
  const st = shown(o);
  const paid = o.received === 'ok' || (o.status === 'done' && o.cashReceived !== null);
  const bad = cond === 'missing' || cond === 'damaged';
  const submit = async () => {
    if (!cond) { onToast(L('owner.soNeedCond')); return; }
    if (bad && !note.trim()) { onToast(L('owner.soNeedNote')); return; }
    setBusy(true);
    try {
      await authed('owner', 'POST', `/owner/stands/orders/${id}/receive`, bad ? { condition: cond, note: note.trim() } : { condition: 'ok', pay });
      onToast(bad ? L('owner.soToastBad') : L('owner.soToastOk'));
      setCond(''); setNote(''); r.reload(); onChanged();
    } catch { onToast(L('owner.tryAgain')); } finally { setBusy(false); }
  };
  return (
    <>
      <Kv rows={[
        [L('owner.stOrderLine', { a: o.code, b: formatWhen(o.createdAt, lang) }), L(SHOWN_KEY[st])],
        ...o.lines.map((l): [string, string] => [`${name(l.name, lang)} × ${l.qty}`, birr(L, l.price * l.qty)]),
        [L('owner.stTotal'), birr(L, o.total)],
        [L('owner.soTo'), o.branch],
        [L('owner.soPhone'), o.phone],
        [L('owner.soPay'), paid ? L('owner.soPayDone') + (o.receivedPay ? ` · ${L(o.receivedPay === 'telebirr' ? 'owner.soTele' : 'owner.soCash')}` : '') : L('owner.soPayDue')],
      ]} />
      {st === 'cancel' && o.result && <p style={{ margin: '12px 0 0', fontSize: 13, lineHeight: '18px', color: '#555' }}>{o.result}</p>}
      {(st === 'placed' || st === 'prep') && <p style={{ margin: '12px 0 0', fontSize: 13, lineHeight: '18px', color: '#555' }}>{L('owner.soWait')}</p>}
      {st === 'way' && (
        <>
          <div style={{ marginTop: 12, boxSizing: 'border-box', padding: 16, borderRadius: 10, background: '#fff', filter: 'drop-shadow(0 3px 5px rgba(0,0,0,0.13))' }}>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#333' }}>{L('owner.soDidT')}</h2>
            <p style={{ margin: '6px 0 0', fontSize: 13, lineHeight: '18px', color: '#555' }}>{L('owner.soDidSub')}</p>
          </div>
          <div className={s.section} style={{ marginTop: 18 }}>{L('owner.soCondLbl')}</div>
          <div className={s.chips} style={{ marginTop: 0 }}>
            {([['ok', 'owner.soOk'], ['missing', 'owner.soMiss'], ['damaged', 'owner.soBad']] as const).map(([v, k]) => <button key={v} type="button" className={s.chip} aria-pressed={cond === v} onClick={() => setCond(v)}>{L(k)}</button>)}
          </div>
          {bad && (
            <>
              <label htmlFor="f_rcnote" className={s.label}>{L('owner.soNoteLbl')}</label>
              <input id="f_rcnote" className={s.input} type="text" value={note} onChange={(e) => setNote(e.target.value)} maxLength={120} autoComplete="off" placeholder={L('owner.soNotePh')} />
            </>
          )}
          {cond === 'ok' && (
            <>
              <div className={s.section} style={{ marginTop: 18 }}>{L('owner.soPayLbl')}</div>
              <div className={s.chips} style={{ marginTop: 0 }}>
                {([['cash', 'owner.soCash'], ['telebirr', 'owner.soTele']] as const).map(([v, k]) => <button key={v} type="button" className={s.chip} aria-pressed={pay === v} onClick={() => setPay(v)}>{L(k)}</button>)}
              </div>
            </>
          )}
          <button type="button" className={s.cta} style={{ marginTop: 18, background: cond ? (cond === 'ok' ? '#333' : RED) : '#8a8a8a' }} onClick={submit} disabled={busy}>{bad ? L('owner.soBtnBad') : L('owner.soBtnOk')}</button>
        </>
      )}
      {st === 'recv' && (
        <div style={{ marginTop: 14, boxSizing: 'border-box', padding: 16, borderRadius: 10, background: '#fff', filter: 'drop-shadow(0 3px 5px rgba(0,0,0,0.13))' }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <Icon d={IC.check} size={22} />
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#333' }}>{L('owner.soDoneT')}</div>
              <p style={{ margin: '3px 0 0', fontSize: 13, lineHeight: '18px', color: '#555' }}>{L('owner.soDoneText', { a: o.receivedAt ? formatDay(new Date(o.receivedAt), lang) : '' })}</p>
            </div>
          </div>
        </div>
      )}
      {st === 'prob' && (
        <div style={{ marginTop: 14, boxSizing: 'border-box', padding: 16, borderRadius: 10, background: '#fff', filter: 'drop-shadow(0 3px 5px rgba(0,0,0,0.13))' }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <Icon d={IC.info} size={22} color={RED} />
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: RED }}>{L('owner.soProbT')}</div>
              <p style={{ margin: '3px 0 0', fontSize: 13, lineHeight: '18px', color: '#555' }}>{L('owner.soProbText', { a: o.phone })}</p>
              {o.receivedNote && <p style={{ margin: '6px 0 0', fontSize: 13, lineHeight: '18px', color: '#333' }}>“{o.receivedNote}”</p>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
