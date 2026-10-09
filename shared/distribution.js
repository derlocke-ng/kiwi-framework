// The distribution a hub is built from: everything a fork changes and the
// framework never hardcodes. THIS file is the framework's own development
// distribution: the hub alone, no apps. A real distribution (for example
// derlocke-ng/armory) keeps its distribution.js in its repository root, and
// `scripts/build-site.mjs` copies it over this one when assembling the site.
// The model is in docs/architecture.md, "Framework, distributions, apps".
//
//   apps     the app code this distribution ships (folders under its apps/):
//            id, name, icon (a symbol in hub/icons.svg), tags, legacy
//   mounts   what the start page and the switcher show: an app mounted on a
//            space, with a name and icon of its own if it wants. The id is the
//            route on this hub (<id>/) and the i18n key of its card (hub.<id>.text).
//   relays   the default relays until the user picks their own
//   media    the default media (Blossom) servers for photos and files, first
//            choice first, until the user picks their own; empty: no uploads
//   how      the topics of the hub's "How it works" (shared/how.js); null: HOW.hub
//   policy   userMounts: may a user follow a space this hub does not ship?
export const DISTRIBUTION = {
  id: 'kiwi',
  name: 'kiwi-framework',
  shortName: 'kiwi',
  brandHtml: 'kiwi<span class="wjs-brand-ext">-framework</span>',
  description: 'A hub built on kiwi-framework, with no distribution yet: the engine alone.',
  homepage: 'https://github.com/derlocke-ng/kiwi-framework',
  repo: 'https://github.com/derlocke-ng/kiwi-framework',
  relays: ['wss://nos.lol', 'wss://relay.damus.io', 'wss://nostr.mom', 'wss://relay.primal.net'],
  /** @type {string[]} */
  media: [],
  /** @type {string[] | null} */
  how: null,
  policy: { userMounts: false },
  apps: [],
  mounts: [],
};
