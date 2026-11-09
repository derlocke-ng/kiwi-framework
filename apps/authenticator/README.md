# authenticator

Two-factor codes (TOTP, RFC 6238) for a person's accounts elsewhere: a code for each, how long it has left,
the next one when it is about to go; a tap copies it. On every device the person signs in on.

- **The vault.** The secrets are in the account's settings (namespace `authenticator`, key `vault`), sealed a
  second time with a key only the vault's own passphrase gives (scrypt, AES-256-GCM: `shared/vault.js`), the
  owner's choice: the account's password alone does not open them. The passphrase and the key stay in the
  page's memory while it is open; it locks again with the lock button, when the page has been away for a while
  (one, five, fifteen or sixty minutes, chosen per device), and when the page goes.
- **Adding** an account: its QR code through the camera or from a picture (the browser's barcode reader, else
  jsQR, vendored in `shared/qrscan.mjs`), or its `otpauth://` link or bare secret pasted; a Google
  Authenticator export brings all its accounts. What was read is shown with its code before it is added.
- **Going out**: an account's QR code, a list of `otpauth://` links (with a warning), or a backup file that is
  the vault as it is, still sealed with its passphrase. A backup or a list comes back in from the settings.
- **A lost passphrase** cannot be recovered: the settings remove the vault so the person can start again.

Routes: `#/` the codes (or the setup, or the lock), `#/settings`. Strings: `au.*` in `locales/`. Codes and
parsing in `shared/totp.js`. Tests: `test/unit/authenticator.test.js` (RFC 6238 and 4226 vectors, the
link and export formats, the vault), `test/e2e/authenticator.mjs` (the app in a browser, two devices).
