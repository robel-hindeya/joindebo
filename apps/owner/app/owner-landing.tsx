'use client';

import { t, type Lang, type MessageKey } from '@temelash/i18n';
import s from './landing.module.css';

/**
 * Merchant landing page, the first page of the owner app. It has no prototype
 * board (DECISIONS.md, 2026-11-06). Business types and most wording come from
 * the sign-up form. The hero photo is set in landing.module.css.
 */

const LANGS: Array<[Lang, string]> = [['en', 'English'], ['am', 'አማርኛ'], ['om', 'Afaan Oromoo']];
const CATS: Array<[MessageKey, string]> = [
  ['owner.catFood', 'M5 9h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5zM16 10h2a2 2 0 0 1 0 5h-2M8 3v3M12 3v3'],
  ['owner.catSalon', 'M7 8a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM7 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM9 7l11 11M9 17L20 6'],
  ['owner.catSpa', 'M12 21c-5 0-8-3-8-8 4 0 6 1 8 4 2-3 4-4 8-4 0 5-3 8-8 8zM12 15c-2-3-2-7 0-11 2 4 2 8 0 11z'],
  ['owner.catCar', 'M4 16v-4l2-5h12l2 5v4zM4 12h16M7 16v2M17 16v2'],
];
const STEPS: Array<[MessageKey, MessageKey]> = [
  ['owner.suCard', 'owner.lnStep1Sub'],
  ['owner.lnStep2', 'owner.lnStep2Sub'],
  ['owner.lnStep3', 'owner.roleHelpCash'],
];

export function OwnerLanding({ lang, onLang, onStart, onSignIn }: { lang: Lang; onLang: (l: Lang) => void; onStart: () => void; onSignIn: () => void }) {
  const L = (k: MessageKey) => t(lang, k);
  return (
    <main className={`${s.page} tc-fade`}>
      <section className={s.hero}>
        <header className={s.nav}>
          <span className={s.logo}>{L('common.appName')}</span>
          <div className={s.langs}>
            {LANGS.map(([code, name]) => (
              <button key={code} type="button" className={s.lang} aria-pressed={lang === code} onClick={() => onLang(code)}>{name}</button>
            ))}
          </div>
          <button type="button" className={s.signIn} onClick={onSignIn}>{L('owner.siBtn')}</button>
        </header>
        <div className={s.heroBody}>
          <h1 className={s.title}>{L('owner.lnTitle')}</h1>
          <p className={s.help}>{L('owner.lnHelp')}</p>
          <button type="button" className={s.start} onClick={onStart}>{L('owner.lnStart')}</button>
        </div>
      </section>

      <section className={s.section}>
        <div className={s.inner}>
          <h2 className={s.heading}>{L('owner.lnCats')}</h2>
          <ul className={s.cats}>
            {CATS.map(([label, icon]) => (
              <li key={label} className={s.cat}>
                <span className={s.catIcon}>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={icon} /></svg>
                </span>
                <span className={s.catName}>{L(label)}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className={s.sectionAlt}>
        <div className={s.inner}>
          <h2 className={s.heading}>{L('owner.lnHow')}</h2>
          <ol className={s.steps}>
            {STEPS.map(([title, sub], i) => (
              <li key={title} className={s.step}>
                <span className={s.stepNum} aria-hidden="true">{i + 1}</span>
                <strong className={s.stepTitle}>{L(title)}</strong>
                <span className={s.stepSub}>{L(sub)}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className={s.closing}>
        <h2 className={s.closingTitle}>{L('owner.lnReady')}</h2>
        <button type="button" className={s.start} onClick={onStart}>{L('owner.lnStart')}</button>
      </section>
    </main>
  );
}
