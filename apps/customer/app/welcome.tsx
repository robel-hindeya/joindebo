'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { LANGUAGES, isLang, t, type Lang } from '@temelash/i18n';
import s from './welcome.module.css';

/**
 * Welcome board, step 1 of 2: the language wheel. A port of the prototype's
 * Welcome.dc.html with the same geometry and motion: 54 px rows, snap to the
 * centre band, endless loop (the 9 languages repeated 7 times and re-centred
 * when the wheel drifts too far), 3D tilt / scale / fade by distance from the
 * centre, mouse drag, arrow keys and Enter. Reduced motion turns the smooth
 * scrolling and the entrance fade off.
 */

const ROW = 54;
const N = LANGUAGES.length; // 9
const COPIES = 7;
const MIDDLE = 27; // first row of the middle copy (3 * 9)
const LANG_COOKIE = 'tc_lang';

const wrap = (i: number) => ((i % N) + N) % N;

function scrollBehavior(): ScrollBehavior {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
  } catch {
    return 'smooth';
  }
}

function savedLang(): Lang | null {
  const m = document.cookie.match(/(?:^|; )tc_lang=(\w+)/);
  return m && isLang(m[1]) ? m[1] : null;
}

export function Welcome() {
  // The server renders English; a language saved earlier is applied after mount.
  const [startLang, setStartLang] = useState<Lang>('en');
  const startIndex = Math.max(0, LANGUAGES.findIndex((l) => l.code === startLang));

  const [pos, setPos] = useState(MIDDLE);
  // Last real (not "coming soon") language the wheel passed over.
  const [ok, setOk] = useState<Lang>('en');
  const [step, setStep] = useState<'lang' | 'auth'>('lang');
  const [chosen, setChosen] = useState<Lang>('en');

  useEffect(() => {
    const saved = savedLang();
    if (!saved || saved === 'en') return;
    setStartLang(saved);
    setOk(saved);
    setChosen(saved);
    setPos(MIDDLE + LANGUAGES.findIndex((l) => l.code === saved));
  }, []);

  const wheel = useRef<HTMLDivElement>(null);
  const raf = useRef(0);
  const settleTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const drag = useRef<{ y: number; top: number; moved: number; id: number; cap: boolean } | null>(null);
  const noTapUntil = useRef(0);

  const picked = LANGUAGES[wrap(Math.round(pos))];
  const soon = picked.comingSoon;
  const lang: Lang = soon ? ok : (picked.code as Lang);

  // Read the wheel position into state (from the scroll frame, and again once it settles).
  const sync = useCallback((el: HTMLDivElement) => {
    const q = el.scrollTop / ROW;
    const row = LANGUAGES[wrap(Math.round(q))];
    setPos(q);
    if (!row.comingSoon) setOk(row.code as Lang);
  }, []);

  // Snap back into the middle copies so the wheel never runs out of rows.
  const settle = useCallback((el: HTMLDivElement) => {
    if (drag.current) return;
    sync(el);
    const i = Math.round(el.scrollTop / ROW);
    if (i < 18 || i >= 45) {
      el.style.scrollSnapType = 'none';
      el.scrollTop = (MIDDLE + wrap(i)) * ROW;
      requestAnimationFrame(() => {
        el.style.scrollSnapType = 'y mandatory';
      });
    }
  }, [sync]);

  useEffect(() => {
    const el = wheel.current;
    if (!el || step !== 'lang') return;
    el.scrollTop = (MIDDLE + startIndex) * ROW;

    const onScroll = () => {
      if (!raf.current) {
        raf.current = requestAnimationFrame(() => {
          raf.current = 0;
          sync(el);
        });
      }
      clearTimeout(settleTimer.current);
      settleTimer.current = setTimeout(() => settle(el), 160);
    };
    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      drag.current = { y: e.clientY, top: el.scrollTop, moved: 0, id: e.pointerId, cap: false };
      el.style.scrollSnapType = 'none';
    };
    const onPointerMove = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const dy = e.clientY - d.y;
      d.moved = Math.max(d.moved, Math.abs(dy));
      if (d.moved > 4 && !d.cap) {
        d.cap = true;
        try {
          el.setPointerCapture(d.id);
        } catch {
          /* pointer already released */
        }
      }
      if (d.cap) el.scrollTop = d.top - dy;
    };
    const onPointerEnd = () => {
      const d = drag.current;
      if (!d) return;
      drag.current = null;
      el.style.scrollSnapType = 'y mandatory';
      if (d.moved > 4) noTapUntil.current = Date.now() + 300;
      el.scrollTo({ top: Math.round(el.scrollTop / ROW) * ROW, behavior: scrollBehavior() });
    };

    el.addEventListener('scroll', onScroll, { passive: true });
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerEnd);
    el.addEventListener('pointercancel', onPointerEnd);
    return () => {
      el.removeEventListener('scroll', onScroll);
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerEnd);
      el.removeEventListener('pointercancel', onPointerEnd);
      cancelAnimationFrame(raf.current);
      raf.current = 0;
      clearTimeout(settleTimer.current);
    };
  }, [settle, startIndex, step, sync]);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const next = () => {
    if (soon) return;
    document.cookie = `${LANG_COOKIE}=${lang}; path=/; max-age=31536000; samesite=lax`;
    setChosen(lang);
    setStep('auth');
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const el = wheel.current;
    if (!el) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      el.scrollBy({ top: ROW, behavior: scrollBehavior() });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      el.scrollBy({ top: -ROW, behavior: scrollBehavior() });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      next();
    }
  };

  const tapRow = (i: number) => {
    if (Date.now() < noTapUntil.current) return;
    wheel.current?.scrollTo({ top: i * ROW, behavior: scrollBehavior() });
  };

  if (step === 'auth') {
    // Step 2 is the ScanJoin board (sign up / sign in), built in Phase 1.
    return (
      <div className={s.screen}>
        <div className={`${s.step} tc-wfade`}>
          <div role="img" aria-label={t(chosen, 'welcome.step2Aria')} className={s.steps}>
            <span data-on="true" />
            <span data-on="true" />
          </div>
          <div className={s.cardWrap}>
            <div className={s.card} style={{ padding: '30px 24px' }}>
              <p className={s.notice}>{t(chosen, 'dev.signInComing')}</p>
            </div>
          </div>
          <div className={s.spacer} />
          <button type="button" className={s.cta} onClick={() => setStep('lang')}>
            {t(chosen, 'common.back')}
          </button>
        </div>
      </div>
    );
  }

  const sel = Math.round(pos);
  const rows = Array.from({ length: N * COPIES }, (_, i) => {
    const d = i - pos;
    const ad = Math.abs(d);
    const scale = Math.max(0.5, 1 - ad * 0.13);
    const tilt = Math.max(-62, Math.min(62, d * -15));
    const g = Math.round(17 + (140 * Math.min(ad, 1.6)) / 1.6);
    return {
      i,
      l: LANGUAGES[i % N],
      on: i === sel,
      hidden: Math.abs(i - sel) > 1,
      style: {
        color: `rgb(${g},${g},${g})`,
        opacity: Math.max(0.12, 1 - ad * 0.3).toFixed(2),
        fontWeight: ad < 0.5 ? 700 : 400,
        transform: `perspective(420px) rotateX(${tilt.toFixed(1)}deg) scale(${scale.toFixed(3)})`,
      } as React.CSSProperties,
    };
  });

  return (
    <div className={s.screen}>
      <div className={`${s.step} tc-wfade`}>
        <div role="img" aria-label={t(lang, 'welcome.stepAria')} className={s.steps}>
          <span data-on="true" />
          <span />
        </div>

        <div className={s.cardWrap}>
          <div className={s.card}>
            <h1 className={s.title}>{t(lang, 'welcome.title')}</h1>
            <div className={s.tear} aria-hidden="true" />

            <div className={s.wheelBox}>
              <div
                ref={wheel}
                className={s.wheel}
                role="listbox"
                tabIndex={0}
                aria-label={t(lang, 'welcome.title')}
                aria-activedescendant={`lang-row-${sel}`}
                onKeyDown={onKeyDown}
              >
                {rows.map((r) => (
                  <div
                    key={r.i}
                    id={`lang-row-${r.i}`}
                    className={s.row}
                    role="option"
                    aria-selected={r.on}
                    aria-hidden={r.hidden || undefined}
                    aria-disabled={r.l.comingSoon || undefined}
                    onClick={() => tapRow(r.i)}
                    style={r.style}
                  >
                    <span className={s.rowLabel}>{r.l.label}</span>
                    <span className={s.rowTag} style={{ height: r.l.comingSoon ? 14 : 0 }}>
                      {r.l.comingSoon ? t(lang, 'common.comingSoon') : ''}
                    </span>
                  </div>
                ))}
              </div>
              <div className={s.fadeTop} aria-hidden="true" />
              <div className={s.fadeBottom} aria-hidden="true" />
              <div className={s.band} aria-hidden="true" />
            </div>

            <p className={s.hint}>{soon ? t(lang, 'welcome.soonHint') : t(lang, 'welcome.hint')}</p>
          </div>
        </div>

        <div className={s.spacer} />
        <button type="button" className={s.cta} aria-disabled={soon} onClick={next}>
          {t(lang, 'common.continue')}
        </button>
      </div>
    </div>
  );
}
