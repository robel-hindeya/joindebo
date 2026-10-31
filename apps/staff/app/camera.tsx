'use client';

import { useEffect, useRef } from 'react';
import jsQR from 'jsqr';

/**
 * Reads QR codes from the back camera. Uses the browser's BarcodeDetector when
 * there is one (Chrome on Android) and jsQR otherwise. Calls onDenied when the
 * camera cannot be opened (StaffCamera board).
 */
export function Camera({ onCode, onDenied, className }: { onCode: (text: string) => void; onDenied: () => void; className: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const handler = useRef(onCode);
  handler.current = onCode;

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer = 0;
    let stopped = false;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    type Detector = { detect: (v: HTMLVideoElement) => Promise<Array<{ rawValue: string }>> };
    const BD = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
    const detector = BD ? new BD({ formats: ['qr_code'] }) : null;

    const tick = async () => {
      const v = video.current;
      if (stopped || !v || v.readyState < 2) return;
      try {
        let text: string | null = null;
        if (detector) {
          text = (await detector.detect(v))[0]?.rawValue ?? null;
        } else if (ctx) {
          canvas.width = v.videoWidth;
          canvas.height = v.videoHeight;
          ctx.drawImage(v, 0, 0);
          text = jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height)?.data ?? null;
        }
        if (text) handler.current(text);
      } catch {
        /* a frame that could not be read; try the next one */
      }
    };

    // No camera API at all (old browser, or a page that is not https): same as denied.
    if (!navigator.mediaDevices?.getUserMedia) {
      onDenied();
    } else {
      navigator.mediaDevices
        .getUserMedia({ video: { facingMode: 'environment' }, audio: false })
        .then((s) => {
          if (stopped) return s.getTracks().forEach((t) => t.stop());
          stream = s;
          if (video.current) {
            video.current.srcObject = s;
            video.current.play().catch(() => {});
          }
          timer = window.setInterval(tick, 300);
        })
        .catch(onDenied);
    }

    return () => {
      stopped = true;
      clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onDenied]);

  return <video ref={video} className={className} muted playsInline aria-hidden="true" />;
}
