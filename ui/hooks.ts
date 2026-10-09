// React over the data layer. Nothing here knows about pages: a hook
// subscribes to one source (the Kiwi runtime, the relay pool, the outbox)
// and returns a version or a value, so components re-render exactly when
// something they show has changed.
import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { t, tErr } from '../shared/i18n.js';
import { savedRelays } from '../shared/relays.js';
import { AccountSettings } from '../shared/settings.js';
import type { Identity, Kiwi } from './kiwi';
import { toast } from './toast';

export const KiwiContext = createContext<Kiwi | null>(null);

export function useKiwi(): Kiwi {
  const kiwi = useContext(KiwiContext);
  if (!kiwi) throw new Error('useKiwi() needs a <KiwiContext.Provider>');
  return kiwi;
}

/** A counter that grows on every event from `subscribe`; the component then reads live values. */
export function useTick(subscribe: (cb: () => void) => () => void): number {
  const ref = useRef(0);
  const sub = useCallback(
    (cb: () => void) =>
      subscribe(() => {
        ref.current++;
        cb();
      }),
    [subscribe],
  );
  const get = () => ref.current;
  return useSyncExternalStore(sub, get, get);
}

/** Identity, language, theme, suite settings, people and blocks: anything the runtime announces. */
export function useKiwiTick(): number {
  const kiwi = useKiwi();
  const sub = useCallback((cb: () => void) => kiwi.onChange(cb), [kiwi]);
  return useTick(sub);
}

export function useIdentity(): Identity {
  const kiwi = useKiwi();
  useKiwiTick();
  return kiwi.identity();
}

/** The translator, bound to the current language: a component that calls it re-renders on a switch. */
export function useT(): typeof t {
  useKiwiTick();
  return t;
}

/** The relay pool and the outbox: connection changes, acknowledgements, errors. */
export function useNetTick(): number {
  const { net } = useKiwi();
  const sub = useCallback(
    (cb: () => void) => {
      const off1 = net.pool.onStatus(cb);
      const off2 = net.sync?.onChange(cb) || (() => {});
      return () => {
        off1();
        off2();
      };
    },
    [net],
  );
  return useTick(sub);
}

/** How many of this device's changes no relay has yet. */
export function useUnsynced(): number {
  const { net } = useKiwi();
  const tick = useNetTick();
  const [n, setN] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `tick` is the trigger: recount on every network change
  useEffect(() => {
    let alive = true;
    Promise.resolve(net.sync ? net.sync.unsynced() : 0).then((v: number) => {
      if (alive) setN(v || 0);
    });
    return () => {
      alive = false;
    };
  }, [net, tick]);
  return n;
}

/** Per relay, how many events wait for it. */
export function useOutboxWaiting(): Record<string, number> {
  const { net } = useKiwi();
  const tick = useNetTick();
  const [waiting, setWaiting] = useState<Record<string, number>>({});
  // biome-ignore lint/correctness/useExhaustiveDependencies: `tick` is the trigger: re-read the outbox on every network change
  useEffect(() => {
    let alive = true;
    Promise.resolve(net.sync?.outbox()).then((box: { waiting?: Record<string, number> } | undefined) => {
      if (alive) setWaiting(box?.waiting || {});
    });
    return () => {
      alive = false;
    };
  }, [net, tick]);
  return waiting;
}

/** NIP-11 information (name, countries) for the saved relays, as it arrives. */
export function useRelayInfos(): Map<string, any> {
  const { net } = useKiwi();
  const [infos, setInfos] = useState<Map<string, any>>(() => new Map());
  useEffect(() => {
    let alive = true;
    for (const url of savedRelays()) {
      Promise.resolve(net.pool.info(url)).then((info: any) => {
        if (alive && info) setInfos((m) => new Map(m).set(url, info));
      });
    }
    return () => {
      alive = false;
    };
  }, [net]);
  return infos;
}

/** The account's People (friends, requests, circles, shares), re-rendering on every change. */
export function usePeople(): any {
  const kiwi = useKiwi();
  useKiwiTick();
  const people = kiwi.people;
  const sub = useCallback((cb: () => void) => (people ? people.onChange(cb) : () => {}), [people]);
  useTick(sub);
  return people;
}

export function useBlocks(): any {
  const kiwi = useKiwi();
  useKiwiTick();
  const blocks = kiwi.blocks;
  const sub = useCallback((cb: () => void) => (blocks ? blocks.onChange(cb) : () => {}), [blocks]);
  useTick(sub);
  return blocks;
}

/** A value kept in React state and mirrored to a setter when it changes (controlled inputs over plain functions). */
export function useLocal<T>(initial: () => T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(initial);
  return [v, setV];
}

/**
 * An app's own settings, encrypted in the account (kind 30791, d = namespace),
 * so they follow it to every device; null until loaded. get(key, fallback),
 * set({ key: value }) and re-renders on every change, from any device.
 */
export function useAppSettings(namespace: string): any | null {
  const kiwi = useKiwi();
  const identity = useIdentity();
  const [settings, setSettings] = useState<any>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: they belong to the identity, by its key
  useEffect(() => {
    const s = new AccountSettings(identity, kiwi.net, namespace);
    let live = true;
    s.start()
      .then(() => live && setSettings(s))
      .catch((err: unknown) => toast(tErr(err), 'error'));
    return () => {
      live = false;
      s.stop();
      setSettings(null);
    };
  }, [identity.pk, kiwi, namespace]);
  useTick(useCallback((fn: () => void) => (settings ? settings.onChange(fn) : () => {}), [settings]));
  return settings;
}
