# kiwi-framework

The engine and the parts of a federated community hub on nostr. It ships nothing a user opens by itself: a **distribution** adds a name, relays and apps and gets a hub. [Armory](https://github.com/derlocke-ng/armory) is the first distribution and the template to fork. Part of the [Kiwi Network](https://kiwi-network.eu).

## What is in it

| Folder | What |
|---|---|
| `shared/` | the library every page imports: identity and accounts (`account.js`), relays and sync (`relays.js`, `sync.js`, `store.js`), settings that follow the account (`settings.js`), people (friends, circles, sharing: `people.js`), moderation (`moderation.js`), proof of work (`pow.js`), i18n and theme, the design kit (`ui.css`, `ui.js`), the app shell (`appshell.js`, `topbar.js`, `switcher.js`, `status.js`), the settings view every app has (`settingsview.js`), the registries (`apps.js`) and the nostr bundle |
| `hub/` | the hub pages every distribution gets: start page, settings, service worker template, icon sprite, strings |
| `scripts/` | `build-site.mjs` assembles a distribution's site; `new-app.mjs` scaffolds an app; `app-icons.mjs` draws favicons from the sprite; `vendor.mjs` rebuilds the third-party files; `nostr-relay.mjs` and `relay.cjs` are the local relays for development and tests |
| `test/` | unit tests for the library, the browser test harness (`test/e2e/env.mjs`) distributions use for their suites, and the smoke test that builds a distribution from nothing |
| `docs/architecture.md` | the decisions: nostr, accounts, event kinds, spaces and mounts, federation, people, moderation, the app kit |

## Using it in a distribution

```sh
npm install github:derlocke-ng/kiwi-framework#v0.1.0
```

A distribution is a repository with `distribution.js` (name, relays, the apps it ships and the mounts it shows), `locales/` (its own strings), `apps/<id>/` for each app, and optionally `public/` (files copied over the site root) and `icons.svg` (symbols added to the sprite). Then:

```sh
node node_modules/kiwi-framework/scripts/build-site.mjs        # the site in _site/
node node_modules/kiwi-framework/scripts/new-app.mjs outpost "Outpost" sprout
node node_modules/kiwi-framework/scripts/app-icons.mjs         # favicons from the sprite
```

Armory's `package.json` wires these up as `npm run build`, `npm run new-app` and `npm run icons`; copy it.

## Working on the framework

```sh
npm install
npm test                 # unit tests
npm run test:smoke       # a distribution from scratch, with one scaffolded app, builds
npm run vendor           # after bumping nostr-tools, gun, qrcode-generator or lucide-static
npm run build && npm run serve   # the framework's own hub, with no apps, at http://localhost:8080
```

Releases are git tags (`v0.1.0`); distributions pin one.

## License

GPL-3.0-or-later. Third-party code is listed in `shared/LICENSES.md`.
