// The hub's runtime, one per page: the relay pool, the event store, the
// outbox, the account's suite settings (language, theme, hidden apps), its
// people and its block list. bootKiwi() is what a React page calls first;
// the hooks in hooks.ts read from the Kiwi it returns, and every change
// that matters to the UI goes through kiwi.emit().

import { ID_KEY, loadIdentity } from '../shared/account.js';
import { MOUNT_IDS } from '../shared/apps.js';
import { currentLanguage, initI18n, LANGUAGES, savedLanguage, setLanguage } from '../shared/i18n.js';
import { BlockList } from '../shared/moderation.js';
import { People } from '../shared/people.js';
import { RelayPool, savedRelays } from '../shared/relays.js';
import { AccountSettings } from '../shared/settings.js';
import { LocalStore } from '../shared/store.js';
import { Sync } from '../shared/sync.js';
import { applyTheme, setTheme, theme, watchDeviceSettings } from '../shared/theme.js';
import { setSprite } from '../shared/ui.js';

export interface Identity {
  sk: string;
  pk: string;
  alias: string | null;
  accountPk?: string | null;
  created?: number;
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
  readonly net: Net;
  readonly current: string;
  readonly base: string;
  readonly sprite: string;
  suite!: any;
  blocks!: any;
  people!: any;
  version = 0;
  private listeners = new Set<() => void>();
  private offSuite: (() => void) | null = null;

  constructor(net: Net, { current = 'hub', base = './', sprite = 'icons.svg' }: KiwiOptions) {
    this.net = net;
    this.current = current;
    this.base = base;
    this.sprite = sprite;
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
    await this.startSuite();
    await this.startPeople();
  }

  /** After a sign-in, sign-out, key import or restore: everything bound to the identity starts over. */
  async restart(): Promise<void> {
    await this.startSuite();
    await this.startPeople();
  }

  private async startSuite(): Promise<void> {
    this.offSuite?.();
    this.suite?.stop();
    this.suite = new AccountSettings(this.identity(), this.net, 'suite');
    await this.suite.start();
    this.offSuite = this.suite.onChange(() => this.applySuite());
    await this.applySuite();
  }

  /** The account's language and theme win over the device's. */
  private async applySuite(): Promise<void> {
    const lang = this.suite.get('lang');
    if (lang && (LANGUAGES as Record<string, string>)[lang] && lang !== currentLanguage()) await setLanguage(lang);
    const th = this.suite.get('theme');
    if (th && th !== theme()) setTheme(th);
    this.emit();
  }

  private async startPeople(): Promise<void> {
    this.blocks?.stop();
    this.people?.stop();
    const id = this.identity();
    this.blocks = await new BlockList(id, this.net).start();
    this.people = await new People(id, this.net, { isBlocked: (pk: string) => this.blocks.isBlocked(pk) }).start();
    this.emit();
  }

  /** Chosen by the person: on this device now, and in the account for every other device. */
  async chooseLanguage(code: string): Promise<void> {
    await setLanguage(code);
    this.emit();
    this.suite?.set({ lang: code }).catch(() => {});
  }

  chooseTheme(th: string): void {
    setTheme(th);
    this.emit();
    this.suite?.set({ theme: th }).catch(() => {});
  }

  hiddenApps(): string[] {
    const list = (this.suite?.get('hiddenApps', []) as string[] | undefined) || [];
    return list.filter((a) => MOUNT_IDS.includes(a));
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
  setSprite(sprite); // the framework's plain-DOM dialogs (confirmDialog) draw their icons from the same sprite
  if (!import.meta.env.DEV && 'serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register(`${base}sw.js`).catch(() => {});
  }
  const strings = initI18n({ dirs });
  const db = await LocalStore.open('wjs');
  const pool = new RelayPool(savedRelays());
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
