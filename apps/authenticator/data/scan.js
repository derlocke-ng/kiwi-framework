// Reading what a service shows to set up two-factor sign-in: a QR code (from
// the camera, or a picture of it) or the text it holds, which is an otpauth://
// link, a Google Authenticator export (otpauth-migration://), or a bare base32
// secret typed in. The browser's own barcode reader is used where there is one,
// jsQR (vendored in shared/qrscan.mjs, loaded only here) everywhere else.
import { cleanEntry, parseMigration, parseOtpauth } from '../../../shared/totp.js';

/**
 * The entries a piece of text describes: every otpauth:// line, every export, or a bare secret. [] when none.
 * @param {string} text
 * @returns {any[]}
 */
export function entriesFrom(text) {
  const out = [];
  for (const line of String(text || '').split(/\s+/).filter(Boolean)) {
    if (line.startsWith('otpauth-migration:')) out.push(...parseMigration(line));
    else if (line.startsWith('otpauth:')) {
      const e = parseOtpauth(line);
      if (e) out.push(e);
    }
  }
  if (out.length) return out;
  const secret = cleanEntry({ secret: text });
  return secret ? [secret] : [];
}

let jsqr = null;
const detector = typeof BarcodeDetector !== 'undefined' ? new BarcodeDetector({ formats: ['qr_code'] }) : null;

/**
 * The text of a QR code in an image (a video frame, a bitmap, a canvas), or null.
 * @param {CanvasImageSource & { width?: number, height?: number, videoWidth?: number, videoHeight?: number }} source
 * @param {HTMLCanvasElement} canvas  where the pixels are read from
 */
export async function readQr(source, canvas) {
  if (detector) {
    try {
      const found = await detector.detect(source);
      if (found[0]?.rawValue) return found[0].rawValue;
    } catch {
      /* a frame not ready, or a browser that lists the reader but cannot use it: jsQR reads it */
    }
  }
  const w = source.videoWidth || source.width;
  const h = source.videoHeight || source.height;
  if (!w || !h) return null;
  const scale = Math.min(1, 1024 / Math.max(w, h)); // enough pixels for a QR code, not a phone camera's twelve million
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  jsqr ||= (await import('../../../shared/qrscan.mjs')).jsQR;
  return jsqr(pixels.data, pixels.width, pixels.height, { inversionAttempts: 'attemptBoth' })?.data || null;
}

/** The text of a QR code in a picture file, or null. */
export async function readQrFile(file, canvas) {
  const bitmap = await createImageBitmap(file);
  try {
    return await readQr(bitmap, canvas);
  } finally {
    bitmap.close?.();
  }
}
