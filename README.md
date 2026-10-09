# kiwi-framework

The engine and the parts of a federated community hub on nostr. It ships nothing a user opens by itself: a **distribution** adds a name, relays and apps and gets a hub. [Armory](https://github.com/derlocke-ng/armory) is the first distribution and the template to fork. Part of the [Kiwi Network](https://kiwi-network.eu).

## What is in it

| Folder | What |
|---|---|
| `shared/` | the library every page imports: identity and accounts (`account.js`), relays and sync (`relays.js`, `sync.js`, `store.js`), settings that follow the account (`settings.js`), people (friends, circles, sharing: `people.js`), moderation (`moderation.js`), proof of work (`pow.js`), i18n and theme, the design kit (`ui.css`, `ui.js`), the app shell (`appshell.js`, `topbar.js`, `switcher.js`, `status.js`), the settings view every app has (`settingsview.js`), the registries (`apps.js`) and the nostr bundle |
| `ui/` | the React layer: the runtime (`bootKiwi`), hooks over the data layer (`useIdentity`, `useT`, `usePeople`, `useBlocks`, `useUnsynced`, …) and the shared components (`TopBar`, `StatusPill`, `AccountLink`, `Toasts`, `RelayList`). Apps use this, never `shared/` below it |
| `hub/` | the hub pages every distribution gets, in React and TypeScript: start page, settings, account; the service worker template, icon sprite, strings |
| `scripts/` | `build-site.mjs` assembles a distribution's site; `new-app.mjs` scaffolds an app; `app-icons.mjs` draws favicons from the sprite; `vendor.mjs` rebuilds the third-party files; `nostr-relay.mjs` and `relay.cjs` are the local relays for development and tests |
| `test/` | unit tests for the library, the browser test harness (`test/e2e/env.mjs`) distributions use for their suites, and the smoke test that builds a distribution from nothing |
| `docs/protocol.md` | the wire protocol: every event kind, tag, content format, key derivation and file format, versioned; a new client could be written from it |
| `docs/architecture.md` | the decisions: nostr, accounts, spaces and mounts, federation, people, moderation, the app kit, the long-run rules and the port to Vite, TypeScript and React |

## Using it in a distribution

```sh
npm install git+https://github.com/derlocke-ng/kiwi-framework.git#<tag or commit>
```

Pin a release tag (or a commit between releases); `v0.1.0` is the last plain-JavaScript hub, the React hub comes after it. To run the browser harness (`test/e2e/env.mjs`) a distribution also needs `playwright-core` and `gun` as dev dependencies; Armory's `package.json` has both.

A distribution is a repository with `distribution.js` (name, relays, the apps it ships and the mounts it shows), `locales/` (its own strings), `apps/<id>/` for each app, and optionally `public/` (files copied over the site root) and `icons.svg` (symbols added to the sprite). Then:

```sh
node node_modules/kiwi-framework/scripts/dev.mjs               # the hub with hot reload, apps under /<id>/
node node_modules/kiwi-framework/scripts/build-site.mjs        # the site in _site/
node node_modules/kiwi-framework/scripts/new-app.mjs outpost "Outpost" sprout
node node_modules/kiwi-framework/scripts/app-icons.mjs         # favicons from the sprite
```

Armory's `package.json` wires these up as `npm run build`, `npm run new-app` and `npm run icons`; copy it.

Framework apps have plain ids and names (`market`, `feed`, `chat`, `blog`); a distribution shows them under its own names through its mounts (Armory: Trading Post, Outpost, Uplink). Every repository and app folder carries a `kiwi.manifest`, the entry format of [kiwi-web-catalog](https://github.com/derlocke-ng/kiwi-web-catalog).

## Working on the framework

```sh
npm install
npm run dev              # the framework's own hub with hot reload at http://localhost:5173
npm test                 # unit tests
npm run typecheck        # TypeScript over ui/ and hub/
npm run lint             # Biome: lint and format (lint:fix writes the fixes)
npm run test:smoke       # a distribution from scratch, with one scaffolded app, builds
npm run vendor           # after bumping nostr-tools, gun, qrcode-generator or lucide-static
npm run build && npm run serve   # the production build at http://localhost:8080
```

The stack is Vite, TypeScript and React 19 for everything visible; `shared/` is plain JavaScript with JSDoc types and stays framework-agnostic, so the protocol code never depends on the UI library. The rules (one seam, a short dependency list, the protocol as the product) are in `docs/architecture.md`, *Decided for the long run*. Apps not yet ported keep importing `shared/` as plain files, which the build still serves at `/shared/`.

To work on the framework and a distribution together, link it: `npm install ../kiwi-framework` in the distribution, then `npm run dev` there.

Releases are git tags (`v0.1.0`); distributions pin one.

## License

GPL-3.0-or-later. Third-party code is listed in `shared/LICENSES.md`.
