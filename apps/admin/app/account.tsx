'use client';

import { useState } from 'react';
import { authed } from '@temelash/ui';
import { Qr } from './signin';
import { A, Kv, List, RED, failText, fd, ft, rel, signal401, useLoad, type Ctx } from './ui';
import s from './admin.module.css';

/** AdminAccount (two-step sign-in, backup codes, a new phone) and AdminTeamRecovery (a reset waiting for an Owner). */

const post = <T = unknown>(path: string, body: object = {}) => authed<T>('admin', 'POST', '/admin' + path, body).catch((e) => { signal401(e); throw e; });
async function act(fn: () => Promise<unknown>) {
  try { await fn(); } catch (e) { throw new Error(failText(e)); }
}
const codeInput = { label: A('codeFromApp'), key: 'code', ph: '000000' };
const sixDigits = (f: Record<string, string>) => (f.code ?? '').replace(/\D/g, '').length === 6;

/** Codes shown once, with "I saved them". */
function CodesCard({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  return (
    <div className={s.card}><div className={s.cardIn}>
      <div className={s.blkTitle}>{A('newCodesTitle')}</div>
      <p style={{ margin: '0 0 10px', fontSize: 13, lineHeight: '18px', color: '#555' }}>{A('newCodesSub')}</p>
      <div className={s.codes}>{codes.map((c, i) => <div key={c} className={s.code}><span className={s.codeN}>{i + 1}</span>{c}</div>)}</div>
      <button type="button" className={s.btn} style={{ marginTop: 12 }} onClick={onDone}>{A('saved')}</button>
    </div></div>
  );
}

export function AccountSecurity({ ctx }: { ctx: Ctx }) {
  const me = useLoad<{ backupCodesLeft: number; newDeviceAlert: boolean }>('/admin/me');
  const sess = useLoad<Sessions>('/admin/me/sessions');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [phone, setPhone] = useState<{ secret: string; otpauth: string } | null>(null);
  const [newCode, setNewCode] = useState('');
  const [err, setErr] = useState('');
  if (!me.data) return null;
  const alertOn = me.data.newDeviceAlert;
  const pwRules = (np: string, np2: string): Array<[boolean, string]> => [
    [np.length >= 12, A('pwR1')], [/[a-z]/.test(np) && /[A-Z]/.test(np), A('pwR2')], [/\d/.test(np), A('pwR3')], [/[^A-Za-z0-9]/.test(np), A('pwR4')], [!!np && np === np2, A('pwR5')],
  ];
  const changePassword = () => ctx.open({
    title: A('pwTitle'), sub: A('pwSub'), ok: A('pwTitle'), note: A('pwNote'),
    list: pwRules('', '').map(([, t]) => `○  ${t}`),
    inputs: [{ label: A('pwCurrent'), key: 'cp', type: 'password' }, { label: A('pwNew'), key: 'np', type: 'password', ph: A('pwNewPh') }, { label: A('pwAgain'), key: 'np2', type: 'password' }],
    need: (f) => !!f.cp && pwRules(f.np ?? '', f.np2 ?? '').every(([ok]) => ok),
    go: (f) => act(async () => { await post('/me/password', { current: f.cp, next: f.np }); ctx.close(); ctx.toast(A('pwDone')); sess.reload(); }),
  });
  const others = (sess.data?.sessions ?? []).filter((x) => !x.current).length;
  const signOutOthers = () => ctx.open({
    title: A('soTitle'), sub: A('soSub', { a: others }, others), ok: A('soOk'),
    go: () => act(async () => { await post('/me/signout-others'); ctx.close(); ctx.toast(A('soDone')); sess.reload(); }),
  });
  const toggleAlert = async () => { await post('/me/device-alert', { on: !alertOn }); ctx.toast(A(alertOn ? 'devAlertOff' : 'devAlertOn')); me.reload(); };
  const newPhone = () => ctx.open({
    title: A('npTitle'), sub: A('npSub'), inputs: [codeInput], ok: A('continue'), need: sixDigits,
    go: (f) => act(async () => { setPhone(await post<{ secret: string; otpauth: string }>('/me/new-phone', { code: f.code.replace(/\D/g, '') })); ctx.close(); }),
  });
  const finishPhone = async () => {
    try {
      const r = await post<{ backupCodes: string[] }>('/me/new-phone/finish', { code: newCode.replace(/\D/g, '') });
      setPhone(null); setNewCode(''); setErr(''); setCodes(r.backupCodes); ctx.toast(A('npDone')); me.reload();
    } catch (e) { setErr(failText(e)); }
  };
  const newCodes = () => ctx.open({
    title: A('bkNewTitle'), sub: A('bkNewSub', { a: me.data!.backupCodesLeft }), inputs: [codeInput], note: A('bkNewNote'), ok: A('bkNewOk'), need: sixDigits,
    go: (f) => act(async () => { const r = await post<{ backupCodes: string[] }>('/me/backup-codes', { code: f.code.replace(/\D/g, '') }); ctx.close(); setCodes(r.backupCodes); me.reload(); }),
  });
  return (
    <>
      <List title={A('pwHead')} rows={[{ t: A('pwTitle'), s: sess.data?.passwordChangedAt ? A('pwChanged', { a: fd(sess.data.passwordChangedAt) }) : A('pwRule'), go: changePassword }]} />
      <List title={A('twoStep')} rows={[
        { t: A('authApp'), s: A('authAppS'), pill: 'aon' },
        { t: A('devAlert'), s: A('devAlertS'), pill: alertOn ? 'pson' : 'toff', go: toggleAlert },
        { t: A('npTitle'), s: A('npRowS'), go: newPhone },
      ]} />
      {phone && (
        <div className={s.card}><div className={s.cardIn}>
          <div className={s.blkTitle}>{A('npScan')}</div>
          <div className={s.qrRow}>
            <div className={s.qrBox}><Qr text={phone.otpauth} /></div>
            <div style={{ minWidth: 0 }}><div className={s.keyLbl}>{A('orType')}</div><div className={s.keyV}>{phone.secret.replace(/(.{4})/g, '$1 ').trim()}</div></div>
          </div>
          <label className={s.fieldLbl} htmlFor="f_npcode">{A('codeLbl')}</label>
          <input id="f_npcode" className={s.fieldInput} value={newCode} placeholder="000000" autoComplete="off" onChange={(e) => setNewCode(e.target.value)} />
          {err && <div role="alert" className={s.mErr}>{err}</div>}
          <button type="button" className={s.btn} style={{ marginTop: 12 }} disabled={newCode.replace(/\D/g, '').length !== 6} onClick={finishPhone}>{A('verifyContinue')}</button>
        </div></div>
      )}
      {codes && <CodesCard codes={codes} onDone={() => setCodes(null)} />}
      <Kv title={A('bkCodes')} rows={[{ k: A('kUnused'), v: A('unusedV', { a: me.data.backupCodesLeft }) }]} />
      <List title={A('bkNewHead')} rows={[{ t: A('bkNewTitle'), s: A('bkNewRowS'), go: newCodes }]} />
      {sess.data && (
        <>
          <List title={A('whereIn')} rows={sess.data.sessions.map((x) => ({ t: x.device, s: `${x.ip ?? ''} · ${A('lastUsed', { a: rel(x.lastUsed) })}`.replace(/^ · /, ''), pill: x.current ? 'aon' : undefined }))} />
          <List title={A('sessHead')} rows={[others ? { t: A('soTitle'), s: A('soRowS', { a: others }, others), go: signOutOthers } : { t: A('soTitle'), s: A('soNone'), dim: true }]} />
          <List title={A('recentIn')} empty={A('recentNone')} rows={sess.data.recent.map((x) => ({ t: A(`rk_${x.kind.replace('admin.', '')}`), s: `${fd(x.at)} ${ft(x.at)}${x.ip ? ` · ${x.ip}` : ''}`, sc: x.kind === 'admin.signin' ? undefined : RED }))} />
        </>
      )}
    </>
  );
}

interface Sessions {
  passwordChangedAt: string | null;
  sessions: Array<{ id: string; device: string; ip: string | null; since: string; lastUsed: string; current: boolean }>;
  recent: Array<{ at: string; kind: string; ip: string | null }>;
}

interface Recovery { id: string; status: 'pending' | 'approved'; ownerNamed: string; requestedAt: string; readyAt: string | null; mine: boolean; name: string; email: string; decidedBy: string | null }

/** Settings → Team: "An account reset is waiting for you" (Owners only). */
export function RecoveryWaiting({ ctx }: { ctx: Ctx }) {
  const r = useLoad<Recovery[]>(ctx.me.role === 'owner' ? '/admin/recoveries' : null);
  if (!r.data?.length) return null;
  return (
    <>
      {r.data.map((x) => {
        if (x.status === 'approved') {
          return <List key={x.id} title={A('rcApprovedHead')} rows={[{ t: A('rcApprovedRow', { a: x.name, b: x.decidedBy ?? '' }), s: A('rcReadyAt', { a: x.readyAt ? `${fd(x.readyAt)} ${ft(x.readyAt)}` : '' }) },
            ...(x.mine ? [] : [{ t: A('rcDeny'), s: A('rcDenyS'), sc: RED, go: () => deny(x) }])]} />;
        }
        return (
          <List key={x.id} title={A('rcWaitHead')} rows={[
            { t: A('rcLost', { a: x.name }), s: A('rcAsked', { a: `${fd(x.requestedAt)} ${ft(x.requestedAt)}`, b: x.ownerNamed }), sc: RED },
            ...(x.mine ? [{ t: A('rcMine'), s: A('rcMineS'), dim: true }] : [
              { t: A('rcApprove'), s: A('rcApproveS'), go: () => approve(x) },
              { t: A('rcDeny'), s: A('rcDenyS'), sc: RED, go: () => deny(x) },
            ]),
          ]} />
        );
      })}
    </>
  );

  function approve(x: Recovery) {
    ctx.open({
      title: A('rcApproveTitle'), sub: A('rcSays', { a: x.name }), list: [A('rcL1'), A('rcL2'), A('rcL3')], ok: A('rcApproveOk'),
      inputs: [{ label: A('password'), key: 'password', type: 'password' }, codeInput], need: (f) => !!f.password && sixDigits(f),
      go: (f) => act(async () => { await post(`/recoveries/${x.id}/approve`, { password: f.password, code: f.code.replace(/\D/g, '') }); ctx.close(); ctx.toast(A('rcApproved')); r.reload(); }),
    });
  }
  function deny(x: Recovery) {
    ctx.open({
      title: A('rcDenyTitle'), sub: A('rcSays', { a: x.name }), list: [A('rcDenyL')], note: A('rcDenyNote'), ok: A('rcDeny'), danger: true,
      go: () => act(async () => { await post(`/recoveries/${x.id}/deny`); ctx.close(); ctx.toast(A('rcDenied')); r.reload(); }),
    });
  }
}

/** Settings → Rules: how owners reach Temelash from Help (OwnHelp shows each only once it is set). */
export function SupportContacts({ ctx, settings, isOwner, onSaved }: { ctx: Ctx; settings: Array<{ key: string; value: unknown }>; isOwner: boolean; onSaved: () => void }) {
  const v = (k: string) => { const x = settings.find((s) => s.key === k)?.value; return typeof x === 'string' ? x : ''; };
  const edit = (key: string, label: string, ph: string) => ctx.open({
    title: label, sub: A('scSub'), ok: A('save'), inputs: [{ label, key: 'value', ph, initial: v(key) }],
    go: (f) => act(async () => { await post('/settings', { key, value: (f.value ?? '').trim() }); ctx.close(); ctx.toast(A('stdSaved')); onSaved(); }),
  });
  return (
    <List title={A('scHead')} rows={[
      { t: A('scPhone'), s: v('support.phone') || A('scNotSet'), go: isOwner ? () => edit('support.phone', A('scPhone'), '+251 9X XXX XXXX') : undefined },
      { t: A('scTelegram'), s: v('support.telegram') || A('scNotSet'), go: isOwner ? () => edit('support.telegram', A('scTelegram'), '@temelash') : undefined },
    ]} />
  );
}
