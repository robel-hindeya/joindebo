'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { isLang, t, type Lang, type MessageKey } from '@temelash/i18n';
import { ApiFailure, apiPost, authed, loadSession, saveSession } from '@temelash/ui';
import { QrSvg, useCardCode } from './live-qr';
import s from './wallet.module.css';
import { CustomerMenu, History } from './more';

/**
 * Main board: the wallet list, a card's ticket (stamps, rewards, live QR),
 * full-screen QR, redeem (confirm → code for staff → used), "Stamp added!",
 * adding a card by shop code, the menu and History (more.tsx).
 */

interface Reward { id: string; tier: number; reward: string; status: 'ready' | 'used' | 'expired'; expiresAt: string; code: string | null }
interface Card {
  id: string;
  status: 'active' | 'paused' | 'redeemed' | 'expired';
  shop: { name: string; shopCode: string; color?: string; logoUrl?: string | null };
  count: number;
  total: number;
  ladder: Array<{ tier: number; at: number; reward: string }>;
  rewards: Reward[];
  stampedToday: boolean;
  expiresAt: string | null;
  qr: { secret: string; short: string };
}

const CACHE = 'tc_cards';
const GIFT = 'M4 10h16v10H4zM3 10h18M12 10v10M12 10C9.5 5.5 6 6.5 7.5 9M12 10c2.5-4.5 6-3.5 4.5-1';
const TICK = 'M5 12.5l4.5 4.5L19 7.5';

function Icon({ d, size = 24, color = '#333', width = 1.6 }: { d: string; size?: number; color?: string; width?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}
/** Shop colour as CSS variables, with white or dark text chosen for contrast (OwnLook). */
function brand(color = '#333333'): React.CSSProperties {
  const lum = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const l = 0.2126 * lum[0] + 0.7152 * lum[1] + 0.0722 * lum[2];
  return { '--brand': color, '--brand-fg': 1.05 / (l + 0.05) >= 4.5 ? '#fff' : '#222' } as React.CSSProperties;
}
function ShopLogo({ shop, className }: { shop: Card['shop']; className: string }) {
  return shop.logoUrl
    ? <img src={shop.logoUrl} alt="" className={className} style={{ objectFit: 'cover', background: '#fff' }} />
    : <span className={className} aria-hidden="true">{initials(shop.name)}</span>;
}
const initials = (n: string) => n.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
const readCache = (): Card[] | null => {
  try {
    const raw = localStorage.getItem(CACHE);
    return raw ? (JSON.parse(raw) as Card[]) : null;
  } catch {
    return null;
  }
};

export function Wallet() {
  const router = useRouter();
  const [lang, setLang] = useState<Lang>('en');
  const L = useCallback((k: string, v?: Record<string, string | number>, n?: number) => t(lang, k as MessageKey, v, n), [lang]);
  const [cards, setCards] = useState<Card[] | null>(null);
  const [selId, setSelId] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [qrFull, setQrFull] = useState(false);
  const [redeem, setRedeem] = useState<{ stage: 'confirm' | 'code' | 'done'; reward: Reward; shop: string; at?: Date } | null>(null);
  const [earned, setEarned] = useState<{ card: Card } | null>(null);
  const [codeSheet, setCodeSheet] = useState(false);
  const [shopCode, setShopCode] = useState('');
  const [codeErr, setCodeErr] = useState('');
  const [toast, setToast] = useState('');
  const [menu, setMenu] = useState(false);
  const [history, setHistory] = useState(false);
  const prev = useRef<Map<string, Card>>(new Map());

  const sel = useMemo(() => cards?.find((c) => c.id === selId) ?? null, [cards, selId]);
  const { code, left, pct } = useCardCode(sel && sel.status === 'active' ? sel : null);

  const load = useCallback(async () => {
    try {
      const next = await authed<Card[]>('customer', 'GET', '/customer/cards');
      setOffline(false);
      // A new stamp since the last look: the "Stamp added!" moment (StampEarned).
      for (const c of next) {
        const before = prev.current.get(c.id);
        if (before && c.count > before.count) setEarned({ card: c });
      }
      prev.current = new Map(next.map((c) => [c.id, c]));
      setCards(next);
      try {
        localStorage.setItem(CACHE, JSON.stringify(next));
      } catch {
        /* storage unavailable: codes still work while the page is open */
      }
    } catch (e) {
      if (e instanceof ApiFailure && e.status === 401) return router.replace('/');
      // Offline: keep showing the saved cards; their QR codes still work.
      setOffline(true);
      setCards((c) => c ?? readCache() ?? []);
    }
  }, [router]);

  useEffect(() => {
    const m = document.cookie.match(/(?:^|; )tc_lang=(\w+)/);
    if (m && isLang(m[1])) setLang(m[1]);
    if (!loadSession('customer')) return router.replace('/');
    const cached = readCache();
    if (cached) {
      setCards(cached);
      prev.current = new Map(cached.map((c) => [c.id, c]));
    }
    load();
    const id = setInterval(load, 10_000);
    const goOffline = () => setOffline(true);
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', load);
    return () => {
      clearInterval(id);
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', load);
    };
  }, [load, router]);

  // While the reward code is on screen, the cashier's confirmation turns it into "Reward used".
  useEffect(() => {
    if (redeem?.stage !== 'code' || !cards) return;
    const r = cards.flatMap((c) => c.rewards).find((x) => x.id === redeem.reward.id);
    if (r?.status === 'used') setRedeem({ ...redeem, stage: 'done', at: new Date() });
  }, [cards, redeem]);

  const addByCode = async () => {
    const code = shopCode.trim().toUpperCase();
    if (!code) return setCodeErr(L('main.codeErrEmpty'));
    try {
      await authed('customer', 'POST', '/customer/cards', { shopCode: code });
      setCodeSheet(false);
      setShopCode('');
      setCodeErr('');
      await load();
      const added = (readCache() ?? []).find((c) => c.shop.shopCode === code);
      setToast(added && added.count > 0 ? L('main.codeAdded', { a: added.shop.name }) : '');
    } catch (e) {
      setCodeErr(e instanceof ApiFailure && e.code === 'have_card' ? L('main.codeHave') : e instanceof ApiFailure && e.code === 'no_shop' ? L('main.codeErrBad') : L('common.offline'));
    }
  };

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(''), 3500);
    return () => clearTimeout(id);
  }, [toast]);

  const signOut = async () => {
    const sess = loadSession('customer');
    if (sess) await apiPost('/auth/signout', {}, sess.accessToken).catch(() => {});
    saveSession('customer', null);
    try {
      localStorage.removeItem(CACHE);
    } catch {
      /* nothing saved */
    }
    router.replace('/');
  };

  const nextTier = (c: Card) => c.ladder.find((t) => t.at > c.count) ?? null;
  const ready = (c: Card) => c.rewards.find((r) => r.status === 'ready') ?? null;

  // ---------------------------------------------------------------- overlays
  const overlays = (
    <>
      {qrFull && sel && code && (
        <div className={`${s.full} tc-fade`} role="dialog" aria-modal="true" aria-label={sel.shop.name}>
          <div className={s.fullHead}>
            <button type="button" className={s.iconBtn} aria-label={L('main.closeQr')} onClick={() => setQrFull(false)}><Icon d="M6 6l12 12M18 6L6 18" /></button>
            <h2 className={s.fullTitle}>{sel.shop.name}</h2>
            <div style={{ width: 44, height: 44 }} />
          </div>
          <div style={{ marginTop: 30 }}><QrSvg text={code.qr} size={264} label={L('main.qrAria')} /></div>
          <div className={s.refresh} style={{ width: 264, marginTop: 18 }}><div className={s.refreshFill} style={{ width: pct }} /></div>
          <div className={s.small}>{L('main.codeIn', { a: left })}</div>
          <div className={s.code}>{code.typed}</div>
          <p className={s.help} style={{ margin: '14px 40px 0' }}>{L('main.qrFullHelp')}</p>
          <button type="button" className={s.fullBtn} onClick={() => setQrFull(false)}>{L('main.closeQr')}</button>
        </div>
      )}

      {redeem?.stage === 'confirm' && (
        <div className={`${s.dim} tc-fade`}>
          <div className={`${s.sheet} tc-sheet`} role="dialog" aria-modal="true" aria-label={L('main.rdConfirmTitle', { a: redeem.reward.reward })}>
            <div className={s.sheetIcon}><Icon d={GIFT} size={30} /></div>
            <h2 className={s.sheetTitle}>{L('main.rdConfirmTitle', { a: redeem.reward.reward })}</h2>
            <p className={s.sheetText}>{L('main.rdConfirmText')}</p>
            <button type="button" className={s.cta} onClick={() => setRedeem({ ...redeem, stage: 'code' })}>{L('main.rdShowCode')}</button>
            <button type="button" className={s.ctaPlain} style={{ marginTop: 8 }} onClick={() => setRedeem(null)}>{L('main.rdNotNow')}</button>
          </div>
        </div>
      )}

      {redeem?.stage === 'code' && redeem.reward.code && (
        <div className={`${s.full} tc-fade`} role="dialog" aria-modal="true" aria-label={L('main.rdTitle')} style={{ zIndex: 24 }}>
          <div className={s.fullHead}>
            <button type="button" className={s.iconBtn} aria-label={L('main.rdCancel')} onClick={() => setRedeem(null)}><Icon d="M6 6l12 12M18 6L6 18" /></button>
            <h2 className={s.fullTitle}>{L('main.rdTitle')}</h2>
            <div style={{ width: 44, height: 44 }} />
          </div>
          <div style={{ marginTop: 4, maxWidth: 300, textAlign: 'center', fontSize: 18, lineHeight: '24px', fontWeight: 700, color: '#333' }}>{redeem.reward.reward}</div>
          <div style={{ marginTop: 2, fontSize: 13, letterSpacing: 0.7, color: '#595959', textTransform: 'uppercase' }}>{redeem.shop}</div>
          <div style={{ marginTop: 22 }}><QrSvg text={`TCR:${redeem.reward.code}`} size={236} label={L('main.rdTitle')} /></div>
          <div className={s.code}>{redeem.reward.code}</div>
          <p className={s.help} style={{ margin: '14px 40px 0' }}>{L('main.rdHelp')}</p>
          <button type="button" className={s.fullBtn} style={{ width: 236, marginTop: 16, height: 48 }} onClick={() => setRedeem(null)}>{L('main.rdCancel')}</button>
        </div>
      )}

      {redeem?.stage === 'done' && (
        <div className={`${s.dim} tc-fade`}>
          <div className={`${s.sheet} tc-sheet`} role="dialog" aria-modal="true" aria-label={L('main.rdDoneTitle')} style={{ paddingTop: 30 }}>
            <div className={`${s.tick} tc-slam`}><Icon d={TICK} size={34} color="#fff" width={2.6} /></div>
            <h2 className={s.sheetTitle} style={{ marginTop: 18, fontSize: 22 }}>{L('main.rdDoneTitle')}</h2>
            <div className={s.used}>
              <div style={{ fontSize: 16, lineHeight: '22px', fontWeight: 700, color: '#333' }}>{redeem.reward.reward}</div>
              <div className={s.muted} style={{ marginTop: 4 }}>{redeem.shop} · {redeem.at?.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Addis_Ababa' })}</div>
            </div>
            <button type="button" className={s.cta} onClick={() => setRedeem(null)}>{L('main.done')}</button>
          </div>
        </div>
      )}

      {earned && (
        <div className={`${s.dim} tc-fade`}>
          <div className={`${s.earned} tc-sheet`} role="dialog" aria-modal="true" aria-label={L('main.stampAdded')}>
            <div className={s.earnedArt}>
              <span className={`${s.ring} tc-ripple`} />
              <span className={`${s.ring} tc-ripple`} style={{ animationDelay: '0.65s' }} />
              <div className={`${s.slamDisc} tc-slam`}><Icon d={TICK} size={56} color="#fff" width={2.4} /></div>
            </div>
            <h2 className={s.sheetTitle} style={{ marginTop: 20, fontSize: 22 }}>{L('main.stampAdded')}</h2>
            <p className={s.sheetText} style={{ marginTop: 6 }}>{L('main.progress', { a: earned.card.count, b: earned.card.total })}</p>
            <ul className={s.dots} aria-hidden="true">
              {Array.from({ length: earned.card.total }, (_, i) => <li key={i} data-on={i < earned.card.count} />)}
            </ul>
            {ready(earned.card) && <p style={{ margin: '14px 0 0', fontSize: 13, lineHeight: '18px', fontWeight: 700, color: '#444' }}>{L('main.unlockedReady', { a: ready(earned.card)!.reward })}</p>}
            <button type="button" className={s.cta} style={{ marginTop: 22 }} onClick={() => setEarned(null)}>{L('main.done')}</button>
          </div>
        </div>
      )}

      {codeSheet && (
        <div className={`${s.dim} tc-fade`} style={{ zIndex: 26 }}>
          <div className={`${s.sheetLeft} tc-sheet`} role="dialog" aria-modal="true" aria-label={L('main.codeTitle')}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#333' }}>{L('main.codeTitle')}</h2>
            <p style={{ margin: '8px 0 0', fontSize: 13, lineHeight: '18px', color: '#555' }}>{L('main.codeHelp')}</p>
            <label htmlFor="shopcode" className={s.fieldLabel}>{L('main.codeLbl')}</label>
            <input id="shopcode" className={s.field} value={shopCode} maxLength={8} autoComplete="off" autoCapitalize="characters" placeholder="MOKA24"
              onChange={(e) => setShopCode(e.target.value.replace(/[^a-z0-9]/gi, ''))} onKeyDown={(e) => e.key === 'Enter' && addByCode()} />
            <p role="alert" className={s.alert}>{codeErr}</p>
            <button type="button" className={s.cta} style={{ marginTop: 8 }} onClick={addByCode}>{L('main.codeAdd')}</button>
            <button type="button" className={s.ctaPlain} onClick={() => { setCodeSheet(false); setCodeErr(''); }}>{L('main.closeQr')}</button>
          </div>
        </div>
      )}

      {toast && <div className={`${s.toast} tc-fade`} role="status">{toast}</div>}
    </>
  );

  const offlineBanner = offline && (
    <div role="status" className={s.banner}>
      <Icon d="M3 3l18 18M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 5-2.8M19 13a10 10 0 0 0-3-2.2M2 9a15 15 0 0 1 6-3M22 9a15 15 0 0 0-9-3.9" size={18} color="#444" width={1.8} />
      <span>{L('main.offlineBanner')}</span>
    </div>
  );

  // ---------------------------------------------------------------- detail
  if (sel) {
    const r = ready(sel);
    const cols = sel.total <= 8 ? 4 : 5;
    const ats = new Set(sel.ladder.map((t) => t.at));
    const big = nextTier(sel) ?? sel.ladder[sel.ladder.length - 1];
    return (
      <main className={s.screen}>
        <div className={s.header}>
          <button type="button" className={s.iconBtn} aria-label={L('main.backToCoupons')} onClick={() => setSelId(null)}><Icon d="M15 5l-7 7 7 7" /></button>
          <h1 className={s.title}>{L('main.myCoupons')}</h1>
          <div style={{ width: 44, height: 44 }} />
        </div>
        {offlineBanner}
        <div className={`${s.detail} tc-panel`} style={brand(sel.shop.color)}>
          <div className={s.ticket}>
            <div className={s.upper}>
              <div className={s.upperHead}>
                <ShopLogo shop={sel.shop} className={s.logoBig} />
                <div style={{ flex: 1, minWidth: 0, paddingTop: 8 }}>
                  <div className={s.detailLabel}>{sel.shop.name}</div>
                  <div className={s.bigRow} style={{ marginTop: 10 }}>
                    <span className={s.detailBig}>{sel.count}</span>
                    <span className={s.post} style={{ marginBottom: 6 }}>{L('main.stampPost', { a: sel.total })}</span>
                  </div>
                </div>
              </div>
              {big && <p className={s.headline}>{L('main.loyHeadline', { a: big.reward.toLowerCase(), b: big.at })}</p>}

              <div className={s.section}>
                <div className={s.sectionHead}>
                  <h3 className={s.sectionTitle}>{L('main.loyaltyStamps')}</h3>
                  <span className={s.muted}>{sel.count} / {sel.total}</span>
                </div>
                <ul className={s.stamps} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
                  {Array.from({ length: sel.total }, (_, i) => {
                    const on = i < sel.count;
                    const isNew = earned?.card.id === sel.id && i === sel.count - 1;
                    return (
                      <li key={i} className={`${s.stamp} ${isNew ? 'tc-stampin' : ''}`} data-on={on}
                        aria-label={on ? L('main.stampAria', { a: i + 1 }) : L('join.stampAria', { n: i + 1 })}>
                        {on ? <Icon d={TICK} size={20} color="#fff" width={2.4} /> : ats.has(i + 1) ? <Icon d={GIFT} size={20} color="#595959" /> : <span className={s.stampN}>{i + 1}</span>}
                      </li>
                    );
                  })}
                </ul>
              </div>

              <div className={s.rewards}>
                {r && sel.status === 'active' && (
                  <div className={s.unlocked}>
                    <div role="status" className={s.unlockedRow}>
                      <span className={`${s.gift} tc-bounce`}><Icon d={GIFT} size={22} color="#fff" width={1.8} /></span>
                      <span className={s.unlockedText}>{L('main.unlockedReady', { a: r.reward })}</span>
                    </div>
                    <button type="button" className={s.redeemBtn} disabled={offline} onClick={() => setRedeem({ stage: 'confirm', reward: r, shop: sel.shop.name })}>{L('main.redeemNow')}</button>
                  </div>
                )}
                <ul className={s.tiers}>
                  {sel.ladder.map((tier) => {
                    const pctT = Math.min(100, Math.round((sel.count / tier.at) * 100));
                    const left = Math.max(0, tier.at - sel.count);
                    return (
                      <li key={tier.tier} className={s.tier}>
                        <div className={s.tierHead}>
                          <span>{L('main.rewardAt', { a: tier.at }, tier.at)}</span>
                          <span style={{ color: '#444', fontWeight: left === 0 ? 700 : 400 }}>{left > 0 ? L('main.stampsLeft', { a: left }, left) : L('main.readyPill')}</span>
                        </div>
                        <div className={s.tierName}><Icon d={GIFT} size={18} color="#444" /><span>{tier.reward}</span></div>
                        <div className={s.tierBar}><div className={s.barFill} style={{ width: `${pctT}%` }} /></div>
                        <div className={s.muted} style={{ marginTop: 6 }}>{L('main.progress', { a: Math.min(sel.count, tier.at), b: tier.at })}</div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>

            <div className={s.stub}>
              <div className={s.stubTear} />
              {sel.status === 'active' && code ? (
                <>
                  <button type="button" className={s.qrBtn} aria-label={L('main.openQrFull')} onClick={() => setQrFull(true)}>
                    <QrSvg text={code.qr} size={152} label={L('main.qrAria')} />
                  </button>
                  <div className={s.refresh}><div className={s.refreshFill} style={{ width: pct }} /></div>
                  <div className={s.small}>{L('main.codeIn', { a: left })}</div>
                  <div className={s.help}>{offline ? L('main.qrHelpOffline') : L('main.qrHelp')}</div>
                  <div className={s.code}>{code.typed}</div>
                </>
              ) : (
                <div className={s.block}>
                  <Icon d={sel.status === 'paused' ? 'M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3' : TICK} size={30} color="#444" />
                  <div className={s.blockTitle}>{sel.status === 'paused' ? L('main.pausedTitle') : sel.status === 'redeemed' ? L('main.redeemedTitle') : L('main.expiredTitle')}</div>
                  <div className={s.blockText}>{sel.status === 'paused' ? L('main.pausedText', { a: sel.shop.name }) : sel.status === 'redeemed' ? L('main.redeemedText') : ''}</div>
                </div>
              )}
              <div style={{ height: 14 }} />
            </div>
          </div>
        </div>
        {overlays}
      </main>
    );
  }

  // ---------------------------------------------------------------- History (from the menu)
  if (history) return <History L={L} onBack={() => setHistory(false)} />;

  // ---------------------------------------------------------------- list
  return (
    <main className={s.screen}>
      <div className={s.header}>
        {/* The board's bell opens Notifications, which come with Phase 6; until then its place stays empty. */}
        <div style={{ width: 44, height: 44 }} />
        <h1 className={s.title}>{L('main.myCoupons')}</h1>
        <button type="button" className={s.iconBtn} aria-label={L('main.openMenu')} aria-haspopup="dialog" onClick={() => setMenu(true)}><Icon d="M4 7h16M4 12h16M4 17h16" /></button>
      </div>
      {offlineBanner}
      <div className={s.list}>
        {cards === null && Array.from({ length: 3 }, (_, i) => (
          <div key={i} className={s.item} role="status" aria-label={L('main.loadingCards')}>
            <div className={s.itemBody}>
              <div className={s.itemLogoPanel}><div className="tc-skel" style={{ width: 64, height: 64, borderRadius: '50%' }} /></div>
              <div className={s.tear} />
              <div className={s.itemText} style={{ justifyContent: 'center', gap: 14 }}>
                <div className="tc-skel" style={{ width: 90, height: 12, borderRadius: 6 }} />
                <div className="tc-skel" style={{ width: 120, height: 30, borderRadius: 8 }} />
              </div>
            </div>
          </div>
        ))}

        {cards?.length === 0 && (
          <div className={`${s.empty} tc-fade`}>
            <div className={s.emptyIcon}><Icon d="M2 8V3h5M19 3h5v5M24 18v5h-5M7 23H2v-5" size={40} color="#444" /></div>
            <h2 className={s.emptyTitle}>{L('main.emptyTitle')}</h2>
            <p className={s.emptyText}>{L('main.emptyText')}</p>
            <ol className={s.steps}>
              {(['main.emptyS1', 'main.emptyS2', 'main.emptyS3'] as const).map((k, i) => (
                <li key={k}><span className={s.stepNo} aria-hidden="true">{i + 1}</span><span>{L(k)}</span></li>
              ))}
            </ol>
            <button type="button" className={s.ctaOutline} onClick={() => setCodeSheet(true)}>{L('main.emptyCode')}</button>
          </div>
        )}

        {cards?.map((c) => {
          const r = ready(c);
          const n = nextTier(c);
          const foot = c.status === 'paused' ? L('main.statusPaused') : c.status === 'redeemed' ? L('main.statusRedeemed') : n ? L('main.rewardAt', { a: n.at }, n.at) : '';
          return (
            <button key={c.id} type="button" style={brand(c.shop.color)} className={`${s.item} tc-fade`} aria-label={`${c.shop.name} ${L('main.coupon')}`} onClick={() => setSelId(c.id)}>
              <div className={s.itemBody} style={{ opacity: c.status === 'active' ? 1 : 0.6 }}>
                <div className={s.itemLogoPanel}><ShopLogo shop={c.shop} className={s.logo} /></div>
                <div className={s.tear} />
                <div className={s.itemText}>
                  <div className={s.label}>{c.shop.name}</div>
                  <div className={s.bigRow}>
                    <span className={s.big}>{c.count}</span>
                    <span className={s.post}>{L('main.stampPost', { a: c.total })}</span>
                  </div>
                  <div className={s.bar} aria-hidden="true"><div className={s.barFill} style={{ width: `${Math.min(100, Math.round((c.count / c.total) * 100))}%` }} /></div>
                  {r && c.status === 'active' ? (
                    <div className={s.pill}><Icon d={GIFT} size={16} color="#fff" width={2} /><span>{L('main.readyPill')}</span></div>
                  ) : (
                    <div className={s.foot}>{foot}</div>
                  )}
                </div>
              </div>
            </button>
          );
        })}

        {cards && cards.length > 0 && (
          <button type="button" className={s.ctaOutline} onClick={() => setCodeSheet(true)}>{L('main.emptyCode')}</button>
        )}
      </div>
      {overlays}
      {menu && <CustomerMenu L={L} onClose={() => setMenu(false)} onSignOut={signOut} onHistory={() => { setMenu(false); setHistory(true); }} />}
    </main>
  );
}
