// "How it works", in pieces. Each topic is one short text about one piece of
// the technology (how.<topic> in shared/locales), so an app lists exactly
// what it is built from and adds lines of its own: any i18n key with a dot
// ('loadout.how.boards'). An app never repeats the framework's texts, and
// when the code behind a topic changes, its one text changes with it.
//
// HOW holds a starting list for every kind of app, named like the
// framework's apps. An app's own list wins; a distribution can set the hub's
// (DISTRIBUTION.how).
//
//   settingsView({ …, how: howLines(['loadout.how.boards', 'linkKeys', 'offline']) })   // plain pages
//   <HowItWorks items={HOW.feed} />                                                       // React (ui/widgets)
import { t } from './i18n.js';

/** Every topic. A new one comes with the code it describes, in every language. */
export const HOW_TOPICS = [
  'encrypted', // private data is encrypted on the device (every app)
  'account', // the account event: key under password (account.js)
  'settings', // settings, people and blocks sealed to the own key (settings.js, people.js, moderation.js)
  'relays', // signed events on relays the person chooses; devices heal relays (relays.js, sync.js)
  'offline', // the outbox (store.js, sync.js)
  'media', // photos on Blossom servers (blossom.js)
  'backup', // the backup file (backup.js)
  'linkKeys', // keys in the #fragment of a link (Loadout boards, rooms)
  'direct', // rooms: WebRTC between browsers, relayed when needed (p2p.js)
  'signed', // public signed posts
  'pow', // proof of work on posts (pow.js)
  'expiry', // posts that expire (NIP-40)
  'friends', // mutual friends, gift-wrapped requests and shares (people.js)
  'blocks', // private block list, public reports (moderation.js)
  'privateMessages', // NIP-17 messages: written for the chat's design; check it when the chat lands
];

/** Starting lists for each kind of app. */
export const HOW = {
  hub: ['encrypted', 'account', 'settings', 'relays', 'offline', 'media', 'backup'],
  boards: ['linkKeys', 'offline', 'relays', 'backup'], // shared lists and notes
  notices: ['signed', 'pow', 'expiry', 'blocks'], // a public noticeboard
  feed: ['encrypted', 'friends', 'media', 'blocks', 'offline'],
  market: ['signed', 'media', 'pow', 'expiry', 'blocks'],
  chat: ['privateMessages', 'friends', 'blocks', 'media', 'offline'],
  blog: ['signed', 'media', 'offline'],
  rooms: ['direct', 'linkKeys'], // live rooms: file drops, games
};

/** The i18n key of an item: a topic ('media') or an app's own key ('db.how.1'). */
export const howKey = (item) => (item.includes('.') ? item : `how.${item}`);

/** The translated lines (they may hold markup) for settingsView({ how }). */
export const howLines = (items) => items.map((item) => t(howKey(item)));
