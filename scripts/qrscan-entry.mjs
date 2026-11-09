// Entry for the vendored QR reader (shared/qrscan.mjs): jsQR, which finds and
// decodes a QR code in an image's pixels. The authenticator reads services'
// codes from the camera or a picture with it; bundled by `npm run vendor`.
export { default as jsQR } from 'jsqr';
