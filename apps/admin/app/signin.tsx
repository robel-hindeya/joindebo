'use client';

import { useEffect, useState } from 'react';
import qrcode from 'qrcode-generator';
import { ApiFailure, apiGet, apiPost, saveSession, type Session } from '@temelash/ui';
import { A, CheckMark } from './ui';
import s from './admin.module.css';

/**
 * AdminLogin*: email and password, then the authenticator (set up on first
 * sign-in, with 10 backup codes shown once) or a backup code. Locked and
 * idle sign-out screens, and account recovery (AdminLoginRecover*, Phase 8).
 */

export type Step = 'pw' | 'otp' | 'backup' | 'setup1' | 'setup2' | 'locked' | 'idle' | 'recover' | 'recoversent' | 'wait';

interface Rules { tries: number; lockMinutes: number; idleMinutes: number }

export function Qr({ text }: { text: string }) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
  return (
    <svg width={150} height={150} viewBox={`-1 -1 ${n + 2} ${n + 2}`} role="img" aria-label={A('qrAria')} shapeRendering="crispEdges" style={{ display: 'block' }}>
      <rect x={-1} y={-1} width={n + 2} height={n + 2} fill="#fff" />
      <path d={d} fill="#333" />
    </svg>
  );
}

export function SignIn({ start, onIn }: { start: Step; onIn: (how: 'code' | 'backup' | 'setup') => void }) {
  const [step, setStep] = useState<Step>(start);
  const [f, setF] = useState<Record<string, string>>({});
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [ticket, setTicket] = useState('');
  const [secret, setSecret] = useState<{ secret: string; otpauth: string } | null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [rules, setRules] = useState<Rules>({ tries: 5, lockMinutes: 15, idleMinutes: 30 });
  const [copied, setCopied] = useState(false);
  const [readyAt, setReadyAt] = useState('');
  useEffect(() => { apiGet<Rules>('/admin/auth/rules').then(setRules).catch(() => {}); }, []);

  const v = (k: string) => f[k] ?? '';
  const field = (label: string, key: string, ph: string, type = 'text', hint?: string) => (
    <div className={s.field} key={key}>
      <label className={s.fieldLbl} htmlFor={`f_${key}`}>{label}</label>
      <input id={`f_${key}`} type={type} className={s.fieldInput} value={v(key)} placeholder={ph} autoComplete="off" onChange={(e) => setF((x) => ({ ...x, [key]: e.target.value }))} />
      {hint && <div className={s.fieldHint}>{hint}</div>}
    </div>
  );
  const go = (next: Step) => { setStep(next); setErr(''); setF({}); };
  const digits = (k: string) => v(k).replace(/\D/g, '');

  /** A refused try: say so with the tries left, or show the lock. */
  const refused = (e: unknown, wrongText: string) => {
    if (e instanceof ApiFailure && e.status === 423) return go('locked');
    if (e instanceof ApiFailure && e.code === 'bad_ticket') return go('pw');
    const left = e instanceof ApiFailure ? Number((e.body as { triesLeft?: number }).triesLeft) : NaN;
    setErr(Number.isFinite(left) ? `${wrongText} ${A('triesLeft', { a: left }, left)}` : wrongText);
    setF({});
  };
  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  };

  const login = () => run(async () => {
    try {
      const r = await apiPost<{ next: 'setup' | 'code' | 'wait'; ticket: string; readyAt?: string }>('/admin/auth/login', { email: v('em'), password: v('pw') });
      if (r.next === 'wait') { setReadyAt(r.readyAt ?? ''); go('wait'); return; }
      setTicket(r.ticket);
      if (r.next === 'setup') {
        setSecret(await apiPost<{ secret: string; otpauth: string }>('/admin/auth/setup/start', { ticket: r.ticket }));
        go('setup1');
      } else go('otp');
    } catch (e) { refused(e, A('wrong')); }
  });
  const finishSetup = () => run(async () => {
    try {
      const r = await apiPost<Session & { backupCodes: string[] }>('/admin/auth/setup/finish', { ticket, code: digits('cd') });
      setSession({ accessToken: r.accessToken, refreshToken: r.refreshToken });
      setCodes(r.backupCodes);
      go('setup2');
    } catch (e) { refused(e, A('codeWrong')); }
  });
  const code = (body: Record<string, string>, wrongText: string, how: 'code' | 'backup') => run(async () => {
    try {
      const r = await apiPost<Session>('/admin/auth/code', { ticket, ...body });
      saveSession('admin', r);
      onIn(how);
    } catch (e) { refused(e, wrongText); }
  });

  let title = '';
  let sub = '';
  let body: React.ReactNode = null;
  if (step === 'pw') {
    title = A('siTitle'); sub = A('siSub');
    body = (
      <>
        {field(A('email'), 'em', A('emailPh'), 'email')}
        {field(A('password'), 'pw', A('passwordPh'), 'password')}
        {err && <div role="alert" className={s.mErr}>{err}</div>}
        <button type="button" className={s.lgP} disabled={busy || !v('em').includes('@') || !v('pw')} onClick={login}>{A('continue')}</button>
      </>
    );
  } else if (step === 'otp') {
    title = A('otpTitle'); sub = A('otpSub');
    body = (
      <>
        {field(A('codeLbl'), 'cd', '000000', 'text', A('codeHint'))}
        {err && <div role="alert" className={s.mErr}>{err}</div>}
        <button type="button" className={s.lgP} disabled={busy || digits('cd').length !== 6} onClick={() => code({ code: digits('cd') }, A('wrong'), 'code')}>{A('signIn')}</button>
        <button type="button" className={s.lgS} onClick={() => go('backup')}>{A('useBackup')}</button>
        <button type="button" className={s.lgT} onClick={() => go('pw')}>{A('back')}</button>
      </>
    );
  } else if (step === 'backup') {
    title = A('bkTitle'); sub = A('bkSub');
    body = (
      <>
        {field(A('bkLbl'), 'bk', 'XXXX-XXXX')}
        {err && <div role="alert" className={s.mErr}>{err}</div>}
        <button type="button" className={s.lgP} disabled={busy || v('bk').trim().length < 8} onClick={() => code({ backupCode: v('bk').trim() }, A('bkWrong'), 'backup')}>{A('bkBtn')}</button>
        <button type="button" className={s.lgS} onClick={() => go('otp')}>{A('useApp')}</button>
        <button type="button" className={s.lgT} onClick={() => go('recover')}>{A('lostAll')}</button>
      </>
    );
  } else if (step === 'recover') {
    title = A('rcTitle'); sub = A('rcSub');
    body = (
      <>
        {field(A('rcEmail'), 'em', A('emailPh'), 'email')}
        {field(A('rcOwner'), 'ow', A('rcOwnerPh'))}
        {err && <div role="alert" className={s.mErr}>{err}</div>}
        <button type="button" className={s.lgP} disabled={busy || !v('em').includes('@') || !v('ow').trim()} onClick={() => run(async () => {
          try { await apiPost('/admin/auth/recover', { email: v('em'), owner: v('ow').trim() }); go('recoversent'); } catch { setErr(A('rcFailed')); }
        })}>{A('rcAsk')}</button>
        <button type="button" className={s.lgT} onClick={() => go('backup')}>{A('back')}</button>
      </>
    );
  } else if (step === 'recoversent') {
    title = A('rcSentTitle'); sub = A('rcSentSub');
    body = <button type="button" className={s.lgP} onClick={() => go('pw')}>{A('backToSignIn')}</button>;
  } else if (step === 'wait') {
    title = A('rcWaitTitle');
    sub = A('rcWaitSub', { a: readyAt ? new Date(readyAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Addis_Ababa' }) : '' });
    body = <button type="button" className={s.lgP} onClick={() => go('pw')}>{A('backToSignIn')}</button>;
  } else if (step === 'setup1' && secret) {
    title = A('s1Title'); sub = A('s1Sub');
    body = (
      <>
        <div className={s.qrRow}>
          <div className={s.qrBox}><Qr text={secret.otpauth} /></div>
          <div style={{ minWidth: 0 }}>
            <div className={s.keyLbl}>{A('orType')}</div>
            <div className={s.keyV}>{secret.secret.replace(/(.{4})/g, '$1 ').trim()}</div>
          </div>
        </div>
        {field(A('codeLbl'), 'cd', '000000')}
        {err && <div role="alert" className={s.mErr}>{err}</div>}
        <button type="button" className={s.lgP} disabled={busy || digits('cd').length !== 6} onClick={finishSetup}>{A('verifyContinue')}</button>
        <button type="button" className={s.lgT} onClick={() => go('pw')}>{A('cancel')}</button>
      </>
    );
  } else if (step === 'setup2') {
    title = A('s2Title'); sub = A('s2Sub');
    body = (
      <>
        <div className={s.codes}>{codes.map((c, i) => <div key={c} className={s.code}><span className={s.codeN}>{i + 1}</span>{c}</div>)}</div>
        <button type="button" role="checkbox" aria-checked={saved} className={s.savedRow} onClick={() => setSaved(!saved)}>
          <span className={`${s.box} ${saved ? s.boxOn : ''}`}>{saved && <CheckMark />}</span>{A('saved')}
        </button>
        <button type="button" className={s.lgP} disabled={!saved || !session} onClick={() => { saveSession('admin', session); onIn('setup'); }}>{A('finish')}</button>
        <button type="button" className={s.lgS} onClick={() => { navigator.clipboard?.writeText(codes.join('\n')).catch(() => {}); setCopied(true); }}>{copied ? A('copied') : A('copyCodes')}</button>
      </>
    );
  } else if (step === 'locked') {
    title = A('lockedTitle'); sub = A('lockedSub', { a: rules.lockMinutes });
    body = <button type="button" className={s.lgS} style={{ marginTop: 20 }} onClick={() => go('pw')}>{A('backToSignIn')}</button>;
  } else {
    title = A('idleTitle'); sub = A('idleSub', { a: rules.idleMinutes });
    body = <button type="button" className={s.lgP} onClick={() => go('pw')}>{A('signInAgain')}</button>;
  }

  return (
    <main className={s.login}>
      <div className={s.loginSpace} />
      <div className={s.loginBox}>
        <div className={s.loginBrand}>
          <span aria-hidden="true" className={s.brandMark}>T</span>
          <div className={s.brandName}>{A('appName')}</div>
        </div>
        <h1 className={s.loginH1}>{title}</h1>
        <p className={s.loginSub}>{sub}</p>
        {body}
      </div>
      <div className={s.rules}>
        {[A('rule1'), A('rule2', { a: rules.tries, b: rules.lockMinutes }), A('rule3', { a: rules.idleMinutes })].map((r) => (
          <div key={r} className={s.ruleRow}><span aria-hidden="true">•</span><span>{r}</span></div>
        ))}
      </div>
      <div className={s.loginSpace} />
    </main>
  );
}
