'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { isLang, t, type Lang, type MessageKey } from '@temelash/i18n';
import { ApiFailure, apiPost, authed, loadSession, saveSession, type Session } from '@temelash/ui';
import { OwnerApp } from './owner-app';
import s from './owner.module.css';

/**
 * Business sign-in for owners and branch managers, ported from the Owner board:
 * OwnSignIn (phone + PIN), OwnOtp (SMS code), OwnForgot (code and new PIN on
 * one page), OwnSignUp (form, code, PIN), OwnMgrFirstPin and the expired-PIN
 * page. The Today board and the rest of the owner app are Phase 3.
 */

type View = 'signin' | 'otp' | 'forgot' | 'signup' | 'signupotp' | 'signuppin' | 'setpin' | 'in';
type SetPinKind = 'expired' | 'first' | 'mgrFirst';
interface Me { actorType: string; businessId: string | null }
type VerifyResult =
  | (Session & { next?: undefined })
  | { next: 'set_pin'; reason: 'first' | 'expired'; role: string; name: string; branchName: string | null; changeTicket: string };

const LANGS: Array<[Lang, string]> = [['en', 'English'], ['am', 'አማርኛ'], ['om', 'Afaan Oromoo']];
const CATS: Array<[string, MessageKey]> = [['food', 'owner.catFood'], ['salon', 'owner.catSalon'], ['spa', 'owner.catSpa'], ['car', 'owner.catCar']];
const ICON = {
  building: 'M4 21V9l8-5 8 5v12M9 21v-6h6v6',
  sms: 'M5 4h14v16H5zM9 9h6M9 13h6M9 17h3',
  lock: 'M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3',
  plus: 'M12 5v14M5 12h14',
  tick: 'M5 12.5l4.5 4.5L19 7.5',
};
const pinOk = (p: string) => /^\d{6}$/.test(p);
const digits = (v: string, max: number) => v.replace(/\D/g, '').slice(0, max);
/** The owner app's phone box takes "+251 9X XXX XXXX" as typed; the API normalises it. */
const phoneDigits = (v: string) => v.replace(/[^\d+ ]/g, '').slice(0, 16);

function Svg({ d, size = 28, color = '#444', width = 1.9 }: { d: string; size?: number; color?: string; width?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: 'none' }}>
      <path d={d} />
    </svg>
  );
}

/** Language chips, round icon, title and help shared by every signed-out page. */
function Frame({ lang, onLang, icon, title, help, children }: { lang: Lang; onLang: (l: Lang) => void; icon: string; title: string; help: string; children: ReactNode }) {
  return (
    <main className={s.screen}>
      <div className="tc-fade">
        <div className={s.chips}>
          {LANGS.map(([code, name]) => (
            <button key={code} type="button" className={s.chip} aria-pressed={lang === code} onClick={() => onLang(code)}>{name}</button>
          ))}
        </div>
        <div className={s.icon}><Svg d={icon} /></div>
        <h1 className={s.title}>{title}</h1>
        {help && <p className={s.help}>{help}</p>}
        {children}
      </div>
    </main>
  );
}

export function OwnerAuth() {
  const [lang, setLang] = useState<Lang>('en');
  const L = (k: MessageKey, vars?: Record<string, string | number>) => t(lang, k, vars);
  const [view, setView] = useState<View>('signin');
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [otp, setOtp] = useState('');
  const [np1, setNp1] = useState('');
  const [np2, setNp2] = useState('');
  const [bname, setBname] = useState('');
  const [oname, setOname] = useState('');
  const [agphone, setAgphone] = useState('');
  const [cat, setCat] = useState('');
  const [agree, setAgree] = useState(false);
  const [suErr, setSuErr] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);
  const [locked, setLocked] = useState(false);
  const [ticket, setTicket] = useState('');
  const [masked, setMasked] = useState('');
  const [fgStage, setFgStage] = useState(0);
  const [pinKind, setPinKind] = useState<SetPinKind>('first');
  const [mgr, setMgr] = useState<{ name: string; branch: string }>({ name: '', branch: '' });
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    const m = document.cookie.match(/(?:^|; )tc_lang=(\w+)/);
    if (m && isLang(m[1])) setLang(m[1]);
    if (loadSession('owner')) {
      authed<Me>('owner', 'GET', '/me').then((r) => { setMe(r); setView('in'); }).catch(() => saveSession('owner', null));
    }
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const go = (v: View) => {
    setView(v);
    setError('');
    setToast('');
    setSuErr([]);
    setOtp('');
  };
  const pickLang = (l: Lang) => {
    setLang(l);
    document.cookie = `tc_lang=${l}; path=/; max-age=31536000; samesite=lax`;
  };

  const pinErrText = (code: string) =>
    code === 'weak_pin' ? L('owner.spErrWeak') : code === 'same_pin' ? L('owner.spErrSame') : L('owner.spErrLen');

  const failText = (e: unknown): string => {
    if (!(e instanceof ApiFailure) || e.code === 'offline') return L('common.offline');
    switch (e.code) {
      case 'missing': case 'bad_phone': return L('owner.siMissing');
      case 'wrong_pin': {
        const left = e.body.triesLeft;
        return left === 1 ? L('owner.siWrong1') : L('owner.siWrong', { n: typeof left === 'number' ? left : 0 });
      }
      case 'locked': return L('owner.siLocked');
      case 'bad_code': return L('owner.otpWrong');
      case 'bad_pin': case 'weak_pin': case 'same_pin': return pinErrText(e.code);
      case 'phone_in_use': return L('join.errAlreadyMember');
      case 'too_many_requests': case 'too_many_codes': return L('common.tooMany');
      case 'bad_ticket': return L('owner.otpWrong');
      default: return L('common.offline');
    }
  };

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      if (e instanceof ApiFailure && e.code === 'locked') setLocked(true);
      if (e instanceof ApiFailure && e.code === 'invalid') setSuErr((e.body.fields as string[]) ?? []);
      else setError(failText(e));
    } finally {
      setBusy(false);
    }
  };

  const finish = async (session: Session) => {
    saveSession('owner', session);
    setPin('');
    setNp1('');
    setNp2('');
    setMe(await authed<Me>('owner', 'GET', '/me'));
    go('in');
  };

  // ------------------------------------------------------------- actions
  const doSignin = () => {
    if (locked) return;
    if (phone.replace(/\D/g, '').length < 9 || !pinOk(pin)) return setError(L('owner.siMissing'));
    run(async () => {
      const r = await apiPost<{ ticket: string; maskedPhone: string }>('/auth/business/signin', { phone, pin });
      setTicket(r.ticket);
      setMasked(r.maskedPhone);
      go('otp');
    });
  };

  const doOtp = () => {
    if (!pinOk(otp)) return setError(L('owner.otpWrong'));
    run(async () => {
      const r = await apiPost<VerifyResult>('/auth/business/signin/verify', { ticket, code: otp });
      if (r.next === 'set_pin') {
        setTicket(r.changeTicket);
        setPinKind(r.reason === 'expired' ? 'expired' : r.role === 'manager' ? 'mgrFirst' : 'first');
        setMgr({ name: r.name, branch: r.branchName ?? '' });
        go('setpin');
      } else {
        await finish(r);
      }
    });
  };

  const resendOtp = () =>
    run(async () => {
      const r = await apiPost<{ ticket: string; maskedPhone: string }>('/auth/business/signin', { phone, pin });
      setTicket(r.ticket);
      setOtp('');
      setToast(L('owner.otpSent'));
    });

  const checkNewPin = (): string => {
    if (!pinOk(np1)) return L('owner.spErrLen');
    if (np1 !== np2) return L('owner.spErrMatch');
    return '';
  };

  const doSetPin = () => {
    const e = checkNewPin();
    if (e) return setError(e);
    run(async () => finish(await apiPost<Session>('/auth/business/set-pin', { ticket, pin: np1 })));
  };

  const fgSend = () => {
    if (phone.replace(/\D/g, '').length < 9) return setError(L('owner.siMissing'));
    run(async () => {
      const r = await apiPost<{ ticket: string; maskedPhone: string }>('/auth/business/forgot', { phone });
      setTicket(r.ticket);
      setMasked(r.maskedPhone);
      setFgStage(1);
      setToast(L('owner.otpSent'));
    });
  };

  const fgSave = () => {
    if (!pinOk(otp)) return setError(L('owner.otpWrong'));
    const e = checkNewPin();
    if (e) return setError(e);
    run(async () => {
      await apiPost('/auth/business/forgot/finish', { ticket, code: otp, pin: np1 });
      setLocked(false);
      setPin('');
      setNp1('');
      setNp2('');
      setFgStage(0);
      go('signin');
      setToast(L('owner.pinSaved'));
    });
  };

  const doSignup = () =>
    run(async () => {
      setSuErr([]);
      const r = await apiPost<{ ticket: string; maskedPhone: string }>('/auth/business/signup', {
        businessName: bname, ownerName: oname, phone, agentPhone: agphone, category: cat, agree,
      });
      setTicket(r.ticket);
      setMasked(r.maskedPhone);
      go('signupotp');
    });

  const doSignupOtp = () => {
    if (!pinOk(otp)) return setError(L('owner.otpWrong'));
    run(async () => {
      setTicket((await apiPost<{ ticket: string }>('/auth/business/signup/verify', { ticket, code: otp })).ticket);
      setPinKind('first');
      go('signuppin');
    });
  };

  const doSignupPin = () => {
    const e = checkNewPin();
    if (e) return setError(e);
    run(async () => finish(await apiPost<Session>('/auth/business/signup/pin', { ticket, pin: np1 })));
  };

  const signOut = async () => {
    const sess = loadSession('owner');
    if (sess) await apiPost('/auth/signout', {}, sess.accessToken).catch(() => {});
    saveSession('owner', null);
    setMe(null);
    go('signin');
  };

  const onEnter = (fn: () => void) => (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') fn();
  };

  // ------------------------------------------------------------- pieces
  const pinFields = (
    <>
      <label htmlFor="f_np1" className={s.labelFirst}>{L('owner.newPin')}</label>
      <input id="f_np1" className={s.pin} type="password" inputMode="numeric" maxLength={6} autoComplete="new-password" placeholder="------"
        value={np1} onChange={(e) => setNp1(digits(e.target.value, 6))} />
      <label htmlFor="f_np2" className={s.label}>{L('owner.confirmPin')}</label>
      <input id="f_np2" className={s.pin} type="password" inputMode="numeric" maxLength={6} autoComplete="new-password" placeholder="------"
        value={np2} onChange={(e) => setNp2(digits(e.target.value, 6))} />
    </>
  );

  const otpField = (onEnterFn: () => void) => (
    <>
      <label htmlFor="f_otp" className={s.labelFirst}>{L('owner.otpLbl')}</label>
      <input id="f_otp" className={s.pin} type="text" inputMode="numeric" maxLength={6} autoComplete="one-time-code" placeholder="------"
        value={otp} onChange={(e) => setOtp(digits(e.target.value, 6))} onKeyDown={onEnter(onEnterFn)} />
    </>
  );

  const phoneField = (id: string, value: string, set: (v: string) => void, onEnterFn?: () => void) => (
    <input id={id} className={s.input} type="tel" inputMode="tel" maxLength={16} autoComplete="off" placeholder="+251 9X XXX XXXX"
      value={value} onChange={(e) => set(phoneDigits(e.target.value))} onKeyDown={onEnterFn ? onEnter(onEnterFn) : undefined} />
  );

  // ------------------------------------------------------------- views
  if (view === 'in' && me) return <OwnerApp lang={lang} me={me} onSignOut={signOut} onLang={pickLang} />;

  if (view === 'otp' || view === 'signupotp') {
    const isSignup = view === 'signupotp';
    return (
      <Frame lang={lang} onLang={pickLang} icon={ICON.sms} title={L('owner.otpTitle')} help={L('owner.otpHelp', { p: masked })}>
        {otpField(isSignup ? doSignupOtp : doOtp)}
        <p role="alert" className={s.fieldAlert}>{error}</p>
        <p role="status" className={s.status}>{toast}</p>
        <button type="button" className={s.ctaSpaced} aria-busy={busy} onClick={isSignup ? doSignupOtp : doOtp}>{L('owner.otpBtn')}</button>
        {!isSignup && <button type="button" className={s.ghost} onClick={resendOtp}>{L('owner.otpResend')}</button>}
        <button type="button" className={s.ghost} style={{ marginTop: 0 }} onClick={() => go(isSignup ? 'signup' : 'signin')}>{L('owner.back')}</button>
      </Frame>
    );
  }

  if (view === 'setpin' || view === 'signuppin') {
    const title = pinKind === 'mgrFirst' ? L('owner.mfTitle', { name: mgr.name }) : pinKind === 'expired' ? L('owner.spExpTitle') : L('owner.spTitle');
    const help = pinKind === 'mgrFirst' ? L('owner.mfHelp', { branch: mgr.branch }) : pinKind === 'expired' ? L('owner.spExpHelp') : L('owner.spHelp');
    const action = view === 'signuppin' ? doSignupPin : doSetPin;
    return (
      <Frame lang={lang} onLang={pickLang} icon={ICON.lock} title={title} help={help}>
        {pinFields}
        <p role="alert" className={s.fieldAlert}>{error}</p>
        <button type="button" className={s.cta} style={{ marginTop: 16 }} aria-busy={busy} onClick={action}>
          {L(pinKind === 'expired' ? 'owner.spExpBtn' : 'owner.spBtn')}
        </button>
      </Frame>
    );
  }

  if (view === 'forgot') {
    return (
      <Frame lang={lang} onLang={pickLang} icon={ICON.lock} title={L('owner.fgTitle')} help={fgStage === 0 ? L('owner.fgHelp0') : L('owner.fgHelp1', { p: masked })}>
        {fgStage === 0 ? (
          <>
            <label htmlFor="f_phone" className={s.labelFirst}>{L('owner.phoneLbl')}</label>
            {phoneField('f_phone', phone, setPhone, fgSend)}
            <p role="alert" className={s.fieldAlert}>{error}</p>
            <button type="button" className={s.ctaSpaced} aria-busy={busy} onClick={fgSend}>{L('owner.fgSend')}</button>
          </>
        ) : (
          <>
            {otpField(fgSave)}
            {pinFields}
            <p role="alert" className={s.fieldAlert}>{error}</p>
            <p role="status" className={s.status}>{toast}</p>
            <button type="button" className={s.ctaSpaced} aria-busy={busy} onClick={fgSave}>{L('owner.fgSave')}</button>
          </>
        )}
        <button type="button" className={s.ghost} onClick={() => { setFgStage(0); go('signin'); }}>{L('owner.back')}</button>
      </Frame>
    );
  }

  if (view === 'signup') {
    const has = (f: string) => suErr.includes(f);
    return (
      <Frame lang={lang} onLang={pickLang} icon={ICON.plus} title={L('owner.suTitle')} help={L('owner.suHelp')}>
        <label htmlFor="f_bname" className={s.labelFirst}>{L('owner.bizName')}</label>
        <input id="f_bname" className={s.input} type="text" maxLength={40} autoComplete="organization" value={bname} onChange={(e) => setBname(e.target.value)} />
        <p role="alert" className={s.fieldAlert}>{has('businessName') ? L('owner.suNeedBiz') : ''}</p>
        <label htmlFor="f_oname" className={s.labelTight}>{L('owner.yourName')}</label>
        <input id="f_oname" className={s.input} type="text" maxLength={40} autoComplete="name" value={oname} onChange={(e) => setOname(e.target.value)} />
        <p role="alert" className={s.fieldAlert}>{has('ownerName') ? L('owner.suNeedName') : ''}</p>
        <label htmlFor="f_phone" className={s.labelTight}>{L('owner.phoneLbl')}</label>
        {phoneField('f_phone', phone, setPhone)}
        <p role="alert" className={s.fieldAlert}>{has('phone') ? L('owner.suNeedPhone') : ''}</p>
        <div className={s.catLbl}>{L('owner.catLbl')}</div>
        <div className={s.cats}>
          {CATS.map(([v, k]) => (
            <button key={v} type="button" className={s.catChip} aria-pressed={cat === v} onClick={() => setCat(v)}>{L(k)}</button>
          ))}
        </div>
        <label htmlFor="f_agphone" className={s.labelFirst}>{L('owner.agLbl')}</label>
        {phoneField('f_agphone', agphone, setAgphone)}
        <p role="alert" className={s.fieldAlert}>{has('agentPhone') ? L('owner.agBad') : ''}</p>
        <p className={s.noteTight}>{L('owner.agHelp')}</p>
        <button type="button" role="checkbox" aria-checked={agree} className={s.check} onClick={() => setAgree(!agree)}>
          <span className={s.box} aria-hidden="true">{agree && <Svg d={ICON.tick} size={16} color="#fff" width={3} />}</span>
          <span>{L('owner.agreeText')}</span>
        </button>
        <p role="alert" className={s.alert} style={{ marginTop: 4 }}>{has('agree') ? L('owner.suNeedAgree') : error}</p>
        <button type="button" className={s.cta} style={{ marginTop: 6 }} aria-busy={busy} onClick={doSignup}>{L('owner.suBtn')}</button>
        <button type="button" className={s.ghost} onClick={() => go('signin')}>{L('owner.suHave')}</button>
      </Frame>
    );
  }

  return (
    <Frame lang={lang} onLang={pickLang} icon={ICON.building} title={L('owner.siTitle')} help={L('owner.siHelp')}>
      <label htmlFor="f_phone" className={s.label}>{L('owner.phoneLbl')}</label>
      {phoneField('f_phone', phone, setPhone, doSignin)}
      <label htmlFor="f_pin" className={s.label}>{L('owner.pinLbl')}</label>
      <input id="f_pin" className={s.pin} type="password" inputMode="numeric" maxLength={6} autoComplete="current-password" placeholder="------"
        value={pin} onChange={(e) => setPin(digits(e.target.value, 6))} onKeyDown={onEnter(doSignin)} />
      <p role="alert" className={s.alert}>{error}</p>
      <p role="status" className={s.status}>{toast}</p>
      <button type="button" className={s.cta} aria-busy={busy} aria-disabled={locked} onClick={doSignin}>{L('owner.siBtn')}</button>
      <button type="button" className={s.ghost} onClick={() => go('forgot')}>{L('owner.siForgot')}</button>
      <div className={s.divider} />
      <p className={s.lead}>{L('owner.siNew')}</p>
      <button type="button" className={s.outline} onClick={() => go('signup')}>{L('owner.siCreate')}</button>
      <p className={s.note}>{L('owner.siStaffNote')}</p>
      <p className={s.noteTight}>{L('owner.siMgrNote')}</p>
    </Frame>
  );
}
