export * from './api';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

export const tokens = {
  red: '#e42330',
  blue: '#4661ad',
  navy: '#101827',
  amber: '#fba919',
  bg: '#f3f3f3',
  surface: '#ffffff',
  text: '#444444',
  textStrong: '#333333',
  textMuted: '#595959',
  border: '#e0e0e0',
  error: '#b3261e',
  success: '#0f6e4b',
  cta: '#333333',
  disabled: '#b8b8b8',
  font: "'Lato', 'Noto Sans Ethiopic', system-ui, sans-serif",
} as const;

/** Google Fonts stylesheet used by every app (Lato + Noto Sans Ethiopic). */
export const FONTS_HREF =
  'https://fonts.googleapis.com/css2?family=Lato:wght@400;700&family=Noto+Sans+Ethiopic:wght@400;700&display=swap';

/** Mobile column, 390 px wide like the prototype, centred on larger screens. */
export function MobileShell({ children }: { children: ReactNode }) {
  return (
    <main style={{ maxWidth: 390, minHeight: '100dvh', margin: '0 auto', padding: '24px 23px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      {children}
    </main>
  );
}

/** Desktop back-office frame (Admin is designed at 1280 x 800). */
export function DesktopShell({ children }: { children: ReactNode }) {
  return <main style={{ maxWidth: 1280, minHeight: '100dvh', margin: '0 auto', padding: 32 }}>{children}</main>;
}

export function Card({ children }: { children: ReactNode }) {
  return (
    <section style={{ background: tokens.surface, borderRadius: 14, padding: '24px 20px', filter: 'drop-shadow(0 3px 5px rgba(0,0,0,0.13))' }}>
      {children}
    </section>
  );
}

/** The prototype's full-width dark call-to-action button. */
export function PrimaryButton({ disabled, style, ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...rest}
      aria-disabled={disabled || undefined}
      disabled={disabled}
      style={{
        width: '100%',
        height: 52,
        border: 0,
        borderRadius: 10,
        background: disabled ? tokens.disabled : tokens.cta,
        color: '#fff',
        font: `700 14px ${tokens.font}`,
        letterSpacing: 0.7,
        cursor: disabled ? 'not-allowed' : 'pointer',
        ...style,
      }}
    />
  );
}

export function Wordmark() {
  return (
    <span style={{ fontWeight: 700, fontSize: 20, color: tokens.navy, letterSpacing: 0.4 }}>
      Temelash <span style={{ color: tokens.red }}>Card</span>
    </span>
  );
}
