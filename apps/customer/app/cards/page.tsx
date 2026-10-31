'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { isLang, t, type Lang } from '@temelash/i18n';
import { apiPost, authed, loadSession, saveSession, ApiFailure } from '@temelash/ui';

/**
 * Where "Go to my cards" lands. The cards themselves (Main board) are Phase 2;
 * for now this confirms the sign-in works and offers sign-out.
 */
export default function CardsPage() {
  const router = useRouter();
  const [lang, setLang] = useState<Lang>('en');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const m = document.cookie.match(/(?:^|; )tc_lang=(\w+)/);
    if (m && isLang(m[1])) setLang(m[1]);
    authed('customer', 'GET', '/me')
      .then(() => setReady(true))
      .catch((e) => {
        if (e instanceof ApiFailure && e.status === 401) router.replace('/');
        else setReady(true);
      });
  }, [router]);

  const signOut = async () => {
    const s = loadSession('customer');
    if (s) await apiPost('/auth/signout', {}, s.accessToken).catch(() => {});
    saveSession('customer', null);
    router.replace('/');
  };

  return (
    <main style={{ maxWidth: 390, minHeight: '100dvh', margin: '0 auto', padding: '24px 23px', boxSizing: 'border-box' }}>
      <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#333' }}>{t(lang, 'cards.title')}</h1>
      {ready && (
        <section className="tc-fade" style={{ marginTop: 16, padding: 18, borderRadius: 10, background: '#fff', filter: 'drop-shadow(0 3px 5px rgba(0,0,0,0.13))' }}>
          <p style={{ margin: 0, fontSize: 14, lineHeight: '21px', color: '#555' }}>{t(lang, 'cards.soon')}</p>
        </section>
      )}
      <button type="button" onClick={signOut}
        style={{ marginTop: 24, height: 44, padding: 0, border: 0, background: 'none', color: '#444', font: "700 13px 'Lato', 'Noto Sans Ethiopic', system-ui, sans-serif", textDecoration: 'underline', cursor: 'pointer' }}>
        {t(lang, 'common.signOut')}
      </button>
    </main>
  );
}
