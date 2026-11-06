'use client';

import { useEffect, useState } from 'react';
import { isLang, t, type Lang, type MessageKey } from '@temelash/i18n';
import { ApiFailure, apiPost, authed, loadSession, saveSession, type Session } from '@temelash/ui';
import { Scanner } from './scanner';
import s from './staff.module.css';

/**
 * The shared /staff page: StaffSignIn (accounts come from the owner, no
 * sign-up, no business name on the page), StaffSetPin (first PIN or expired),
 * StaffPickShop (account works at more than one place). The scanner itself is
 * Phase 2; once signed in this shows who and where.
 */

type View = 'signin' | 'setpin' | 'pick' | 'in';
interface PickShop { choice: string; businessName: string; branchName: string }
interface Me { name: string; businessName: string; branchName: string }
type SignInResult =
  | (Session & { next?: undefined })
  | { next: 'set_pin'; reason: 'first' | 'expired'; changeTicket: string }
  | { next: 'pick_shop'; ticket: string; shops: PickShop[] };

const LANGS: Array<[Lang, string]> = [['en', 'English'], ['am', 'አማርኛ'], ['om', 'Afaan Oromoo']];
const digits = (v: string, max: number) => v.replace(/\D/g, '').slice(0, max);
const initials = (name: string) => name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();

export function StaffAuth() {
  const [lang, setLang] = useState<Lang>('en');
  const L = (k: MessageKey, vars?: Record<string, string | number>) => t(lang, k, vars);
  const [view, setView] = useState<View>('signin');
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [np1, setNp1] = useState('');
  const [np2, setNp2] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [locked, setLocked] = useState(false);
  const [expired, setExpired] = useState(false);
  const [ticket, setTicket] = useState('');
  const [shops, setShops] = useState<PickShop[]>([]);
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    const m = document.cookie.match(/(?:^|; )tc_lang=(\w+)/);
    if (m && isLang(m[1])) setLang(m[1]);
    if (loadSession('staff')) {
      // A real 401 clears the session inside authed(). A network or server blip must not sign anyone out.
      authed<Me>('staff', 'GET', '/staff/me').then((r) => { setMe(r); setView('in'); }).catch(() => {});
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const pickLang = (l: Lang) => {
    setLang(l);
    setError('');
    document.cookie = `tc_lang=${l}; path=/; max-age=31536000; samesite=lax`;
  };

  const failText = (e: unknown): string => {
    if (!(e instanceof ApiFailure) || e.code === 'offline') return L('common.offline');
    switch (e.code) {
      case 'bad_phone': return L('join.errPhone');
      case 'bad_pin': return L('staff.spErrLen');
      case 'weak_pin': return L('staff.spErrWeak');
      case 'same_pin': return L('staff.spErrSame');
      case 'locked': return L('staff.siLocked');
      case 'too_many_requests': case 'too_many_codes': return L('common.tooMany');
      case 'wrong_pin': {
        const left = e.body.triesLeft;
        return left === 1 ? L('staff.siWrong1') : L('staff.siWrong', { n: typeof left === 'number' ? left : 0 });
      }
      default: return L('common.offline');
    }
  };

  const finish = async (session: Session) => {
    saveSession('staff', session);
    setPin('');
    setNp1('');
    setNp2('');
    setMe(await authed<Me>('staff', 'GET', '/staff/me'));
    setView('in');
  };

  const handle = async (r: SignInResult) => {
    if (r.next === 'set_pin') {
      setTicket(r.changeTicket);
      setExpired(r.reason === 'expired');
      setView('setpin');
    } else if (r.next === 'pick_shop') {
      setTicket(r.ticket);
      setShops(r.shops);
      setView('pick');
    } else {
      await finish(r);
    }
  };

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      if (e instanceof ApiFailure && e.code === 'locked') setLocked(true);
      setError(failText(e));
    } finally {
      setBusy(false);
    }
  };

  const signIn = () => {
    if (locked) return;
    if (!/^[79]\d{8}$/.test(phone)) return setError(L('join.errPhone'));
    if (!/^\d{6}$/.test(pin)) return setError(L('staff.spErrLen'));
    setError('');
    run(async () => handle(await apiPost<SignInResult>('/auth/staff/signin', { phone, pin })));
  };

  const savePin = () => {
    if (!/^\d{6}$/.test(np1)) return setError(L('staff.spErrLen'));
    if (np1 !== np2) return setError(L('staff.spErrMatch'));
    setError('');
    run(async () => finish(await apiPost<Session>('/auth/staff/set-pin', { ticket, pin: np1 })));
  };

  const pick = (choice: string) => {
    setError('');
    run(async () => handle(await apiPost<SignInResult>('/auth/staff/pick', { ticket, choice })));
  };

  const signOut = async () => {
    const sess = loadSession('staff');
    if (sess) await apiPost('/auth/signout', {}, sess.accessToken).catch(() => {});
    saveSession('staff', null);
    setMe(null);
    setLocked(false);
    setView('signin');
  };

  const onEnter = (fn: () => void) => (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') fn();
  };

  if (view === 'in' && me) return <Scanner lang={lang} me={me} onSignOut={signOut} />;

  if (view === 'pick') {
    return (
      <main className={s.screen}>
        <div className={`${s.inner} tc-fade`}>
          <h1 className={s.titleTop}>{L('staff.shopTitle')}</h1>
          <p className={s.help}>{L('staff.shopHelp')}</p>
          <ul className={s.shops}>
            {shops.map((sh) => (
              <li key={sh.choice}>
                <button type="button" className={s.shop} aria-pressed={false} onClick={() => pick(sh.choice)}>
                  <span className={s.shopLogo} aria-hidden="true">{initials(sh.businessName)}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span className={s.shopBrand}>{sh.businessName}</span>
                    <span className={s.shopBranch}>{sh.branchName}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <p role="alert" className={s.alert}>{error}</p>
        </div>
      </main>
    );
  }

  if (view === 'setpin') {
    return (
      <main className={s.screen}>
        <div className={`${s.inner} tc-fade`}>
          <div className={s.badge}>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" />
            </svg>
          </div>
          <h1 className={s.title}>{L(expired ? 'staff.spTitleExp' : 'staff.spTitle')}</h1>
          <p className={s.help}>{L(expired ? 'staff.spHelpExp' : 'staff.spHelp')}</p>
          <label htmlFor="sp1" className={s.label}>{L('staff.spNew')}</label>
          <div className={s.field}>
            <input id="sp1" className={s.pin} type="password" inputMode="numeric" maxLength={6} autoComplete="new-password" placeholder="••••••"
              value={np1} onChange={(e) => setNp1(digits(e.target.value, 6))} onKeyDown={onEnter(savePin)} />
          </div>
          <label htmlFor="sp2" className={s.labelNext}>{L('staff.spConfirm')}</label>
          <div className={s.field}>
            <input id="sp2" className={s.pin} type="password" inputMode="numeric" maxLength={6} autoComplete="new-password" placeholder="••••••"
              value={np2} onChange={(e) => setNp2(digits(e.target.value, 6))} onKeyDown={onEnter(savePin)} />
          </div>
          <p role="alert" className={s.alert}>{error}</p>
          <button type="button" className={s.cta} aria-busy={busy} onClick={savePin} style={{ letterSpacing: 0.6 }}>{L('staff.spBtn')}</button>
        </div>
      </main>
    );
  }

  return (
    <main className={s.screen}>
      <div className={`${s.inner} tc-fade`}>
        <div className={s.badge}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="5" width="18" height="14" rx="3" /><path d="M8.5 12.2l2.5 2.5 4.5-4.7" />
          </svg>
        </div>
        <h1 className={s.title}>{L('staff.siTitle')}</h1>
        <p className={s.help}>{L('staff.siHelp')}</p>
        <label htmlFor="siph" className={s.label}>{L('staff.siPhone')}</label>
        <div className={s.field}>
          <span className={s.prefix}>+251</span>
          <input id="siph" className={s.input} type="text" inputMode="numeric" maxLength={9} autoComplete="tel-national" placeholder="9XX XXX XXX"
            value={phone} onChange={(e) => setPhone(digits(e.target.value, 9))} onKeyDown={onEnter(signIn)} />
        </div>
        <label htmlFor="sipin" className={s.labelNext}>{L('staff.siPin')}</label>
        <div className={s.field}>
          <input id="sipin" className={s.pin} type="password" inputMode="numeric" maxLength={6} autoComplete="current-password" placeholder="••••••"
            value={pin} onChange={(e) => setPin(digits(e.target.value, 6))} onKeyDown={onEnter(signIn)} />
        </div>
        <p role="alert" className={s.alert}>{error}</p>
        <button type="button" className={s.cta} aria-disabled={locked} aria-busy={busy} onClick={signIn}>{L('staff.siBtn')}</button>
        <p className={s.note}>{L('staff.siForgot')}</p>
        <div className={s.chips}>
          {LANGS.map(([code, name]) => (
            <button key={code} type="button" className={s.chip} aria-pressed={lang === code} onClick={() => pickLang(code)}>{name}</button>
          ))}
        </div>
      </div>
    </main>
  );
}
