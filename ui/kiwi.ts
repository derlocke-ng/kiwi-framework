// The hub's runtime, one per page: the relay pool, the event store, the
// outbox, the account's suite settings (language, theme, hidden apps), its
// people and its block list. bootKiwi() is what a React page calls first;
// the hooks in hooks.ts read from the Kiwi it returns, and every change
// that matters to the UI goes through kiwi.emit().

import { changePassword as changeAccountPassword, forgetIdentity, ID_KEY, loadIdentity, saveIdentity } from '../shared/account.js';
import { contentNetworkOf, MOUNT_IDS, networkOfPage, orderedMounts, spaceOfPage } from '../shared/apps.js';
import { normalizeServer } from '../shared/blossom.js';
import { DirectMessages } from '../shared/chat.js';
import { deviceId, deviceName } from '../shared/device.js';
import { DISTRIBUTION } from '../shared/distribution.js';
import { Groups } from '../shared/groups.js';
import { loadHubConfig } from '../shared/hubconfig.js';
import { currentLanguage, initI18n, LANGUAGES, savedLanguage, setLanguage, t } from '../shared/i18n.js';
import { BlockList } from '../shared/moderation.js';
import { PeerNetworks } from '../shared/peers.js';
import { People } from '../shared/people.js';
import { hintsAllowed, RelayLists } from '../shared/relaylists.js';
import { RelayPool, savedNetworks } from '../shared/relays.js';
import { AccountSettings } from '../shared/settings.js';
import { Spaces } from '../shared/spaces.js';
import { LocalStore } from '../shared/store.js';
import { Sync } from '../shared/sync.js';
import { applyTheme, setAccent, setTheme, watchDeviceSettings } from '../shared/theme.js';
import { toast } from './toast';

export interface Identity {
  sk: string;
  pk: string;
  alias: string | null;
  /** with an account: the lookup pubkey of the username and password (the account entry's address) */
  accountPk?: string | null;
  /** the account entry's form: 2 today (the key is its author, so the key can retire it), 1 the first form */
  accountVersion?: 1 | 2;
  /** pasted by the person (nsec, ncryptsec or hex), not made here */
  imported?: boolean;
  created?: number;
  /** when this device took the key: a sign-out of other devices asked before this leaves it be */
  since?: number;
}

export interface Net {
  db: any;
  pool: any;
  sync: any;
}

export interface KiwiOptions {
  /** the page: 'hub', 'settings' or a mount id */
  current?: string;
  /** path to the site root from this page */
  base?: string;
  /** the icon sprite's URL from this page */
  sprite?: string;
  /** catalog folders, ending in '/' */
  dirs?: string[];
}

export class Kiwi {
  /** this page's content network, seen from its mount: a public mount's events go to the public relays alone, a space's to the space's */
  readonly net: Net;
  /** the hub's own network, where the account's settings, people and inbox live */
  readonly hubNet: Net;
  /** every network at once (the inbox listens on all of them) */
  readonly whole: Net;
  /** 'hub' or 'public': the network this page's people are on (settings, friends, sealed notes made here) */
  readonly network: string;
  /** the network this page's content is on: `network`, or `space:<id>` for a mount on a space with relays of its own */
  readonly content: string;
  /** the space this page's mount serves (shared/spaces.js), as configured; `space()` is the live view */
  readonly mountSpace: any | null;
  readonly current: string;
  readonly base: string;
  readonly sprite: string;
  suite!: any;
  blocks!: any;
  people!: any;
  /** the private-message inbox (shared/chat.js) */
  messages!: any;
  /** the groups the person is in (shared/groups.js) */
  groups!: any;
  /** which network each person is reached on (shared/peers.js) */
  peers!: any;
  /** relay lists: mine published per network, others' inboxes found (shared/relaylists.js) */
  reach!: any;
  /** the hub's spaces as the relays know them (shared/spaces.js) */
  spaces!: any;
  version = 0;
  private listeners = new Set<() => void>();
  private offSuite: (() => void) | null = null;
  private offBlocks: (() => void) | null = null;
  private offConnect: (() => void) | null = null;

  constructor(net: Net, { current = 'hub', base = './', sprite = 'icons.svg' }: KiwiOptions) {
    this.whole = net;
    this.current = current;
    this.base = base;
    this.sprite = sprite;
    this.network = networkOfPage(current);
    this.content = contentNetworkOf(current);
    this.mountSpace = spaceOfPage(current);
    const scope = (network: string): Net => ({ db: net.db.scope(network), pool: net.pool.scope(network), sync: net.sync.scope(network) });
    this.hubNet = scope('hub');
    this.net = this.content === 'hub' ? this.hubNet : scope(this.content);
  }

  /** The space this page's mount serves, as the relays describe it (the config until they do), or null. */
  space(): any | null {
    return this.mountSpace ? this.spaces?.get(this.mountSpace.id) || this.mountSpace : null;
  }

  identity(): Identity {
    return loadIdentity() as Identity;
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  emit(): void {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  async start(): Promise<void> {
    this.spaces = new Spaces(this.whole);
    this.spaces.onChange(() => this.emit());
    this.spaces.start().catch(() => {});
    await this.startSuite();
    await this.startPeople();
    this.touchDevice();
  }

  /** After a sign-in, sign-out, key import or restore: everything bound to the identity starts over. */
  async restart(): Promise<void> {
    await this.startSuite();
    await this.startPeople();
    this.touchDevice();
  }

  private async startSuite(): Promise<void> {
    this.offSuite?.();
    this.suite?.stop();
    this.suite = new AccountSettings(this.identity(), this.hubNet, 'suite');
    await this.suite.start();
    this.offSuite = this.suite.onChange(() => this.applySuite());
    await this.applySuite();
  }

  /** The account's language wins over the device's; appearance is each device's own. */
  private async applySuite(): Promise<void> {
    if (await this.obeySignOut()) return;
    const lang = this.suite.get('lang');
    if (lang && (LANGUAGES as Record<string, string>)[lang] && lang !== currentLanguage()) await setLanguage(lang);
    // The key's own settings name the person and their account, so a device that got the key pasted learns them here.
    const alias = this.suite.get('alias');
    if (typeof alias === 'string' && alias.trim() && !this.identity().alias) this.adoptAccount({ alias, accountPk: this.suite.get('accountPk') || null });
    this.emit();
  }

  /**
   * Another device of this key asked this one to sign out: every device that took the key before a moment
   * (`signOutBefore`), or this one by its id (`revoked`). The key is forgotten here and the page goes on
   * with a device key of its own. A device that never connects again keeps the key: that is what a new
   * password is for, and the two are offered together.
   */
  private async obeySignOut(): Promise<boolean> {
    const me = this.identity();
    if (!me.alias && !me.accountPk) return false; // a device key is one device
    const since = me.since || me.created || 0;
    const revoked: string[] = this.suite.get('revoked') || [];
    const before: number = this.suite.get('signOutBefore') || 0;
    if (!revoked.includes(deviceId()) && !(before > since)) return false;
    forgetIdentity();
    await this.restart();
    toast(t('hub.signedOutElsewhere'), 'info', 12000);
    this.emit();
    return true;
  }

  /** This device in the key's list of devices: an id, a name, when it was last seen; written at most once an hour. */
  private touchDevice(): void {
    const suite = this.suite;
    // after the relays' first answer: the list is then the newest, and no other device's entry is written over
    suite?.synced.then(() => {
      if (this.suite === suite) this.writeDevice();
    });
  }

  private writeDevice(): void {
    const me = this.identity();
    if (!me.alias && !me.accountPk) return;
    const id = deviceId();
    const devices: Record<string, { name: string; seen: number }> = { ...(this.suite.get('devices') || {}) };
    const mine = devices[id];
    const name = deviceName();
    if (mine && mine.name === name && Date.now() - (mine.seen || 0) < 3_600_000) return;
    devices[id] = { name, seen: Date.now() };
    for (const [k, v] of Object.entries(devices)) if (k !== id && Date.now() - (v.seen || 0) > 90 * 86_400_000) delete devices[k]; // not seen for 90 days: gone from the list
    this.suite.set({ devices }).catch(() => {});
  }

  /** The devices this key is signed in on, as far as they reported in; this one first, then by last seen. */
  devices(): Array<{ id: string; name: string; seen: number; me: boolean }> {
    const all: Record<string, { name: string; seen: number }> = this.suite?.get('devices') || {};
    const revoked: string[] = this.suite?.get('revoked') || [];
    const mine = deviceId();
    return Object.entries(all)
      .filter(([id]) => !revoked.includes(id))
      .map(([id, d]) => ({ id, name: d.name || '', seen: d.seen || 0, me: id === mine }))
      .sort((a, b) => Number(b.me) - Number(a.me) || b.seen - a.seen);
  }

  /** Every other device signs out when it next connects; this one stays. */
  async signOutOtherDevices(): Promise<void> {
    const at = Date.now();
    saveIdentity({ ...this.identity(), since: at });
    await this.suite.set({ signOutBefore: at, revoked: [], devices: { [deviceId()]: { name: deviceName(), seen: at } } });
    this.emit();
  }

  /** One other device signs out when it next connects. */
  async revokeDevice(id: string): Promise<void> {
    if (id === deviceId()) return;
    const devices = { ...(this.suite.get('devices') || {}) };
    delete devices[id];
    const revoked: string[] = this.suite.get('revoked') || [];
    await this.suite.set({ revoked: [...new Set([...revoked, id])].slice(-50), devices });
    this.emit();
  }

  /**
   * A new password for the account: the entry for it goes up under this key, the old one is retired, so the
   * old password stops opening the account everywhere the change reaches. An account still in its first
   * form needs the current password too (only its lookup key can retire that form).
   */
  async changePassword(
    newPassword: string,
    oldPassword: string | null = null,
    onProgress?: (msg: string, params?: Record<string, unknown>) => void,
  ): Promise<void> {
    const id = this.identity();
    if (!id.alias || !id.accountPk) throw new Error('no account');
    const old = { lookupPk: id.accountPk, version: id.accountVersion || 1 };
    const { lookupPk } = await changeAccountPassword(this.hubNet, { skHex: id.sk, username: id.alias, newPassword, oldPassword, old, onProgress });
    saveIdentity({ ...this.identity(), accountPk: lookupPk, accountVersion: 2 });
    await this.suite.set({ accountPk: lookupPk });
    this.emit();
  }

  private adoptAccount({ alias, accountPk }: { alias: string; accountPk?: string | null }): void {
    const id = this.identity();
    const name = String(alias).trim().slice(0, 40);
    saveIdentity({ ...id, alias: name, accountPk: accountPk || id.accountPk || null });
    if (this.people) this.people.alias = name;
    if (this.groups) this.groups.alias = name;
    if (this.messages) this.messages.alias = name;
  }

  /**
   * What the person is called and, with an account, the account entry's address: on this device now,
   * and in the key's encrypted settings, so every device holding the key knows them too.
   */
  async rememberAccount({ alias, accountPk = null }: { alias: string; accountPk?: string | null }): Promise<void> {
    this.adoptAccount({ alias, accountPk });
    this.emit();
    await this.suite?.set({ alias: String(alias).trim().slice(0, 40), ...(accountPk ? { accountPk } : {}) });
    this.touchDevice();
  }

  private async startPeople(): Promise<void> {
    this.blocks?.stop();
    this.people?.stop();
    this.messages?.stop();
    this.groups?.stop();
    this.offBlocks?.();
    this.offConnect?.();
    const id = this.identity();
    this.peers = new PeerNetworks(id.pk, { fallback: this.network }); // someone first met on this page is reached on its network
    this.reach = new RelayLists(id, this.whole.pool, { peers: this.peers });
    // my lists on every network the moment its relays are up, then at most once a day or when they change
    let listing: ReturnType<typeof setTimeout> | null = null;
    const list = () => {
      if (listing) clearTimeout(listing);
      listing = setTimeout(() => this.reach?.publishOwn().catch(() => {}), 1500);
    };
    this.offConnect = this.whole.pool.onConnect(list);
    list();
    this.blocks = await new BlockList(id, this.hubNet).start();
    const isBlocked = (pk: string) => Boolean(this.blocks.isBlocked(pk));
    this.people = await new People(id, this.hubNet, { isBlocked, peers: this.peers, reach: this.reach }).start();
    this.messages = new DirectMessages(id, this.hubNet, { isBlocked, peers: this.peers, reach: this.reach });
    this.groups = new Groups(id, this.hubNet, { isBlocked, inbox: this.messages, network: this.network }); // registers for knocks and keys before the inbox replays
    this.groups.friendCheck = (pk: string) => Boolean(this.people?.isFriend(pk));
    await this.messages.start();
    await this.groups.start();
    this.offBlocks = this.blocks.onChange(() => this.messages.purgeBlocked().catch(() => {}));
    this.emit();
  }

  /**
   * Hints for a link made on this page: where its events are. This page's content network's relays and
   * any the thing was found on (`also`), at most three; none on a locked hub's own network.
   */
  hints(also: string[] = [], network: string = this.content): string[] {
    if (!hintsAllowed(network)) return [];
    return [...new Set([...this.whole.pool.urlsOf(network), ...also])].slice(0, 3);
  }

  /** Chosen by the person: on this device now, and in the account for every other device. */
  async chooseLanguage(code: string): Promise<void> {
    await setLanguage(code);
    this.emit();
    this.suite?.set({ lang: code }).catch(() => {});
  }

  /** Light, dark or the system's: this device's, since a phone and a desk want different things. */
  chooseTheme(th: string): void {
    setTheme(th);
    this.emit();
  }

  /** The accent palette (ACCENTS in shared/theme.js): this device's too. */
  chooseAccent(a: string): void {
    setAccent(a);
    this.emit();
  }

  hiddenApps(): string[] {
    const list = (this.suite?.get('hiddenApps', []) as string[] | undefined) || [];
    return list.filter((a) => MOUNT_IDS.includes(a));
  }

  /** The mounts in this person's order (the start page, the switcher and the settings follow it). */
  orderedApps(): ReturnType<typeof orderedMounts> {
    return orderedMounts(this.suite?.get('appOrder', []));
  }

  /** Save a new order (mount ids); [] goes back to the hub's own. Follows the account to every device. */
  setAppOrder(order: string[]): Promise<void> {
    return this.suite.set({ appOrder: order.filter((id) => MOUNT_IDS.includes(id)) });
  }

  hasCustomOrder(): boolean {
    return ((this.suite?.get('appOrder', []) as string[] | undefined) || []).length > 0;
  }

  /** The media (Blossom) servers uploads go to, first choice first: the person's own list, or the hub's. */
  mediaServers(): string[] {
    const own = this.suite?.get('mediaServers') as string[] | undefined;
    const list = Array.isArray(own) ? own : DISTRIBUTION.media || [];
    return [...new Set(list.map((s) => normalizeServer(s)).filter((s): s is string => Boolean(s)))];
  }

  hasOwnMediaServers(): boolean {
    return Array.isArray(this.suite?.get('mediaServers'));
  }

  /** Save the person's list (it follows the account); null goes back to the hub's. */
  setMediaServers(list: string[] | null): Promise<void> {
    return this.suite.set({ mediaServers: list === null ? undefined : list.map((s) => normalizeServer(s)).filter(Boolean) });
  }

  setAppHidden(app: string, hidden: boolean): Promise<void> {
    const list = this.hiddenApps().filter((a) => a !== app);
    if (hidden) list.push(app);
    return this.suite.set({ hiddenApps: list });
  }
}

/** Open the store, connect the relays, load the strings and the account's settings. */
export async function bootKiwi({ current = 'hub', base = './', sprite = 'icons.svg', dirs = ['locales/'] }: KiwiOptions = {}): Promise<Kiwi> {
  applyTheme();
  if (!import.meta.env.DEV && 'serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register(`${base}sw.js`).catch(() => {});
    // A worker of the app's own from before it was a React page (Loadout had one) would keep serving this
    // folder; the site's worker covers it now, so any worker scoped below the site root for this page goes.
    const root = new URL(base, location.href).href;
    navigator.serviceWorker
      .getRegistrations()
      .then((all) => {
        for (const r of all) if (r.scope !== root && r.scope.startsWith(root) && location.href.startsWith(r.scope)) r.unregister();
      })
      .catch(() => {});
  }
  const strings = initI18n({ dirs });
  await loadHubConfig(base); // the host's say on relays, policy and the public area, before anything connects
  const db = await LocalStore.open('wjs');
  const pool = new RelayPool(savedNetworks());
  const sync = new Sync(pool, db);
  await strings;
  const kiwi = new Kiwi({ db, pool, sync }, { current, base, sprite });
  await kiwi.start();
  watchDeviceSettings({
    onTheme: () => {
      applyTheme();
      kiwi.emit();
    },
    onLanguage: async () => {
      const lang = savedLanguage();
      if (lang && lang !== currentLanguage()) {
        await setLanguage(lang);
        kiwi.emit();
      }
    },
  });
  addEventListener('storage', (e) => {
    if (e.key === ID_KEY) kiwi.restart().catch(() => {});
  });
  document.documentElement.classList.add('i18n');
  return kiwi;
}
