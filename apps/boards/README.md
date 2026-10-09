# boards

Shared lists, inventories and markdown notes that sync across your devices and with the people you share them with, over [nostr](https://nostr.com), with no server of its own and no sign-up. One of the framework's own apps: a distribution mounts it under a name of its choosing ([Armory](https://github.com/derlocke-ng/armory) calls it **Loadout**, live at <https://derlocke-ng.github.io/armory/loadout/>), as often as it likes.

```js
// distribution.js
apps: [{ id: 'loadout', name: 'Loadout', icon: 'list-checks', tags: ['nostr'], framework: 'boards' }],
mounts: [{ id: 'loadout', app: 'loadout' }],
```

The build compiles it with Vite into the mount's folder, with its strings (`locales/`), a favicon drawn from its icon and a web app manifest in the mount's name. Files in the distribution's `apps/<id>/` are laid over it (Armory keeps Loadout's PNG icons and manifest there).

- **Checklists** for groceries and to-dos: `2x milk`, `bread x3`, `# Produce` for a section, paste a whole list at once. Checked items drop into *Done*; *Uncheck all* resets a shopping list for next week.
- **Inventory** lists with counts (`AA batteries: 12`) and ± buttons; empty items are flagged.
- **Notes** in Markdown, rentry style, with the toolbar from the derlocke-blog / apex-genetics admin editor (Ctrl+B / I / K / S), a live preview, and clickable task boxes.
- **Everything is end-to-end encrypted.** Share an *edit* or *view-only* link — by copy, the system share sheet or a QR code. A link is a key: whoever has it can pass it on.
- **Every device gets a key** automatically. Create an **account** in the hub's settings (username + password, or an existing nostr key) to get the same boards on all your devices; backups, relays, language and appearance live in the site's settings and apply to every tool.
- **Works offline**: the app is cached, data lives in IndexedDB, and changes made without a connection are sent when a relay is reachable again.
- **Survives relays forgetting**: devices put their copy back on the relays (see *Where your data lives*).
- **You choose the relays**: the settings show latency and country (from each relay's NIP-11 document); add your own, including a local one.
- **In your language**: English, German, French, Spanish, Italian, Dutch, Polish and Portuguese, chosen from your browser's language and changeable in the settings.
- **Starters** for groceries, to-dos, pantry and notes sit above your boards with example content so the syntax is obvious; hide them with one tap, and edit their templates in the settings. Both are account settings that follow you to every device.


## How it works

The app is React on the framework's widgets (`ui/widgets/`: the item list, the markdown editor and its drafts, the modal) over the framework's data layer (`shared/`). The wire format is in [`docs/protocol.md`](../../docs/protocol.md), section 6, and keeps Loadout's kinds and key derivations, so boards made before the app moved here open unchanged. In short:

| Thing | Where it lives | Who can read | Who can change |
|---|---|---|---|
| A board | addressable nostr events signed by the board's own key pair: `30701` info, one `30702` per item, `30703` note | holders of the read key (view and edit links) | holders of the board's secret key (edit links) |
| Your list of boards (the *wallet*) | `30700` events signed by your key, one per board, encrypted to your key | only you | only you |
| Your key | this browser's `localStorage`; with an account also on the relays, encrypted with your password (`30790`) | — | — |

**Write protection.** A board is a nostr key pair. Only events signed by that key are accepted by relays, so a view-only visitor or a vandal who found a board's address can't write; a forged event sent straight to a relay is answered with `invalid: bad signature`.

**Encryption.** Every value (title, each item, the note) is sealed with AES-256-GCM (gzip first when it's big) under the board's read key before it leaves the browser. The read key is derived from the board's secret key with HKDF, so edit links carry one secret and view links carry only the read key. Guessing or crawling board addresses yields ciphertext.

**Links.** Everything secret is in the URL fragment, which browsers never send to a server:

```
#/b/<board pubkey>?k=<read key>      read only
#/b/<board pubkey>?w=<secret key>    edit (the read key is derived from it)
#/b/<board pubkey>                   a board that is already in your wallet
```

Opening a link saves the board (and its keys) to your wallet and removes the keys from the address bar.

**Accounts** are a username and a password and nothing else: both are run through scrypt to derive a lookup key pair and a wrapping key; your real key is published encrypted under the wrapping key, as an event signed by the lookup key. Only the password can find the event or decrypt it, so nobody can squat, spam or overwrite a username. Signing in on a device adds the boards that device already had to the account.

**Offline.** Writes go to IndexedDB first and to the relays second; whatever a relay didn't accept waits in an outbox until it connects again.

## Where your data lives (and how it comes back)

Relays are caches, not archives — public ones drop data whenever they like. The app keeps it alive in three layers:

1. **Every device keeps a full copy** of every board it has opened, in IndexedDB, as signed events.
2. **Devices heal the relays.** Whenever a relay connects or reconnects — which is what happens after it restarts with an empty disk — each device sends its copy of your account, your wallet and every board in it back. Relays keep the newest version per address, so an old copy never overwrites a newer edit, and because every event is signed, any device can do this, even one with a view-only link.
3. **Backups** contain your key, your wallet, the signed events of every board and a readable snapshot, encrypted with AES-256-GCM under a PBKDF2-SHA-256 key (600 000 rounds) from your passphrase. Restoring publishes the events again, then fills anything still missing from the snapshot. This works when no relay and no other device has the data any more — including your account itself, so you can sign in again everywhere afterwards.

So data is only lost if every device that ever opened a board is gone *and* there is no backup. The browser suite wipes the relay twice to check both recovery paths.

## Honest limits

- **Relays see metadata**: which board addresses are read and written, when, how big the values are, and your IP address. They can't read the content. Use a VPN or Tor if that matters, or use your own relay (the hub's settings, *Network*).
- **A link is a key.** Anyone you give a link to can pass it on; there is no way to tell who opened it.
- **Links can't be revoked.** To lock people out, *Duplicate* the board (new keys) and delete the old one.
- **Anyone with an edit link can delete** the board's content for everyone.
- **Your key sits in `localStorage`.** Anyone with access to this browser profile — or script running on the same origin — can read it. All GitHub Pages sites of one account share the origin `derlocke-ng.github.io`, so a custom (sub)domain is the stronger setup.
- **Weak account passwords can be brute-forced offline** by someone who has your account event. Use a long one (at least 10 characters are required); there is no reset.
- **Last write wins**, per item and per note. If two people edit the same note at the same time, the editor tells you and lets you pick.
- **Restoring an old backup brings back old state** for whatever the relays no longer have — including boards deleted since.
- Notes are capped at 60 000 characters (one relay message).

## Development

```sh
npm run dev                    # in a distribution that mounts it: the hub with hot reload; the app rebuilds on save
node test/e2e/boards.mjs       # the browser suite: a test hub with the app at boards/, a throwaway relay
npm test                       # unit tests, among them links and the start page order (test/unit/boards.test.js)
```

New UI text goes into `locales/en.json` first and then into every other language file; `t('key', { n })` picks plural forms by CLDR category.

| File | What |
|---|---|
| `main.tsx`, `App.tsx` | the page: boots the runtime for the mount it is served at, the routes (`#/`, `#/b/<pub>…`, `#/account`), the wallet per identity, boards friends send, healing |
| `pages/` | the start page (your order, starters, new board and open link), a board (list or note, share, menu, duplicate), the app's settings |
| `data/boards.js` | the board model: keys, encryption, reads and writes (`30701`–`30703`) |
| `data/wallet.js` | your encrypted list of boards (`30700`) and their order |
| `data/links.js` | share links and routes: pure logic, unit tested |
| `data/heal.js` | which authors this device puts back on the relays |
| `data/carry.js` | carrying boards over when the site's identity changed |
| `data/starters.js` | the starters and their templates |
| `menu.js` | the board's menu |
| `boards.css` | what is the app's own; the rest is `shared/ui.css` and `shared/widgets.css` |
| `locales/` | one catalog per language, loaded after the hub's |
