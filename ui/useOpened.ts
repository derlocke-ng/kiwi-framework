// Sealed events opened with the keys this device has, as React state: each
// event is opened once, and what did not open is tried again whenever the
// runtime announces a change (a key that arrives through the audiences among
// them). The feed's entries and comments and the market's listings use it.
//
//   const opened = useOpened(events, (ev) => data.openEntry(ev));
//   events.map((ev) => opened.get(ev.id)).filter(Boolean)
import { useEffect, useRef, useState } from 'react';
import { useKiwiTick } from './hooks';

/**
 * @param events  the events to open (anything with an id)
 * @param open    the opener: resolves with what the event says, or null when it does not open (yet)
 * @param key     what `open` depends on besides the event (a parent's key id): a new value opens everything again
 */
export function useOpened<T>(events: { id: string }[], open: (ev: any) => Promise<T | null>, key = ''): Map<string, T | null> {
  const tick = useKiwiTick();
  const [opened, setOpened] = useState<Map<string, T | null>>(() => new Map());
  const asked = useRef(new Map<string, string>()); // event id -> the tick and key it was last asked at
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `tick` retries what did not open (a key may have arrived); `key` is what `open` depends on
  useEffect(() => {
    const at = `${tick}|${key}`;
    for (const ev of events) {
      if (opened.get(ev.id) || asked.current.get(ev.id) === at) continue;
      asked.current.set(ev.id, at);
      // the answer is kept whenever it comes, as long as the page is there: a render in between must not lose it
      open(ev).then((r) => {
        if (!mounted.current) return;
        setOpened((m) => {
          if (m.has(ev.id) && m.get(ev.id) === r) return m;
          const next = new Map(m);
          next.set(ev.id, r);
          return next;
        });
      });
    }
  }, [events, tick, key]);
  return opened;
}
