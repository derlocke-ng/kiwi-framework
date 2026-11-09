// Builds the framework's third-party browser files out of node_modules: the
// nostr bundle, the calendar's CalDAV and iCalendar bundle, the QR encoder and reader, the BIP-39 word list, marked and DOMPurify in shared/, and the icon sprite in
// hub/icons.svg. Run `npm install && npm run vendor` after bumping a version,
// then commit the result: nothing is built at page load.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { buildSync } from 'esbuild';

const root = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const nm = (p) => path.join(root, 'node_modules', p);
const version = (pkg) => createRequire(import.meta.url)(nm(`${pkg}/package.json`)).version;
const stripMap = (s) => s.replace(/\n\/\/# sourceMappingURL=.*\s*$/, '\n');

for (const [from, to] of [
  ['qrcode-generator/dist/qrcode.mjs', 'shared/qrcode.mjs'],
  ['@scure/bip39/wordlists/english.js', 'shared/wordlist.mjs'], // the BIP-39 English words: the password manager's passphrases
  ['marked/lib/marked.esm.js', 'shared/marked.esm.js'],
  ['dompurify/dist/purify.es.mjs', 'shared/purify.es.mjs'],
]) {
  const banner = to === 'shared/wordlist.mjs' ? `// The BIP-39 English word list, from @scure/bip39 ${version('@scure/bip39')} (MIT). Copied by scripts/vendor.mjs.\n` : '';
  fs.writeFileSync(path.join(root, to), banner + stripMap(fs.readFileSync(nm(from), 'utf8')));
}

/** The sprite every page uses: <svg class="icon"><use href="icons.svg#name"/></svg>. Distributions add their own symbols in icons.svg. */
export const ICONS = [
  'plus', 'minus', 'check', 'x', 'share-2', 'ellipsis', 'trash-2', 'lock', 'globe', 'list-checks', 'notebook-pen', 'package', 'user', 'settings', 'copy',
  'qr-code', 'grip-vertical', 'chevron-left', 'cloud', 'cloud-off', 'paperclip', 'file', 'download', 'upload', 'key-round', 'eye', 'pencil', 'link', 'sun', 'moon', 'log-out',
  'shield', 'refresh-cw', 'external-link', 'pin', 'pin-off', 'search', 'file-text', 'languages', 'layout-grid', 'send', 'gamepad-2', 'message-square-lock',
  'sticky-note', 'radio-tower', 'git-branch', 'arrow-up-right', 'users', 'user-plus', 'user-check', 'users-round',
  'image', 'image-plus', 'server', 'message-circle', 'messages-square', 'radio', 'bell', 'bell-off',
  'heart', 'message-square', 'newspaper', 'sprout', 'hash', 'store',
  'calendar', 'calendar-days', 'clock', 'map-pin', 'repeat', 'chevron-right', 'list',
  'shield-check', 'scan-qr-code', 'camera', 'timer', 'lock-open', 'clipboard-paste', 'keyboard', 'image-up',
  'vault', 'wand-sparkles', 'credit-card', 'notebook', 'eye-off', 'heart-pulse', 'shield-alert', 'triangle-alert', 'star', 'history', 'dices',
  'square-asterisk', 'key-square', 'file-key', 'square-terminal', 'award', 'file-badge',
];
export function sprite(file, icons) {
  const symbols = icons.map((name) => {
    const svg = fs.readFileSync(nm(`lucide-static/icons/${name}.svg`), 'utf8');
    const body = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/\s*\n\s*/g, '');
    return `<symbol id="${name}" viewBox="0 0 24 24">${body}</symbol>`;
  });
  fs.writeFileSync(file, `<svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">\n<!-- Lucide icons (ISC) -->\n${symbols.join('\n')}\n</svg>\n`);
  return icons.length;
}
sprite(path.join(root, 'hub/icons.svg'), ICONS);

// The nostr bundle: nostr-tools and its noble/scure dependencies in one ESM file.
buildSync({
  entryPoints: [path.join(root, 'scripts/nostr-entry.mjs')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  legalComments: 'none',
  outfile: path.join(root, 'shared/nostr.mjs'),
  banner: { js: `// nostr-tools ${version('nostr-tools')} (Unlicense) with @noble/curves, @noble/hashes, @noble/ciphers, @scure/base (MIT). Built by scripts/vendor.mjs; see shared/LICENSES.md.` },
});

// The calendar's bundle: tsdav (CalDAV) and ical.js (iCalendar), loaded by the calendar app only.
buildSync({
  entryPoints: [path.join(root, 'scripts/caldav-entry.mjs')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  legalComments: 'none',
  outfile: path.join(root, 'shared/caldav-lib.mjs'),
  banner: { js: `// tsdav ${version('tsdav')} (MIT) and ical.js ${version('ical.js')} (MPL-2.0). Built by scripts/vendor.mjs; see shared/LICENSES.md.` },
});

// The SSH bundle: Ed25519 (@noble/curves) and bcrypt-pbkdf, loaded by the password manager's keys only.
buildSync({
  entryPoints: [path.join(root, 'scripts/ssh-entry.mjs')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  legalComments: 'none',
  outfile: path.join(root, 'shared/ssh-lib.mjs'),
  banner: { js: `// @noble/curves ${version('@noble/curves')} (MIT, Ed25519), bcrypt-pbkdf ${version('bcrypt-pbkdf')} (BSD-3-Clause) with tweetnacl ${version('tweetnacl')} (Unlicense). Built by scripts/vendor.mjs; see shared/LICENSES.md.` },
});

// The QR reader (jsQR), loaded by the authenticator only.
buildSync({
  entryPoints: [path.join(root, 'scripts/qrscan-entry.mjs')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  legalComments: 'none',
  outfile: path.join(root, 'shared/qrscan.mjs'),
  banner: { js: `// jsQR ${version('jsqr')} (Apache-2.0). Built by scripts/vendor.mjs; see shared/LICENSES.md.` },
});

fs.writeFileSync(
  path.join(root, 'shared/LICENSES.md'),
  `# Third-party files in shared/

Generated by \`npm run vendor\` (scripts/vendor.mjs). Do not edit by hand.

| File | Package | License |
|------|---------|---------|
| nostr.mjs | nostr-tools ${version('nostr-tools')} | Unlicense |
| nostr.mjs | @noble/curves ${version('@noble/curves')}, @noble/hashes ${version('@noble/hashes')}, @noble/ciphers ${version('@noble/ciphers')}, @scure/base ${version('@scure/base')} | MIT |
| caldav-lib.mjs | tsdav ${version('tsdav')} | MIT |
| caldav-lib.mjs | ical.js ${version('ical.js')} | MPL-2.0 |
| qrcode.mjs | qrcode-generator ${version('qrcode-generator')} | MIT |
| qrscan.mjs | jsQR ${version('jsqr')} | Apache-2.0 |
| wordlist.mjs | @scure/bip39 ${version('@scure/bip39')} (the BIP-39 English word list) | MIT |
| ssh-lib.mjs | @noble/curves ${version('@noble/curves')} (Ed25519) | MIT |
| ssh-lib.mjs | bcrypt-pbkdf ${version('bcrypt-pbkdf')} | BSD-3-Clause |
| ssh-lib.mjs | tweetnacl ${version('tweetnacl')} | Unlicense |
| marked.esm.js | marked ${version('marked')} | MIT |
| purify.es.mjs | dompurify ${version('dompurify')} | MPL-2.0 OR Apache-2.0 |
| ../hub/icons.svg | lucide-static ${version('lucide-static')} | ISC |
`,
);
console.log(
  `vendored qrcode.mjs, marked.esm.js, purify.es.mjs, ${ICONS.length} icons, nostr.mjs (${Math.round(fs.statSync(path.join(root, 'shared/nostr.mjs')).size / 1024)} KB), qrscan.mjs, ssh-lib.mjs (${Math.round(fs.statSync(path.join(root, 'shared/ssh-lib.mjs')).size / 1024)} KB) and caldav-lib.mjs (${Math.round(fs.statSync(path.join(root, 'shared/caldav-lib.mjs')).size / 1024)} KB)`,
);
