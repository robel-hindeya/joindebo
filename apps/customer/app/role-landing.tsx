'use client';

import { useEffect, useState } from 'react';
import { isLang, t, type Lang, type MessageKey } from '@temelash/i18n';
import s from './role-landing.module.css';

/**
 * The front page of joindebo.com: a hero, then a choice of owner, staff or
 * customer. It has no prototype board (DECISIONS.md, 2026-11-06). The links are
 * plain anchors because /owner and /staff are separate apps behind Caddy.
 * Shop QR codes go to /j/CODE, so they never pass through here.
 */

const LANGS: Array<[Lang, string]> = [['en', 'English'], ['am', 'አማርኛ'], ['om', 'Afaan Oromoo']];
const ROLES: Array<{ href: string; title: MessageKey; sub: MessageKey; icon: string }> = [
  { href: '/owner?start=1', title: 'land.owner', sub: 'land.ownerSub', icon: 'M4 21V9l8-5 8 5v12M9 21v-6h6v6' },
  { href: '/staff', title: 'land.staff', sub: 'land.staffSub', icon: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM5 20a7 7 0 0 1 14 0' },
  { href: '/?start=1', title: 'land.customer', sub: 'land.customerSub', icon: 'M3 8h18v10H3zM3 12h18M8 8V6h8v2' },
];

export function RoleLanding() {
  // The server renders English; a language saved earlier is applied after mount.
  const [lang, setLang] = useState<Lang>('en');
  const L = (k: MessageKey) => t(lang, k);

  useEffect(() => {
    const m = document.cookie.match(/(?:^|; )tc_lang=(\w+)/);
    if (m && isLang(m[1])) setLang(m[1]);
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const pickLang = (l: Lang) => {
    setLang(l);
    document.cookie = `tc_lang=${l}; path=/; max-age=31536000; samesite=lax`;
  };

  return (
    <main className={`${s.page} tc-fade`}>
      <section className={s.hero}>
        <header className={s.nav}>
          <span className={s.logo}>{L('common.appName')}</span>
          <div className={s.langs}>
            {LANGS.map(([code, name]) => (
              <button key={code} type="button" className={s.lang} aria-pressed={lang === code} onClick={() => pickLang(code)}>{name}</button>
            ))}
          </div>
        </header>
        <div className={s.heroBody}>
          <h1 className={s.title}>{L('land.title')}</h1>
          <p className={s.help}>{L('land.help')}</p>
        </div>
      </section>

      <section className={s.choose}>
        <h2 className={s.heading}>{L('land.pick')}</h2>
        <div className={s.roles}>
          {ROLES.map((r) => (
            <a key={r.href} href={r.href} className={s.role}>
              <span className={s.roleIcon}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={r.icon} /></svg>
              </span>
              <span className={s.roleText}>
                <strong className={s.roleTitle}>{L(r.title)}</strong>
                <span className={s.roleSub}>{L(r.sub)}</span>
              </span>
              <svg className={s.roleArrow} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
            </a>
          ))}
        </div>
      </section>
    </main>
  );
}
