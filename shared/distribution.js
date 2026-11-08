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
//   relays   the hub's own network: the default relays until the user picks
//            their own (unless the policy locks them); a private hub names
//            relays inside its VPN here, so its apps work only from inside
//   publicRelays  the public area's relays, for mounts with network: 'public':
//            a semi-public hub lets its people talk to outsiders there
//   directoryRelays  where people's relay lists are published and asked for,
//            besides the network's own relays (purplepag.es and the like), so
//            people on hubs that share no relay find each other; never used
//            on a locked hub's own network (shared/relaylists.js)
//   media    the default media (Blossom) servers for photos and files, first
//            choice first, until the user picks their own; empty: no uploads
//   how      the topics of the hub's "How it works" (shared/how.js); null: HOW.hub
//   policy   userMounts: may a user follow a space this hub does not ship?
//            relays: 'open' (a person may use their own) or 'locked' (the hub's are fixed)
//            requireHub: true for a private hub: its pages wait while none of its relays is reachable
//   mounts[].network  'hub' (default) or 'public' (shared/distribution-check.js has the rules)
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
  publicRelays: [],
  /** @type {string[]} */
  directoryRelays: [],
  /** @type {string[]} */
  media: [],
  /** @type {string[] | null} */
  how: null,
  policy: { userMounts: false, relays: 'open', requireHub: false },
  apps: [],
  mounts: [],
};
