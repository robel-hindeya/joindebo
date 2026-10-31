import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { FONTS_HREF } from '@temelash/ui';
import '@temelash/ui/tokens.css';
import '@temelash/ui/motion.css';

export const metadata: Metadata = {
  title: 'Temelash Card',
  description: 'Your stamp cards',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="stylesheet" href={FONTS_HREF} />
      </head>
      <body>{children}</body>
    </html>
  );
}
