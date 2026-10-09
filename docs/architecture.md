# Architecture

How kiwi-framework hubs (Armory being the first) move and store data, why the suite stopped using gun, and where it is going. This is the record of the decisions made in October 2026; update it when a decision changes.

## Framework, distributions, apps

Three layers, decided in October 2026:

- **The framework** ([kiwi-framework](https://github.com/derlocke-ng/kiwi-framework): `shared/` plus the hub pages, scripts and tests) is the engine and the parts: identity and accounts, relays, store and sync, settings, People, moderation, the design kit, widgets and feature modules, the app shell, notices, proof of work, backup, the registries, the scaffolder and the test harness. It ships nothing a user can open. Core apps live in it too: settings, chat, notifications and the backend pieces every hub needs. A fork cannot remove them.
- **A distribution** is a hub built on the framework: a name and look, default relays, and a chosen set of apps on chosen spaces. [Armory](https://github.com/derlocke-ng/armory) is the first and the template; others fork it, change its `distribution.js` and run their own community. Everything a fork would change lives in that one file plus its `locales/`; the framework never names a distribution.
- **An app** is a folder with a manifest that plugs into any distribution. Apps are installed at fork time: the operator copies the folder (or pulls it from a catalog) and mounts it. Apps talk to the framework only through its public API and never touch storage or keys directly, so that a later sandboxed, user-installed mode stays possible without rewriting them.

**Core, default, optional.** Core apps are what the framework depends on and no fork may remove: settings (with People and relays), chat, notifications, the backend. Default apps ship with the template and a fork may drop them: Loadout, the feed and the market (Outpost and Trading Post in Armory), DevBoard. Everything else is optional (pong, the blog).

**Names.** The framework names its apps by what they are: `market`, `feed`, `chat`, `blog`, `settings`. Those are the ids, the folder names and the words in the wire protocol, and they never change. A distribution shows them under its own names through its mounts: Armory, in its military, gaming and growing idiom, mounts the market as **Trading Post**, the feed as **Outpost** and the chat as **Uplink**; a fork of Armory inherits those names until it changes them, and the framework's own hub shows the plain ones. Core apps can be mounted under another name too (a mount of `chat` with the id `uplink`), but no distribution can drop them. Apps a distribution brings itself (Loadout, Payload, pongjs, DevBoard) keep the names their authors gave them.

**Federation.** Two users on different distributions are friends, share and chat exactly as on one, because identity and data are nostr events, not the hub's. What must stay stable is the wire protocol: the kinds, tags and content formats the framework defines, versioned, with the framework shipping the code that implements them. Instances announce themselves with a signed manifest event (name, URL, apps, spaces, relays), so any hub can show other communities and their apps without a pull request anywhere; a separate catalog repository seeds that discovery with a curated, reviewed list. The framework repository stays code only.

### Spaces

A space is a named, owned community: an id, an owner key, a name, moderators, its own relays, an adult flag, and the app code that renders it. Nostr's moderated communities (NIP-72) are the fitting standard: a community definition event, posts that point at it, approval events from its moderators; other nostr clients can read our spaces, and operators get moderation. Every post and listing belongs to exactly one space, as a required part of the event; a post without a space is shown nowhere. Spaces are federated: two hubs can serve the same space, and a space's relays carry only its content, so a cannabis relay never carries gem listings. A space may be used by several apps (one community with a feed and a market) or one app only (a market of its own next to a feed space); both shapes are ordinary.

### Mounts

What a hub shows is a list of **mounts**: app code plus a space, with its own id, name and icon. "Seedbank" is the market code mounted on a seed space; "Tiny Tina's Gem Store" is the same code mounted on her gem space, with her branding, moderators and relays; both are separate tiles, switcher entries and routes on one hub. A distribution ships as many mounts of an app as it wants (several markets, several feeds); the start page and the switcher group mounts of one app under a heading once there are more than two, and users hide mounts one by one. Apps without a space (Loadout, Payload, pong) are mounted once, without one. Importing another community's store is one mount line; if it needs different code, one catalog line more. Mounting is the operator's, through the config; a per-hub flag may let users follow a foreign space themselves, which then appears as a mount for them alone. Hubs are closed by default: nothing arrives unasked, and nothing is ever blended into a space's feed.

### Links across hubs

A shared link names the app, the space and the item, never the host. A hub resolves it to the mount serving that app and space; without one it says whose space this is and offers to open the link on the hub it came from, or to add the mount if the operator allows that. Content inside a link is a nostr address with relay hints, so a board or post from another instance is fetched from the relays it lives on. Loadout's `/loadout/#/b/…` links already have the shape; the host part becomes irrelevant and the hints get added.

### Relays: lists, not sameness

Two hubs need not share relays. Each user publishes a relay list (kind 10002: where they write, where they read) and a list for private wraps (kind 10050). To reach someone the framework fetches their lists and publishes to their read relays; to follow someone it subscribes to their write relays. The lists are found on a few directory relays and travel inside the first contact: a friend request and a share carry the sender's lists in the wrap, so the reply needs no lookup. A kiwi relay per instance then simply appears in that instance's users' lists. This goes in before the first fork.

### Catalogs and kiwi

An app is a folder with a manifest (`kiwi.manifest`: id, description, version, icon, tags, license, the framework it is built on, the event kinds it speaks) and a catalog is a repository listing repositories: the same convention kiwi-updater uses for desktop apps (`kiwi.manifest`, `apps.list`). The web catalog is [kiwi-web-catalog](https://github.com/derlocke-ng/kiwi-web-catalog): one line per repository, `path=` for an app inside a hub's repository, `ref=` to pin a version, and a `CATEGORY` in each manifest (Framework, Hub or App). It is for the web tooling, not for `kiwi catalog add`: its entries have no installer. Importing another hub's app is one line there plus one mount here. On the node, kiwi-server gets modules for a hub, a nostr relay and media storage, so a kiwi-node is a complete instance: the relay in its users' relay lists, the hub behind its reverse proxy. Kiwi Blog sites (derlocke-blog, Apex Genetics) stay what they are: standalone static sites with their own hosting and browser admin; they do not move to nostr. A hub's blog is a framework app of its own, `blog`: long-form articles (kind 30023, NIP-23) written in the hub with the framework's markdown editor by the operator or any account, listed as a feed, readable from other hubs and from any nostr client; Armory will mount it under a name of its own.

### Gun

Gun stays for what it is best at: live, ephemeral sync, where latency matters and persistence and identity do not. It lives in one framework module for live channels (presence, signaling, game state) with a gun backend and a nostr ephemeral-event backend behind one interface, chosen per distribution; Payload and pong use the module and never gun directly. Nothing persistent, identity-bound or federated goes through it.

## Decided for the long run (October 2026)

The hub and the network are meant to exist for ten years and more, without money behind them. That decides more than any feature.

**The protocol is the product.** The event kinds, tags, content formats, key derivations and file formats are specified in [`protocol.md`](protocol.md), versioned, separate from this record. Every line of UI code could be deleted and a new client written from that document and the data on the relays. Backups are plain files a user keeps. No company, account or service sits in the critical path: the build emits plain files, GitHub Pages is replaceable by any static host or a kiwi-node, and relays are the user's list, not ours.

**The stack.** Vite, TypeScript and React for everything visible; the data layer (`shared/`: accounts, events, relays, store, sync, heal, settings, people, moderation, proof of work, backup, i18n) stays ours and gets types; the nostr tools bundle stays the primitive. Plain CSS with custom properties remains the design library. The tests stay as they are: node's test runner for units, Playwright for the browser suites, which describe behaviour at the protocol level and survive any rewrite. A formatter and linter (Biome) comes with the port.

**One seam.** Apps use the framework's components and hooks (identity, settings, relays, people, blocks, proof of work, an events hook over subscriptions) and nothing below them. When a UI framework swap comes, and in ten years one will, it happens once in the framework. Preact is the exit if React goes somewhere we will not follow.

**Dependencies.** A short list, each with a written reason, pinned or vendored: React, TypeScript, Vite, the nostr tools bundle with its noble crypto, Playwright. No meta-framework, no UI kit, no CSS-in-JS, no state library beyond React itself, nothing for what the platform does (fetch, crypto, IndexedDB, plural rules). Every addition is a decision recorded here.

**Nostr libraries.** We stay on nostr-tools as the primitive and keep our own store, sync, heal and backup; they encode behaviour no client library offers (relay wipes repaired by the first device that reconnects, backups that restore everything, the account derivation). NDK and applesauce are good libraries for app builders, but adopting one wholesale would replace that store and tie the data layer to its churn. We borrow two ideas from them instead: the outbox model (NIP-65 relay lists, so a friend on other relays is still reached) and a signer abstraction (NIP-07 browser extensions, NIP-46 remote signers such as Amber on Android), so the key can live outside the page.

**Framework app names.** `boards` is Loadout's code (lists, inventory, notes), `notices` is DevBoard's; both move into the framework repository during the port, and Armory keeps mounting them as Loadout and DevBoard. The ids in the wire protocol (`loadout` in the settings namespace, the share app id) are migrated once, with the old names read for a transition.

**Translation.** Catalogs are JSON per package and stay that way: the framework's (`shared/locales`, `hub/locales`), each app's (`apps/<id>/locales`), the distribution's (`locales/`, its hub texts). The build merges them per language into one file, loaded once; the language comes from the browser the first time and from the account's settings after (kind 30791, `suite.lang`), so it follows the user to every device. In React this is a provider and a `useT()` hook over the same `t()`; the unit test keeps every language complete against English, and English is the fallback. Community translation later runs on these same files (they are Weblate-compatible). User content is never machine-translated by us.

**Mounts, several markets on one hub.** Confirmed as the model: one market code base, mounted as many times as a hub wants, each mount on its own space. A space carries its relays, moderators, categories, rules text, adult flag, languages and region, so a seed market and a gem store on one hub share nothing but the code: every listing names its space in a tag, a mount reads only its space, and the switcher groups mounts of one app. Today the config supports several mounts of one app: the hub draws a card and a switcher entry per mount, the build serves the app at every mount's route (`seedbank/`, `gemstore/`), and the app shell tells the app which mount it runs as from its folder, so each shows its own name and mark (the smoke test builds one app mounted twice). Still to build, in this order: the space definition events, the `a` tag on posts and listings so a mount reads only its space, the market app itself, and mounting framework apps from `node_modules`.

**Phones and offline.** The data layer is transport-agnostic: signed events in, signed events out, everything the app needs in the local store, nothing that waits for a server. That is what makes a native shell possible later: Capacitor wraps the same web code into an Android or iOS app, and a Bluetooth mesh transport (store-and-forward of signed events between nearby phones when the internet is down) is one more relay adapter behind the same interface. Web Bluetooth cannot do that from a page, so it is a native module when the time comes; nothing is built for it now, but nothing in the data layer may depend on a browser-only API without a fallback. Images in feeds get size variants and a blurhash in the event (NIP-94 `imeta`), lazy loading, and a data-saver mode that loads thumbnails only.

**Money, later.** None in the protocol. What stays possible without betraying the rest: hosting plans for kiwi-nodes, zaps (NIP-57) to creators and sellers, paid listing boosts on a market a hub operator runs, support contracts. No ads and no tracking, ever.

**The port, in order.** 1. ~~Vite, TypeScript and React in the framework; the hub, settings and account pages ported first with the hub browser suite as the guard; legacy apps still copied as plain files during the transition~~ (done: `ui/` is the React layer, `hub/` the pages, `scripts/dev.mjs` the dev server, all five browser suites green on the React hub). 2. ~~The widgets as components: markdown editor, lists and collections with pinning, feed~~ (done: `ui/widgets/`, tested on the gallery page by `test/e2e/widgets.mjs`; the list and markdown logic, strings and styles moved out of Loadout into `shared/`, and Loadout already runs on them). Image upload waits for a Blossom server to test against. 3. `boards` on the widgets, moved into the framework. 4. `notices` and Payload; pong keeps its canvas and gets the React shell. 5. chat, feed, market and blog as React apps on the widgets. Relay lists (NIP-65) and signer abstraction are data layer work and run alongside.

## Decision: nostr + Blossom, not gun

The first versions of every tool here ran on [gun.js](https://gun.eco). It worked, but:

- **gun is barely maintained** — one release in two years, and bugs (offline writes never replayed, `user.auth` races) had to be worked around in every app.
- **Relays forget.** gun relays are caches with no retention promise and no way to ask "what do you still have?", so every app had to carry its own heal-and-backup machinery.
- **No story for pictures or feeds.** A grow diary with photos (Outpost) or a chat (Uplink) needs blob storage and query-by-author/tag/time, which gun's graph does not give.
- **One implementation.** If gun's relay code breaks, every relay breaks with it.

[nostr](https://github.com/nostr-protocol/nips) fixes all four with less code on our side:

- Everything is a **signed JSON event**. Relays verify signatures, so forgery is rejected at the door and any device can re-publish any event it holds (healing needs no special trust).
- **Replaceable and addressable events** (kinds 30000–39999 with a `d` tag) give us "newest version of this thing" for free; **ephemeral events** (20000–29999) give us signaling that relays never store.
- **Filters** (`authors`, `kinds`, `#d`, `since`) let a device ask for exactly what it is missing.
- **Many relays, many implementations** (strfry, nostr-rs-relay, khatru…), run by many people. Users pick theirs; we can run some as a [kiwi-network](https://github.com/derlocke-ng) module; nothing of ours is a single point of failure.
- **[Blossom](https://github.com/hzrd149/blossom)** servers store blobs by SHA-256, authorised by nostr keys — pictures and file drops without inventing storage.
- Relays also don't promise retention — nostr is not a blockchain — so the local-first design below stays: **every device is the source of truth for its own data**, relays are the transport and the cache.

Costs accepted: nostr relays see the same metadata gun relays saw (who writes which addresses when, from which IP). Content is encrypted before it leaves the device, always.

## The shared core (`shared/`)

| Module | Responsibility |
|---|---|
| `nostr.mjs` | nostr-tools 2.25 + noble crypto, bundled by `scripts/vendor.mjs` (esbuild). The only third-party code in the core. |
| `events.js` | Kind numbers, event helpers (`makeAddressable`, `sign`, `stamp`), AES-GCM content encryption (`seal` / `open`), HKDF key derivation. |
| `store.js` | `LocalStore`: IndexedDB (`wjs`) with the device's copy of every event it cares about, an outbox of events not yet accepted by each relay, and small metadata. |
| `relays.js` | `RelayPool`: the user's relay list (`localStorage` `wjs.relays`), connections with ping/reconnect, latency, NIP-11 info (name, country) for the server picker, publish to all with per-relay results, de-duplicated subscriptions. |
| `account.js` | Device key, username + password accounts (below), nsec / ncryptsec import and export. The scrypt derivation runs in `account-worker.js`, so signing in never freezes the page, and reports progress. |
| `pow.js` | NIP-13 proof of work for any app: `minePow` mines in parallel workers (`pow-worker.js`; at least four, every core but one, or the device setting `wjs.pow.cores`), serialising the event once and patching only the nonce digits into the bytes. Each worker measures the bundled SHA-256 against the browser's native one and uses the faster: with the JavaScript JIT off (Tor Browser's safer levels) pure JS hashing drops seventy-fold while WebCrypto does not. `hasPow` checks what arrives. |
| `sync.js` | `Sync`: publish = store locally + send to every relay + queue what failed; flush the outbox on (re)connect; heal relays with the device's copy of watched authors. |
| `util.js` | base64url, ids, safe `localStorage`. |

Apps import these as ES modules; nothing is built except the vendored bundle. Each app's service worker caches `../shared/` too, so the suite works offline.

## Identity and accounts

**Every device has a key** (secp256k1, generated on first visit, kept in `localStorage` as `wjs.identity`). With nothing else, a device already works: its boards are published under this key and encrypted to it.

**An account is a username and a password**, implemented on plain nostr events without any registry or name uniqueness:

```
salt      = sha256('wjs/account/v1|' + normalize(username))
seed      = scrypt(password, salt, N = 2^16, r = 8, p = 1, dkLen = 64)
lookupSk  = seed[0..32]        → a nostr key pair that only this username+password can derive
wrapKey   = seed[32..64]       → encrypts the real key

account event: kind 30790, d = 'account', signed by lookupSk,
               content = seal(wrapKey, { v: 1, sk: <device secret key>, alias })
```

Sign-in derives the same lookup key, asks the relays for `{ kinds: [30790], authors: [lookupPk] }` and decrypts. Properties:

- **Nobody can find, squat, spam or overwrite an account without the password.** The lookup pubkey is unguessable, and relays only accept the event from its own key. Two people choosing the same username get two unrelated events — no uniqueness to fight over, nothing to DoS.
- **Offline brute force** is possible for anyone who already has the event (they'd have to find it first): scrypt 2^16 makes guesses slow; passwords are at least 10 characters; there is no reset.
- Signing in on a device that already had boards **carries them into the account** (the device's key is replaced by the account's; its events are re-published under the new key).
- The usual nostr logins exist too: paste an `nsec`, hex key or `ncryptsec` (NIP-49). NIP-07 (browser extension) and NIP-46 (remote signer) are planned but not built.

Each app derives its own keys from the account key with HKDF labels (`wjs/self`, `wjs/loadout/read`, …), so a leak of one app's key never exposes another's.

## Content encryption

NIP-44 caps payloads at 64 KB and is built for two-party messages, so content uses WebCrypto directly:

```
key      = HKDF-SHA256(secret, info = label, 32 bytes)
payload  = base64url( version || iv(12) || AES-256-GCM(key, iv, body, aad = version) )
version  = 0x01: body is UTF-8 JSON     0x02: body is gzip(JSON)   (gzip when JSON > 1 KB)
```

Everything in an event's `content` is a sealed payload; tags carry only the `d` address and a version. Relays and crawlers see sizes, timestamps and addresses, nothing else.

## Event kinds

| Kind | Name | Type | Used for |
|---|---|---|---|
| 30700 | `LOADOUT_WALLET` | addressable | one entry per board in a user's wallet; `d` = sha256 slot of the board pubkey |
| 30701 | `LOADOUT_INFO` | addressable | board title, type, mode (`d` = `info`) |
| 30702 | `LOADOUT_ITEM` | addressable | one list / inventory item per event (`d` = item id); `{ del: 1 }` is a tombstone |
| 30703 | `LOADOUT_DOC` | addressable | the markdown note of a board (`d` = `doc`) |
| 30790 | `ACCOUNT` | addressable | username + password account (above) |
| 30791 | `SETTINGS` | addressable | per-app settings, encrypted to the user's key; `d` = app name (Loadout: starters and their templates; DevBoard: saved notes) |
| 30810 | `DEVBOARD_POST` | addressable | a public DevBoard note: `d` per note, NIP-40 `expiration`, one `t` tag per skill, NIP-13 `nonce`; JSON content `{ type, title, text, tags, rate, contact }` or `{ del: 1 }` as a tombstone |
| 21700 | `P2P_PRESENCE` | ephemeral | Payload / pong room presence — planned |
| 21701 | `P2P_SIGNAL` | ephemeral | encrypted WebRTC offers / answers / ICE — planned |
| 21702 | `P2P_DATA` | ephemeral | encrypted data frames when WebRTC fails — planned |

Addressable events replace by `(kind, pubkey, d)` with the newest `created_at` winning. `created_at` has one-second resolution, so `stamp(address)` hands out a strictly increasing timestamp per address on each device; two devices editing within the same second still tie-break deterministically (lowest id), which is the same rule relays apply.

## Local first, offline, heal, backup

1. **Every write goes to IndexedDB first**, then to every connected relay. Relays that were offline or rejected the event for a transient reason get it from the **outbox** when they next connect.
2. **Reads come from IndexedDB** and are updated by live subscriptions; the UI never waits for a relay.
3. **Heal.** On every relay (re)connect each device re-publishes its copy of every "watched" author (its own key, its account event, every board in its wallet), throttled to once per 30 minutes per relay and author. Relays treat duplicates as no-ops and newer versions as replacements, so healing is idempotent and can never roll back an edit. A relay that lost its disk is repaired by the first device that reconnects.
4. **Backups** are the raw signed events of everything the user owns plus a readable snapshot, encrypted (AES-256-GCM, PBKDF2-SHA-256 600 000 rounds) with a passphrase. Restoring re-publishes the events, so even the account itself comes back after every relay and every device is gone.

Data is lost only if every device that ever held it is gone *and* there is no backup.

## Decided for the social layer

- **Friends are mutual**: request and accept, both sides hold each other, delivered as gift wraps so relays see neither who asked nor who answered. The list itself is an encrypted event under the user's key; nostr's public follow list is never used. Each person has a friends key for friends-only content, handed to friends privately and rotated when someone is removed.
- **Marketplace listings carry coarse plaintext tags**: category, seller country and shipping destinations (country codes, `EU`, worldwide, pickup only), so relays can filter and a phone downloads only what applies to it. Everything else in a listing is encrypted. Accepted trade-off: relays learn that some key lists seeds in a country.
- **Device settings are site-wide**: language (`wjs.lang`) and theme (`wjs.theme`) are chosen on the hub or in any app and apply everywhere, live across tabs through the storage event. They stay on the device; account settings (kind 30791) are for things that should follow the account.

## Moderation

nostr has no central moderation; it has three layers, and the suite uses all three:

- **Your block list** (NIP-51 mute list, kind 10000). Ours keeps every entry in the encrypted private part, so relays and other people never learn who you blocked; other nostr clients that know your key read the same list. Apps consult it before showing a post, accepting a message or a friend request: blocked people cannot write to you, cannot add you, and their Outpost posts and listings stay out of your feeds. Managed in the settings; later also from a post or profile with one tap.
- **Reports** (NIP-56, kind 1984): "spam", "illegal", "impersonation", "nudity", "malware", "profanity" or "other", about a person or one event, with an optional note. Reports are public, signed by the reporter, and go to the relays: relay operators act on them (strfry policies, bans), and clients can hide what many people they trust reported. Outpost gets a report action on posts and listings.
- **Relay policy**: each relay decides what it stores and who may write (rate limits, bans, allow-lists); the kiwi-node `relay` module will ship with a sane policy and read reports.

`shared/moderation.js` holds the list and the report builder.

## People: friends, circles, sharing

One library for every app, `shared/people.js`, with its UI in `people-ui.js` and its cards in the site settings:

- **Friends are mutual.** A request and an accept travel as NIP-59 gift wraps (kind 1059) carrying rumors of our own kinds (7801 request, 7802 accept, 7803 remove, 7804 share), so relays see only that some key received a wrapped note: not who asked, not who answered, not a name. nostr's public follow list is never used. Removing a friend tells the other side, which drops you too. A request from someone you blocked is dropped unread; an accept you never asked for counts as a request.
- **The lists are the account's.** Friends (with the name they gave themselves), circles, pending requests, received shares and the ids already handled are one encrypted settings event (kind 30791, `d` = `people`), so every device signed in as you agrees and nothing is public.
- **Circles** are groups of friends, local to you, for sending to several people at once.
- **Sharing** is `people.share(app, payload, pks)`: one wrap per recipient. The recipient's People keeps the share until that app takes it (`people.onShare(app, fn)` replays what waited, then `consume(id)`); any page shows a notice with an "Open" action (`payload.url`) for shares to apps that are not open. Loadout sends a board (link plus keys for the chosen role; the friend's Loadout adds it to the wallet), Payload a transfer link; Outpost's friends-only posts and the marketplace's invite listings will read the same list.
- **Where it shows.** The site settings hold your key to hand out, requests, friends and circles. Apps get `shell.people` and `shell.blocks` from the app shell, `pickPeople()` to choose recipients, and `people.isFriend()` / `nameOf()` to mark friends (DevBoard tags friends' notes, filters by friends, and adds a friend from a note's menu).
- Still open: a friends key for friends-only content (rotated when someone is removed) once Outpost needs it, and NIP-17 inbox relays (kind 10050) so friends on different relay sets still reach each other; today both sides are assumed to share a relay.

## Languages

Every app ships its strings as one JSON catalog per language (`apps/<app>/locales/<lang>.json`) plus a shared catalog for common words and the core's error messages (`shared/locales/`). `shared/i18n.js` loads the active language and English as the fallback, nothing else, so a device downloads one small file per app (10–20 KB) and caches it offline.

- **Choice.** The browser's language list picks the first supported language. A browser set to a supported non-English language gets the app in that language straight away plus a one-time banner, in that language, to keep it or pick another. English browsers are never asked. The choice is stored on the device only (`wjs.lang`), with a selector in the settings; the shell step moves it into the suite settings.
- **Content.** Plural forms follow CLDR categories through `Intl.PluralRules` (Polish needs `few`/`many`), dates and relative times through `Intl.DateTimeFormat` / `Intl.RelativeTimeFormat`. Shared code throws errors with a stable `code` and the UI translates by code (`tErr`), so the core never contains UI language.
- **Languages.** English, German, French, Spanish, Italian, Dutch, Polish and Portuguese, the EU's big languages plus the UK, US and Canada. More are one JSON file each; a unit test checks that every language has every key with the same placeholders, markup and plural forms. Translations are machine-drafted and reviewed, corrections welcome by pull request.
- **Region is separate from language.** Country for the marketplace and the legal declaration come from settings, never from the UI language.

## Design library

Every page looks and navigates the same because every page uses the same pieces from `shared/`:

| File | What |
|---|---|
| `ui.css` | tokens (light, dark, explicit theme), base styles, buttons, inputs, forms, segmented control, cards, banners, modal, menu, toasts |
| `ui.js` | `$`, `$$`, `h()` escaping, `icon()`, `toast()`, `modal()`, `confirmDialog()`, `copyText()`, `download()` |
| `topbar.js/.css` | the top bar: switcher button, brand, right-hand slot; one height everywhere |
| `switcher.js/.css` | the app sheet: start page, apps not hidden, settings; hardware back closes it |
| `appshell.js` | `initAppShell()`: theme, language, top bar and the account's hidden apps / language / theme in one call |
| `theme.js`, `i18n.js`, `settings.js` | the device and account settings behind it |

An app plugs in with three lines: `@import url('../shared/ui.css')` at the top of its stylesheet, `<header id="top"></header>` at the top of its body, and `await initAppShell({ current, brand, right })` before it draws. The icon sprites come from `scripts/vendor.mjs` (lucide). Payload and pongjs are on it already; pongjs keeps its CRT look by giving the library its own token values.

### The app kit

One registry, `shared/apps.js`, lists every app: id, name, icon (a lucide symbol in `hub/icons.svg`), tags and flags. Everything that shows an app reads it, so nothing is written twice: the start page's cards (`hub/hub.js`), the app switcher, the Apps toggles in the site settings, the top bar mark (`initAppShell({ app: 'devboard' })` takes name and icon from the registry), the favicon (`npm run icons` draws `apps/<id>/icon.svg`, and PNGs where an app's manifest lists them, from the same symbol) and the site service worker's precache list (`npm run sw` rewrites it; a unit test keeps it current). Every app's settings view is `settingsView()` from `shared/settingsview.js`: back button and title, the identity card with the link to the site settings, the app's own cards, "How it works" last; the strings for the shared parts are shared. "How it works" is assembled, not written per app: `shared/how.js` has one short text per piece of technology (encryption, account, relays, offline, media, backup, link keys, rooms, signed posts, proof of work, expiry, friends, blocks, private messages) and a starting list per kind of app (`HOW.hub`, `boards`, `notices`, `feed`, `market`, `chat`, `blog`, `rooms`). An app lists the topics it is built from and adds lines only for what is its own (Loadout's edit and view links, DevBoard's votes), so when the code behind a topic changes, one text changes everywhere. The hub's card shows `HOW.hub`, or the distribution's `how`. What concerns the device or the account as a whole (language, theme, relays, backup, blocked people, proof-of-work cores) is a site setting, never an app's. `npm run new-app -- <id> "<Name>" <icon>` scaffolds all of this; what remains is the app itself, its translations and a browser test.

## One account for the suite

The hub (the installed app's start page) and every app share one origin, so `localStorage` holds one identity (`wjs.identity`) and IndexedDB one event store for all of them. Signing in or creating an account on the hub switches that identity; `adoptIdentity()` keeps the previous key aside and each app carries its own data over on its next start (`previousIdentities()` / `markCarried()`): Loadout re-publishes the wallet entries of the old device key under the account key. Signing in inside an app does the same. Nothing is lost by signing in late.

Publishing is local-first and never blocks the UI: an event is stored, marked pending for every relay, and sent; relays acknowledge in the background and leave the outbox as they do. Only the account event waits, and only for the first relay that accepts it, because other devices must be able to find it.

## Relays and servers

The default relay list is a handful of large public relays. The settings screen shows each relay's latency and its NIP-11 name and country, lets users add their own (including a `ws://localhost` dev relay), and is the seed of the **server picker**: choose relays by speed and jurisdiction, same for TURN once it is in. Media (Blossom) servers have their own card next to it: the person's list follows the account (`mediaServers` in the suite settings, the distribution's `media` until then), and a check uploads a tiny file with their key and deletes it, telling apart servers that take any file (so encrypted ones), photos only, payment, refusal and unreachable or blocking this site (CORS).

A kiwi-node `relay` module (strfry relay + blossom-server + coturn, `module.yaml` + `docker-compose.yml.j2`) will let any kiwi-master or kiwi-node host the whole stack; the apps then list those servers first. Nothing in the apps depends on a server of ours existing.

`scripts/nostr-relay.mjs` is a small spec-conformant relay (NIP-01 + NIP-11, JSONL storage) used by the tests and for development.

## Loadout on nostr

A board is a nostr key pair. Whoever has the secret key (`?w=`) can publish `30701/30702/30703` events for it — relays reject anything else, so write protection is the relay's signature check. The read key is `HKDF(w, 'wjs/loadout/read')`; view links carry only that (`?k=`), so viewers can decrypt but not sign. Without a key the board shows as locked, and the relay only ever holds ciphertext — the e2e test verifies both.

Items are one event each (not one blob per board), so two people editing different items never conflict and a device only transfers what changed. Deleting a board publishes a tombstone `info` and strips its items; wallets of other devices drop it via their own tombstone entries.

## DevBoard

The freelancer noticeboard is public by nature, so its defence is not encryption but cost and consensus, applied by every reader (`apps/devboard/`):

- **A note** is a kind 30810 event (see the table) that lives 24 hours to 30 days; relays drop it at `expiration`, readers drop it even if a relay does not. Editing republishes under the same `d`; deleting publishes a `{ "del": 1 }` tombstone that supersedes the note and is kept in memory so an older copy cannot resurrect it.
- **Proof of work** (NIP-13): 16 leading zero bits per note, 8 per vote or report, mined by the shared engine (`shared/pow.js`): a fraction of a second on a laptop, under a second on a phone even in Tor Browser, hours for a flood. Events below the bar are not shown, whatever a relay accepted. The bar is a constant in the client, so a relay policy can enforce the same numbers server-side later (strfry plugin). The cores to mine with are a site setting (the proof-of-work card), since the engine is shared.
- **Three live notes per person**; the newest three count and the rest collapse. **Votes** are NIP-25 reactions with `+`/`-`, one per person and note (the newest wins, empty content takes it back), capped at ten per half minute per device. A note at −5 collapses; so does one that three or more people reported (NIP-56, with the note's address). Collapsed notes can be opened anyway; your own never collapse for you.
- **The suite's moderation applies**: a blocked person's notes, votes and reports vanish on every device (encrypted NIP-51 list), and blocking is one tap from any note. Saved notes are account settings (kind 30791, `d` = `devboard`).
- **Its own settings** (`#/settings`, behind the account button, on the shared settings view): defaults for new notes (type, contact, duration; kept in the account) and collapsed notes shown opened. Account, relays, language, backup, blocks and proof-of-work cores stay in the site settings.
- **Contact** is whatever the poster wrote (mail, handle, npub), shown only on request, with a reminder to check who you are talking to; Uplink becomes the in-app path once it exists.

## Roadmap

Next, in this order: ~~the rename of the distribution; the repository split with `distribution.js` as the config and the catalog manifest~~ (done: kiwi-framework, Armory, kiwi-web-catalog); relay lists per user and relay hints in links; spaces and mounts in the event design; the widget and module extraction (markdown and lists out of Loadout first, then collections with pinning, then the feed for Outpost and DevBoard); the chat on the same parts; the blog on the markdown editor and the feed.


1. ~~Shared core; Loadout on nostr~~ (done — `test/e2e/loadout.mjs` runs 17 multi-device scenarios against the dev relay, including two relay wipes).
2. **Payload and pongjs on nostr**: presence and signaling as ephemeral events 21700–21702 (encrypted to the room secret), data frames over 21702 when WebRTC fails, TURN servers from the picker; Payload gets a **drop** mode — encrypted chunks on a Blossom server with an expiry — for receivers who are not online right now. Then gun, `shared/gun.js` and `scripts/relay.cjs` go.
3. **chat** (Uplink in Armory): NIP-17 private messages between accounts, ephemeral encrypted rooms (what EnigmaJS did), groups later.
4. **feed** and **market** (Outpost and Trading Post in Armory; grow reports first): entries and photos encrypted before upload to Blossom, friends list, visibility layers (private / friends / "public" = readable by anyone signed into the app), feed and explore; marketplace for seeds, cuttings and gear behind an 18+ / legal-region declaration and a no-liability agreement. Cuttings are an ordinary category everywhere: whether a listing is legal where the user lives is the user's call under that agreement, not the software's. Backups include blobs.
5. ~~Suite shell~~ (done): one account for every app, app switcher, hidden apps and language in settings (kind 30791), People and Circles (see *People* above).
6. **kiwi-node `relay` module**; replace the first default relays with kiwi ones.
7. ~~DevBoard on nostr~~ (done — see *DevBoard* above; `test/e2e/devboard.mjs` covers notes, votes, reports, blocking and the cap on two devices). Still to come for it: a relay policy that enforces the same proof of work and caps server-side, and trust-weighted report counts once People and Circles exist.

Open: contact path for marketplace listings (in-app Uplink vs. external). Which public Blossom servers take encrypted files is answered per server by the check in the settings (Network, Media servers) and by `scripts/blossom-probe.mjs`; uploads fall back to an unencrypted photo only when the person agrees.
