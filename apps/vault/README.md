# vault

A password manager: logins, notes, cards and 2FA codes on every device the person signs in on, sealed with a
passphrase of their own (the owner's choice: the account's password alone does not open them). The
authenticator opens the same vault and shows every entry with a 2FA secret.

- **The vault** (`shared/vault.js`, `shared/vaultstore.js`, `ui/vault/`): a random vault key wrapped under the
  passphrase (scrypt, AES-256-GCM) in the account's settings (namespace `vault`), and one addressable event per
  entry (kind 30792, a random `d`), sealed with the vault key and bound to its address. Relays see how many
  entries there are and when they change. A new passphrase wraps the same key again; the entries stay as they
  are. The key lives in the page's memory: the lock button, the page being away (1, 5, 15 or 60 minutes, per
  device) and leaving it lock the vault. 0.26's authenticator codes move in on the first unlock.
- **The list** searches names, logins, sites, notes and tags, filters by kind, and copies a password or a code
  without opening the entry; an entry opens in a panel with each field to copy (secrets hidden until shown; the
  clipboard is emptied after 30 seconds while the page has the focus), its sites to open, its earlier passwords.
- **The editor** has a generator beside the password (random characters, or a passphrase from the BIP-39 word
  list: `data/generate.js`) and its strength (`data/strength.js`).
- **Health** points at weak, reused and year-old passwords, and, when turned on in the settings, at passwords in
  known breaches (Have I Been Pwned's range API, five hex characters of each SHA-1 leave: `data/breach.js`).
- **Imports** (`data/import.js`): Bitwarden (plain JSON or CSV), KeePass 2 XML, KeePassXC, the CSV of Chrome,
  Edge, Firefox, Safari, 1Password, LastPass, Dashlane and Proton Pass, otpauth:// lists, vault backups.
  **Exports**: a sealed backup, and plain JSON or CSV (Bitwarden's columns) behind a warning (`data/export.js`).

- **Keys and certificates** (0.28, `pages/Keys.tsx`): SSH keys made here (Ed25519, ECDSA P-256/P-384, RSA) or
  brought in from their private file (also an encrypted one), given out as files, with a passphrase when asked
  (`shared/ssh.js`); an SSH key used as a CA signs other keys for users (principals, validity, the `permit-*`
  extensions, a forced command, source addresses) and hosts, and shows the lines servers need to trust it. An
  X.509 root CA (made here or brought in with its PKCS #8 key) issues server, client, server-and-client and
  intermediate certificates, for a key made here or for a CSR whose key stays where it was made
  (`shared/x509.js`); each certificate becomes an entry of its own with its key and chain.

A web page cannot fill in other sites' forms; that would take a browser extension.

Routes: `#/` the list, `#/e/<id>` an entry, `#/e/<id>/edit` and `#/new/<type>` the editor, `#/generate`,
`#/health`, `#/settings`. Strings: `pw.*` in `locales/`, the vault's screens `vault.*` in `shared/locales`.
Tests: `test/unit/vault.test.js` (the vault), `test/unit/passwords.test.js` (generator, strength, breach check,
imports, exports), `test/unit/pki.test.js` (keys and certificates against ssh-keygen, openssl and TLS), `test/e2e/vault.mjs` (the app in a browser, two devices, the authenticator beside it).
