# Working on kiwi-framework

What a session needs to know to continue this repository without the conversation that built it. The product is in `README.md`; the decisions in `docs/architecture.md` (read its *Roadmap* first); what is on the wire in `docs/protocol.md`. This file is about how the work is done.

## The repositories

| repository | what | how changes land |
|---|---|---|
| `derlocke-ng/kiwi-framework` (this) | the engine, the hub pages, the framework's apps, the build, the test harness | pushed to `main` directly; CI releases every new version |
| `derlocke-ng/armory` | the first distribution and the template; GitHub Pages at <https://derlocke-ng.github.io/armory/> | pushed to `main` directly; Pages deploys from it; pins the framework to one commit |
| `derlocke-ng/kiwi-web-catalog` | the web catalog: kiwi-framework, Armory and Armory's apps (`apps.list`, one `path=apps/<id>` line per app, each folder with its `kiwi.manifest`) | pushed to `main` directly, whenever Armory gains or retires an app |
| `derlocke-ng/kiwi-modules` | kiwi-node modules (`nostr-relay`, `hub`), the `hub` preset | **ask the owner first**, every time: no push, tag or release there without a yes |
| `derlocke-ng/kiwi-server` | vendors kiwi-modules by tag (`tools/vendor.sh`, `VENDORED`) | **ask the owner first**, every time, a branch included |

Every framework change that a hub should get ends with Armory re-pinned and deployed (below). A session pushes to kiwi-framework, Armory and kiwi-web-catalog (which lists Armory and its apps: a new or retired Armory app changes `apps.list` there), straight to `main`; for any other repository (kiwi-modules, kiwi-server, kiwi-stack, anything else) it asks the owner first and pushes nothing there without a yes. When another repository needs a code change, write it up in `handoffs/<repository>-<topic>.md` here (see `handoffs/README.md`), push that, and name the file in the report: the session for that repository works from it. If the owner has connected a session on their computer (Remote Control) or approves a cloud session for the other repository, the same file is that session's brief. Never open a pull request unless asked; never push a tag by hand (CI does).

## Commands

```sh
npm ci
npm run typecheck && npm run lint        # tsc, biome (npm run lint:fix formats)
npm test                                 # node --test test/unit/*.test.js (fast, no browser)
npm run test:smoke                       # a distribution from scratch builds (test/smoke.sh)
node test/e2e/<suite>.mjs                # one browser suite: widgets, boards, notices, payload, pong, chat, hubs, reach, spaces, feed, market, scaffold
npm run test:e2e                         # all of them, in that order
WJS_DEBUG=1 node test/e2e/<suite>.mjs    # the sync layer logs every publish and answer; printed when a step fails
```

Everything the suites need runs locally (relays, media servers, several hubs); never point a test at a public relay or server. When something can only be checked on a real deployment (the image with `HUB_*` behind a kiwi-node's proxy, a phone against a public hub), ask the owner: they can set up a public or VPN'd test hub.

Run browser suites one after another, never two in parallel in one container (the widgets suite flakes under load, nothing else does). A suite that fails prints each device's console, its relay sockets, the addressable events it holds and what the relay holds: read those before guessing. CI (`.github/workflows/test.yml`) runs the same four things and, on `main`, tags `v<package.json version>` and publishes a release with the commit message as notes when that tag does not exist yet.

## A release

1. Bump `version` in `package.json` **and** `VERSION=` in `kiwi.manifest` (same number; the smoke test and `hub.json` read the manifest).
2. Everything green locally: typecheck, lint, unit, smoke, the suites the change touches (all of them for a release that touches `shared/` or `ui/`).
3. One commit on `main`: the message is the release note (below). Push. Watch the run; the release appears when it is green. CI tags the first green commit carrying the new version, with that commit's message as the notes: if a release commit fails CI and a fix follows, the fix's message becomes the release notes, so repeat the release's notes in it (0.19.0's release page shows only its test fix; the real notes are commit fbf2d0f).
4. Re-pin Armory (below), run its suites, commit, push, check the live site serves the new `framework` version in `hub.json`.

### Pinning Armory

```sh
cd ../armory
npm install git+https://github.com/derlocke-ng/kiwi-framework.git#<full sha of the release commit>
# npm writes "github:derlocke-ng/kiwi-framework#<sha>"; keep the git+https form so a checkout without GitHub credentials still installs:
sed -i 's#"kiwi-framework": "github:derlocke-ng/kiwi-framework\#\([0-9a-f]*\)"#"kiwi-framework": "git+https://github.com/derlocke-ng/kiwi-framework.git\#\1"#' package.json
# package-lock.json: the "resolved" of node_modules/kiwi-framework the same way (git+https://…git#<sha>)
npm ci && npm run build && npm test
node test/e2e/hub.mjs && node test/e2e/loadout.mjs && node test/e2e/devboard.mjs && node test/e2e/payload.mjs && node test/e2e/pong.mjs && node test/e2e/uplink.mjs
```

Armory's suites import the framework's (`kiwi-framework/test/e2e/*.mjs`) and run them against Armory's built site; `test/e2e/hub.mjs` is Armory's own. Deploy is `.github/workflows/deploy.yml` on push to `main`; `curl https://derlocke-ng.github.io/armory/hub.json` shows the deployed versions after a minute or two.

## Commit messages

The first line is a sentence saying what changed for a person using it, ending with the version when it is a release (`…; 0.18.0`). The body explains the why and the how in plain prose or short dashes, names the files or modules that matter, and lists what the tests prove. No model names anywhere in the repository (commits, code, docs); end the message with the attribution lines the session is given (`Co-Authored-By:` and `Claude-Session:`), which CI strips from the release notes. Write the message to a file and commit with `git commit -F` (heredocs with quotes in a shell command have tripped the tooling's safety filter; the same goes for edits: write a small Python patch script to a file and run it, rather than a long heredoc).

## How the code is written

- Plain CSS, React in `ui/` and the pages, the data layer in `shared/` stays plain JavaScript with JSDoc types (it is served as files too). Comments explain why, in prose; every module starts with a paragraph saying what it is for.
- Strings: every user-visible text is a key in a JSON catalog, in **all eight languages** (`shared/locales`, `hub/locales`, `apps/<app>/locales`); `test/unit/i18n.test.js` fails on a missing key, a differing placeholder or markup. Translate yourself, carefully; typographic quotes and apostrophes (’ “ ” „ “ « »).
- "How it works" texts are topics in `shared/how.js` (`how.<topic>` in `shared/locales`); an app lists the topics it is built from.
- Icons are lucide symbols in `hub/icons.svg`; use one that is there or add the symbol.
- Biome formats (160 columns, single quotes); run `npm run lint:fix` before committing.

## Invariants of the data layer (do not break these)

- **Listen before read.** Every module subscribes to the store's change feed first, then reads the store, then subscribes to the relays; otherwise an event landing between read and subscribe is lost (`shared/settings.js`, `chat.js`, `people.js`, `groups.js`, `spaces.js`, `apps/notices/data/notices.js` all do this).
- **Newest wins, per address.** Replaceable events are compared with `supersedes()` (created_at, then lower id); a device stamps new versions after every version it has seen (`stamp()`/`observe()`), never by its clock alone.
- **Store first, atomically.** `store.put(event, network, { pending })` writes the event, its network and its outbox entry in one IndexedDB transaction; the UI reads the store and never waits for relays; the outbox flushes on (re)connect and on a timer; healing republishes only what a relay lacks.
- **Networks never cross.** Every event belongs to one network (`hub`, `public`, or `space:<id>`); publishing, the outbox and healing stay inside it. The account's settings, friends, block list and sealed notes live on the hub's network (`kiwi.hubNet`); a page's content network is `kiwi.net` (`kiwi.content`), its people network `kiwi.network`.
- **Settings are patch-over-newest.** `AccountSettings.set()` applies at once, keeps a patch in localStorage and publishes after the relays' first answer on top of the newest event (0.17.2); never write a whole settings object from a device that has not synced.
- **Guests, not members.** A relay named by a hint or an inbox list is a guest connection carrying one subscription or event (`pool.subscribeAt/publishAt/fetchAt`); the pool's own networks never grow from links.
- **Tests never reach real services.** The harness gives every device `wjs.directory = []` (no real directory relays) unless a suite sets `env.keepDirectories`; nothing in a test may publish to a public relay or probe a Blossom server. Do not run `scripts/blossom-probe.mjs` from a container either.

## Pitfalls met before

- nostr-tools' `Relay.url` ends in a slash; the pool's keys do not. Compare through `normalizeRelayUrl` or `pool.networksOf(url)`.
- `normalizeRelayUrl('https://x')` must return null (another scheme is not a relay).
- A test device whose browser context was closed cannot be reused: make a fresh one.
- In the Bash tool, parallel calls share a shell: wrap every command in `( cd /abs/path && … )`.
- Relay-delivery "flakes" in suites have always been real bugs so far (transaction interleaving, read-before-subscribe, last-decrypt-wins, settings overwrite); chase them, do not retry them away.
- Never `assert.equal(await page.$(…), null)`: when it fails, node's assert inspects the element handle to a depth of 1000, walks Playwright's whole connection and the machine runs out of memory (a killed process, no failure message). Use `absent(page, selector)` from `env.mjs`, or compare counts.
- Test devices are 420 px wide: the suites see the phone layout (round buttons, no footer, `phone-hide`). Loadout's "New list" is the round button's menu there: `startBoard(page, 'check' | 'note')` from `env.mjs`. A menu item names itself with `act` (`data-act`), so a test clicks it in any language.

## Where things are

`shared/` data layer (events, store, sync, relays, relaylists, peers, spaces, audiences, sealed, social, countries, settings, account, people, chat, groups, moderation, pow, blossom, backup, i18n, hubconfig, distribution-check) · `ui/` React layer apps import (`kiwi.ts` is the runtime, `hooks.ts`, `AppShell.tsx`, `AccountGate.tsx`, `SecureGate.tsx`, `BackLink.tsx`, `spaces.ts`, `useEvents.ts`, `useOpened.ts`, `route.ts`, widgets incl. `Panel` and `PhotoGrid`) · `hub/` the start, settings and account pages · `apps/` boards, notices, chat, feed, market, payload, pong · `scripts/` build (`build-site.mjs` writes `hub.json`), dev server, scaffolder (`new-app.mjs`), the test relay and Blossom server · `container/` the image recipe and `entrypoint.sh` (`HUB_*` → `hub.local.json`) · `handoffs/` changes other repositories need, for their sessions · `test/unit`, `test/e2e` (`env.mjs` is the harness: `setup`, `device`, `testHub`, `run`, `absent`, `startBoard`).

## Roadmap state (keep this current)

Done through 0.19: accounts and password change, people, chat (messages, groups, rooms, invitations), boards, notices, hubs private/public/semi-public, hosting (container, `hub.local.json`, kiwi modules), relay lists and link hints, spaces (definitions, the `a` tag, space relays as networks, links that resolve to a mount; notices is on spaces), audiences (`shared/audiences.js`: friends, circles, only me, keys handed out and rotated) and the **feed** (`apps/feed`, Armory's Outpost), account-only mounts (`requireAccount`, `ui/AccountGate.tsx`), and in 0.20 the **market** (`apps/market`, Armory's Trading Post: listings sealed to the space, keyed search labels instead of plain tags, the chat with a drafted message, account-only, no age check by the owner's decision), 18+/ad labels on feed entries (shown to people with an account only), and the app feel the owner asked for: posts open in a panel over their list (`ui/widgets/Panel.tsx`, `goBack()`, `useHash({ scroll: false })`), dialogs are sheets from the bottom on a phone, the main action is a round button there (`.fab`); look at a change on a 390 px phone screenshot before calling it done. In 0.21: **marks** (an unlabelled entry is marked 18+ or an ad by two reports or by a space moderator, NIP-32 kind 1985, `shared/social.js`; moderators get a Reported tab), hub-wide `moderators` (npubs or hex, every space the hub defines; the owner's npub is Armory's), and the app feel in every app (the shell's `.app-bar`, `.fab`, `.fab-phone`, `.phone-hide`, `.page-enter`, `ui/BackLink.tsx`; the start page a list on a phone; no site footer in an app on a phone), and a hub opened over plain HTTP says it needs HTTPS (`ui/SecureGate.tsx`). Next, in order: **Payload as a file share** (the owner's ask, November 2026: files in Uplink's conversations and groups, for any app that wants it, and standalone; off gun onto nostr, kinds 21700–21702, with encrypted Blossom uploads for recipients who are away), then (see `docs/architecture.md`, *Roadmap*) diaries in the feed with the collections widget and pinning, the chat on the same parts, the blog, then approvals (kind 4550) as moderation and `policy.userMounts`. Open with the owner: "seller accounts" (today anyone with an account lists; approvals could make sellers moderator-approved), and a public relay for Armory's spaces (`handoffs/kiwi-modules-public-hosts.md`; nginx as kiwi-modules has it, never Caddy). kiwi-modules 0.4.1's `hub` module passes `HUB_ACCOUNT_MOUNTS`, `HUB_REQUIRE_ACCOUNT` and `HUB_SPACE_RELAYS` (pushed in November 2026 before the owner asked to be asked first; it stays). Payload and pong still signal over gun; their move to nostr (kinds 21700–21702) is open.
