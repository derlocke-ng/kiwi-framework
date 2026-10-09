import qrcode from './qrcode.mjs';

/** QR code as an SVG path: no inline styles, so it passes a strict CSP. Style .qr-bg / .qr-fg. */
export function qrSvg(text) {
  const qr = qrcode(0, 'M');
  qr.addData(text, 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + 4} ${r + 4}h1v1h-1z`;
  const size = n + 8;
  return `<svg class="qr" viewBox="0 0 ${size} ${size}" role="img" aria-label="QR code of the link"><rect width="${size}" height="${size}" class="qr-bg"/><path d="${d}" class="qr-fg"/></svg>`;
}
