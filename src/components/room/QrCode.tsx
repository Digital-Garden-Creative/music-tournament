import { useMemo } from 'react';
import qrcode from 'qrcode-generator';

/** A QR code for `text`, drawn as one SVG path (dark modules on white, with a quiet zone). */
export default function QrCode({ text, label, className }: { text: string; label: string; className?: string }) {
  const { size, path } = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    const quiet = 4;
    let d = '';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (qr.isDark(r, c)) d += `M${c + quiet} ${r + quiet}h1v1h-1z`;
      }
    }
    return { size: n + quiet * 2, path: d };
  }, [text]);

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className={className} role="img" aria-label={label}
      shapeRendering="crispEdges">
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#09090b" />
    </svg>
  );
}
