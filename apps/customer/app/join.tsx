'use client';

import { useEffect, useState } from 'react';
import { t, type Lang, type MessageKey } from '@temelash/i18n';
import { ApiFailure, apiGet, apiPost, saveSession, type Session } from '@temelash/ui';
import s from './join.module.css';

/**
 * ScanJoin board: a shop's join page. Join (phone, PIN twice, consent) or sign
 * in, PIN reset by SMS code in three steps, the lock panel after too many
 * wrong PINs, and the "You are in!" screen. Without a shop (opened from the
 * Temelash link rather than a shop QR) only sign-in is offered.
 */

interface Shop {
  name: string;
  shopCode: string;
  stampsNeeded: number | null;
  rewards: Array<{ at: number; reward: string }>;
}

type Mode = 'join' | 'signin';
type ResetStep = 'phone' | 'otp' | 'pin' | 'done';
type View = 'form' | 'reset' | 'welcome';

const digits = (v: string, max: number) => v.replace(/\D/g, '').slice(0, max);
const TICK = 'M5 12.5l4.5 4.5L19 7.5';
const CUP = 'M5 9h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5zM16 11h2a2.5 2.5 0 0 1 0 5h-2';

function Icon({ d, size = 18, color = '#444', width = 1.9 }: { d: string; size?: number; color?: string; width?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

function Logo({ name, className }: { name: string; className: string }) {
  // Shop logos arrive with the owner's Look page (Phase 3); until then, initials.
  const initials = name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  return <span className={className} aria-hidden="true">{initials || 'TC'}</span>;
}

export function JoinScreen({ lang, shopCode, onSignedIn }: { lang: Lang; shopCode?: string; onSignedIn: (s: Session) => void }) {
  const L = (k: MessageKey, vars?: Record<string, string | number>) => t(lang, k, vars);
  const [shop, setShop] = useState<Shop | null>(null);
  const [shopMissing, setShopMissing] = useState(false);
  const [view, setView] = useState<View>('form');
  const [mode, setMode] = useState<Mode>(shopCode ? 'join' : 'signin');
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [agree, setAgree] = useState(false);
  const [showStore, setShowStore] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const [lockUntil, setLockUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [rs, setRs] = useState<ResetStep>('phone');
  const [ticket, setTicket] = useState('');
  const [otp, setOtp] = useState('');
  const [npin, setNpin] = useState('');
  const [npin2, setNpin2] = useState('');
  const [joined, setJoined] = useState<{ session: Session; isJoin: boolean } | null>(null);

  const shopName = shop?.name ?? '';
  const isJoin = mode === 'join' && !!shopCode;

  useEffect(() => {
    if (!shopCode) return;
    apiGet<Shop>(`/shops/${encodeURIComponent(shopCode)}`)
      .then(setShop)
      .catch(() => setShopMissing(true));
  }, [shopCode]);

  // Lock countdown (ScanJoin lockText).
  useEffect(() => {
    if (lockUntil <= Date.now()) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [lockUntil]);
  const lockLeft = Math.max(0, Math.ceil((lockUntil - now) / 1000));
  const locked = lockLeft > 0;
  const lockClock = `${Math.floor(lockLeft / 60)}:${String(lockLeft % 60).padStart(2, '0')}`;

  const failText = (e: unknown): string => {
    if (!(e instanceof ApiFailure)) return L('common.offline');
    switch (e.code) {
      case 'offline': return L('common.offline');
      case 'bad_phone': return L('join.errPhone');
      case 'bad_pin': return L('join.errPin');
      case 'no_consent': return L('join.errConsent');
      case 'already_member': return L('join.errAlreadyMember');
      case 'no_shop': return L('join.noShop');
      case 'bad_code': return L('join.rErrOtp');
      case 'too_many_requests': case 'too_many_codes': return L('common.tooMany');
      case 'wrong_pin': {
        const left = e.body.triesLeft;
        if (typeof left !== 'number') return L('join.errWrongPinPlain');
        return left === 1 ? L('join.errWrongPin1') : L('join.errWrongPin', { n: left });
      }
      default: return L('common.offline');
    }
  };

  const submit = async () => {
    if (busy || locked) return;
    let err = '';
    if (!/^[79]\d{8}$/.test(phone)) err = L('join.errPhone');
    else if (!/^\d{6}$/.test(pin)) err = L('join.errPin');
    else if (isJoin && pin2 !== pin) err = L('join.errMismatch');
    else if (isJoin && !agree) err = L('join.errConsent');
    setInfo('');
    if (err) return setError(err);
    setError('');
    setBusy(true);
    try {
      const session = isJoin
        ? await apiPost<Session>('/auth/customer/join', { phone, pin, language: lang, consent: true, shopCode })
        : await apiPost<Session>('/auth/customer/signin', { phone, pin, shopCode });
      saveSession('customer', session);
      setPin('');
      setPin2('');
      setJoined({ session, isJoin });
      setView('welcome');
    } catch (e) {
      if (e instanceof ApiFailure && e.code === 'locked') {
        setLockUntil(Date.parse(String(e.body.lockedUntil)));
        setNow(Date.now());
        setError('');
      } else {
        setError(failText(e));
        if (e instanceof ApiFailure && e.code === 'already_member') setMode('signin');
      }
    } finally {
      setBusy(false);
    }
  };

  const startReset = () => {
    setView('reset');
    setRs('phone');
    setError('');
    setInfo('');
  };

  const resetSubmit = async () => {
    if (busy) return;
    setError('');
    setInfo('');
    if (rs === 'done') {
      setView('form');
      setMode('signin');
      setRs('phone');
      setOtp('');
      setNpin('');
      setNpin2('');
      setInfo(L('join.infoChanged'));
      return;
    }
    if (rs === 'phone' && !/^[79]\d{8}$/.test(phone)) return setError(L('join.errPhone'));
    if (rs === 'otp' && !/^\d{6}$/.test(otp)) return setError(L('join.rErrOtp'));
    if (rs === 'pin') {
      if (!/^\d{6}$/.test(npin)) return setError(L('join.rErrPin'));
      if (npin2 !== npin) return setError(L('join.errMismatch'));
    }
    setBusy(true);
    try {
      if (rs === 'phone') {
        setTicket((await apiPost<{ ticket: string }>('/auth/customer/reset', { phone })).ticket);
        setRs('otp');
      } else if (rs === 'otp') {
        setTicket((await apiPost<{ ticket: string }>('/auth/customer/reset/verify', { ticket, code: otp })).ticket);
        setRs('pin');
      } else {
        await apiPost('/auth/customer/reset/pin', { ticket, pin: npin });
        setLockUntil(0);
        setRs('done');
      }
    } catch (e) {
      setError(failText(e));
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    try {
      setTicket((await apiPost<{ ticket: string }>('/auth/customer/reset', { phone })).ticket);
      setOtp('');
      setError('');
      setInfo(L('join.infoResent'));
    } catch (e) {
      setError(failText(e));
    }
  };

  const onEnter = (fn: () => void) => (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') fn();
  };

  if (shopMissing) {
    return (
      <main className={s.screen}>
        <div className={s.page}>
          <div className={s.card} role="alert">{L('join.noShop')}</div>
        </div>
      </main>
    );
  }

  // ---------------------------------------------------------------- welcome
  if (view === 'welcome' && joined) {
    const reward = shop?.rewards[0];
    const needed = shop?.stampsNeeded ?? 0;
    return (
      <main className={s.screen}>
        <div className={`${s.pageWelcome} tc-fade`}>
          <div className={`${s.bigTick} tc-pop`}>
            <Icon d={TICK} size={36} color="#fff" width={2.4} />
          </div>
          <h1 className={s.welcomeTitle}>{L(joined.isJoin ? 'join.wTitleJoin' : 'join.wTitleBack')}</h1>
          {/* The welcome stamp comes with Phase 2, so the join message is the "added" one for now. */}
          <p className={s.welcomeSub}>{shopName ? L('join.wSubBack', { shop: shopName }) : ''}</p>
          {shop && (
            <div className={s.welcomeCard}>
              <div className={s.welcomeRow}>
                <Logo name={shop.name} className={s.logoTiny} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className={s.welcomeBrand}>{shop.name}</div>
                  {reward && <div className={s.welcomeReward}>{L('join.rewardLine', { reward: reward.reward, n: reward.at })}</div>}
                </div>
                {needed > 0 && <div style={{ fontSize: 20, fontWeight: 700, color: '#444' }}>0/{needed}</div>}
              </div>
              {needed > 0 && (
                <ul className={s.miniStamps}>
                  {Array.from({ length: needed }, (_, i) => (
                    <li key={i} className={s.miniStamp} aria-label={L('join.stampAria', { n: i + 1 })} />
                  ))}
                </ul>
              )}
            </div>
          )}
          <button type="button" className={s.welcomeCta} onClick={() => onSignedIn(joined.session)}>
            {L('join.goDash')}
          </button>
        </div>
      </main>
    );
  }

  // ---------------------------------------------------------------- reset PIN
  if (view === 'reset') {
    const stepIndex = Math.min(['phone', 'otp', 'pin', 'done'].indexOf(rs), 2);
    const otpSub = L('join.rSubOtp', { a: phone.slice(0, 3), b: phone.slice(-3) });
    return (
      <main className={s.screen}>
        <div className={`${s.pageReset} tc-fade`}>
          <button type="button" className={s.back} onClick={() => { setView('form'); setMode('signin'); setError(''); }}>
            <Icon d="M15 5l-7 7 7 7" color="#444" width={2} />
            <span>{L('join.backSignin')}</span>
          </button>
          <div className={s.resetHead}>
            {shopName ? <Logo name={shopName} className={s.logoSmall} /> : null}
            <h1 className={s.resetTitle}>{L(`join.rTitle.${rs}` as MessageKey)}</h1>
            <p className={s.lead}>{rs === 'otp' ? otpSub : L(`join.rSub.${rs}` as MessageKey)}</p>
          </div>
          <ol className={s.dots}>
            {[0, 1, 2].map((i) => (
              <li key={i} className={s.dot} data-on={i <= stepIndex} aria-label={L('join.stepAria', { n: i + 1 })} />
            ))}
          </ol>
          <div className={s.resetCard}>
            {rs === 'phone' && (
              <>
                <label htmlFor="rphone" className={s.label}>{L('join.phoneLbl')}</label>
                <div className={s.field}>
                  <span className={s.prefix}>+251</span>
                  <input id="rphone" className={s.input} value={phone} onChange={(e) => setPhone(digits(e.target.value, 9))} onKeyDown={onEnter(resetSubmit)}
                    type="text" inputMode="numeric" maxLength={9} autoComplete="tel-national" placeholder="9XX XXX XXX" />
                </div>
              </>
            )}
            {rs === 'otp' && (
              <>
                <label htmlFor="otp" className={s.label}>{L('join.otpLbl')}</label>
                <div className={s.field}>
                  <input id="otp" className={s.code} value={otp} onChange={(e) => setOtp(digits(e.target.value, 6))} onKeyDown={onEnter(resetSubmit)}
                    type="text" inputMode="numeric" maxLength={6} autoComplete="one-time-code" placeholder="••••••" />
                </div>
                <div className={s.resendRow}>
                  <span>{L('join.noCode')}</span>
                  <button type="button" className={s.resend} onClick={resend}>{L('join.resend')}</button>
                </div>
              </>
            )}
            {rs === 'pin' && (
              <>
                <label htmlFor="npin" className={s.label}>{L('join.newPin')}</label>
                <div className={s.field}>
                  <input id="npin" className={s.pin} value={npin} onChange={(e) => setNpin(digits(e.target.value, 6))} onKeyDown={onEnter(resetSubmit)}
                    type="password" inputMode="numeric" maxLength={6} autoComplete="new-password" placeholder="••••••" />
                </div>
                <label htmlFor="npin2" className={s.label} style={{ marginTop: 14 }}>{L('join.confirmNew')}</label>
                <div className={s.field}>
                  <input id="npin2" className={s.pin} value={npin2} onChange={(e) => setNpin2(digits(e.target.value, 6))} onKeyDown={onEnter(resetSubmit)}
                    type="password" inputMode="numeric" maxLength={6} autoComplete="new-password" placeholder="••••••" />
                </div>
              </>
            )}
            {rs === 'done' && (
              <div>
                <div className={`${s.doneTick} tc-pop`}><Icon d={TICK} size={26} color="#fff" width={2.4} /></div>
                <p className={s.doneMsg}>{L('join.doneMsg')}</p>
              </div>
            )}
            <p role="alert" className={s.alert}>{error}</p>
            <p role="status" className={s.status}>{info}</p>
            <button type="button" className={s.cta} aria-busy={busy} onClick={resetSubmit}>{L(`join.rCta.${rs}` as MessageKey)}</button>
          </div>
        </div>
      </main>
    );
  }

  // ---------------------------------------------------------------- join / sign in
  return (
    <main className={s.screen}>
      <div className={`${s.page} tc-fade`}>
        <div className={s.hero}>
          {shop ? (
            <>
              <Logo name={shop.name} className={s.logo} />
              <h1 className={s.brand}>{shop.name}</h1>
            </>
          ) : (
            <h1 className={s.brand}>{L('common.appName')}</h1>
          )}
        </div>

        {shop && shop.rewards.length > 0 && !locked && (
          <section className={s.benefits}>
            <h2 className={s.benefitsTitle}>{L('join.whatYouGet')}</h2>
            <ul className={s.benefitList}>
              {shop.rewards.map((r) => (
                <li key={`${r.at}-${r.reward}`} className={s.benefit}>
                  <span className={s.benefitIcon}><Icon d={CUP} /></span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span className={s.benefitTitle}>{r.reward}</span>
                    <span className={s.benefitText}>{L('join.benefitAt', { n: r.at })}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {locked ? (
          <section className={`${s.lock} tc-fade`}>
            <div className={s.lockIcon}><Icon d="M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3" size={26} /></div>
            <h2 className={s.lockTitle}>{L('join.lockTitle')}</h2>
            <p role="status" className={s.lockText}>{L('join.lockText', { time: lockClock })}</p>
            <button type="button" className={s.cta} onClick={startReset}>{L('join.lockReset')}</button>
          </section>
        ) : (
          <section className={s.card}>
            {shopCode ? (
              <div role="group" aria-label={L('join.tabsAria')} className={s.tabs}>
                <button type="button" className={s.tab} aria-pressed={mode === 'join'} onClick={() => { setMode('join'); setError(''); setInfo(''); }}>{L('join.join')}</button>
                <button type="button" className={s.tab} aria-pressed={mode === 'signin'} onClick={() => { setMode('signin'); setError(''); setInfo(''); }}>{L('join.signin')}</button>
              </div>
            ) : (
              <h2 className={s.formTitle}>{L('join.signin')}</h2>
            )}

            <div className={s.group}>
              <label htmlFor="phone" className={s.label}>{L('join.phoneLbl')}</label>
              <div className={s.field}>
                <span className={s.prefix}>+251</span>
                <input id="phone" className={s.input} value={phone} onChange={(e) => setPhone(digits(e.target.value, 9))} onKeyDown={onEnter(submit)}
                  type="text" inputMode="numeric" maxLength={9} autoComplete="tel-national" placeholder="9XX XXX XXX" />
              </div>
            </div>
            <div className={s.group}>
              <label htmlFor="pin" className={s.label}>{L('join.pinLbl')}</label>
              <div className={s.field}>
                <input id="pin" className={s.pin} value={pin} onChange={(e) => setPin(digits(e.target.value, 6))} onKeyDown={onEnter(submit)}
                  type="password" inputMode="numeric" maxLength={6} autoComplete={isJoin ? 'new-password' : 'current-password'} placeholder="••••••" />
              </div>
            </div>
            {isJoin && (
              <div className={s.group}>
                <label htmlFor="pin2" className={s.label}>{L('join.confirmLbl')}</label>
                <div className={s.field}>
                  <input id="pin2" className={s.pin} value={pin2} onChange={(e) => setPin2(digits(e.target.value, 6))} onKeyDown={onEnter(submit)}
                    type="password" inputMode="numeric" maxLength={6} autoComplete="new-password" placeholder="••••••" />
                </div>
              </div>
            )}

            {isJoin && (
              <>
                <button type="button" role="checkbox" aria-checked={agree} className={s.check} onClick={() => setAgree(!agree)}>
                  <span className={s.box} aria-hidden="true">{agree && <Icon d={TICK} size={14} color="#fff" width={3} />}</span>
                  <span>{L('join.consentLbl')}</span>
                </button>
                <button type="button" className={s.storeLink} aria-expanded={showStore} onClick={() => setShowStore(!showStore)}>{L('join.storeBtn')}</button>
                {showStore && (
                  <ul className={`${s.store} tc-fade`}>
                    <li><span aria-hidden="true">·</span><span>{L('join.ws1')}</span></li>
                    <li><span aria-hidden="true">·</span><span>{L('join.ws2', { shop: shopName })}</span></li>
                    <li><span aria-hidden="true">·</span><span>{L('join.ws3')}</span></li>
                  </ul>
                )}
              </>
            )}

            <p role="alert" className={s.alert}>{error}</p>
            <p role="status" className={s.status}>{info}</p>
            <button type="button" className={s.cta} aria-busy={busy} onClick={submit}>{L(isJoin ? 'join.ctaJoin' : 'join.signin')}</button>

            {isJoin ? (
              <p className={s.help}>{L('join.joinHelp')}</p>
            ) : (
              <button type="button" className={s.forgot} onClick={startReset}>{L('join.forgot')}</button>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
