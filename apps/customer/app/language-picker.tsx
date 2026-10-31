'use client';

import { useState } from 'react';
import { LANGUAGES, isLang, t, type Lang } from '@temelash/i18n';
import { Card, MobileShell, PrimaryButton } from '@temelash/ui';

/**
 * Simplified version of the prototype's Welcome board (the wheel picker comes
 * with Phase 1). "Coming soon" languages can be focused but not chosen.
 */
export function LanguagePicker() {
  const [picked, setPicked] = useState<string>('en');
  const [lang, setLang] = useState<Lang>('en');
  const soon = !isLang(picked);

  const choose = (code: string) => {
    setPicked(code);
    if (isLang(code)) setLang(code);
  };

  return (
    <MobileShell>
      <div role="img" aria-label={t(lang, 'welcome.stepAria')} style={{ display: 'flex', gap: 6 }}>
        <span style={{ width: 24, height: 3, borderRadius: 2, background: '#333' }} />
        <span style={{ width: 24, height: 3, borderRadius: 2, background: '#d0d0d0' }} />
      </div>
      <Card>
        <h1 style={{ margin: '0 0 16px', textAlign: 'center', fontSize: 20, lineHeight: '28px', color: 'var(--tc-text-strong)' }}>
          {t(lang, 'welcome.title')}
        </h1>
        <ul role="listbox" aria-label={t(lang, 'welcome.title')} style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {LANGUAGES.map((l) => (
            <li key={l.code} role="option" aria-selected={picked === l.code} aria-disabled={l.comingSoon || undefined}>
              <button
                type="button"
                onClick={() => choose(l.code)}
                style={{
                  width: '100%',
                  minHeight: 48,
                  border: 0,
                  background: 'transparent',
                  font: 'inherit',
                  fontSize: picked === l.code ? 22 : 18,
                  fontWeight: picked === l.code ? 700 : 400,
                  color: l.comingSoon ? 'var(--tc-text-muted)' : 'var(--tc-text-strong)',
                  cursor: 'pointer',
                }}
              >
                {l.label}
                {l.comingSoon && <span style={{ display: 'block', fontSize: 11, fontWeight: 400 }}>{t(lang, 'common.comingSoon')}</span>}
              </button>
            </li>
          ))}
        </ul>
        <p style={{ margin: '8px 0 0', textAlign: 'center', fontSize: 13, color: 'var(--tc-text-muted)' }}>
          {soon ? t(lang, 'welcome.soonHint') : t(lang, 'welcome.hint')}
        </p>
      </Card>
      <PrimaryButton disabled={soon}>{t(lang, 'common.continue')}</PrimaryButton>
    </MobileShell>
  );
}
