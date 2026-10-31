// What is new for the person, for badges and notes on every page: unread
// conversations, friend requests and shares waiting, mapped to the hub's
// cards. And the browser notifications a device opts into: they show while a
// tab of the site is open in the background; nothing reaches a closed
// browser, since there is no server.
import { useCallback, useEffect, useState } from 'react';
import { APPS, mountsOf } from '../shared/apps.js';
import { DirectMessages } from '../shared/chat.js';
import { store } from '../shared/util.js';
import { useGroups, useIdentity, useKiwi, useMessages, usePeople, useTick } from './hooks';

export const NOTIFY_KEY = 'wjs.notify';

/** The mount of the chat app, when the distribution has one. */
export function chatMount(): { id: string; name: string; icon: string } | null {
  const app = APPS.find((a: any) => a.framework === 'chat' || a.id === 'chat');
  return app ? mountsOf(app.id)[0] || null : null;
}

export const notificationsSupported = () => typeof Notification !== 'undefined';
export const notifyEnabled = (): boolean => store.get(NOTIFY_KEY, false) === true && notificationsSupported() && Notification.permission === 'granted';

/** Turn browser notifications on (asking the browser) or off; resolves with what the device has now. */
export async function setNotify(on: boolean): Promise<boolean> {
  if (!on || !notificationsSupported()) {
    store.set(NOTIFY_KEY, false);
    return false;
  }
  const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  store.set(NOTIFY_KEY, permission === 'granted');
  return permission === 'granted';
}

/** A notification from the browser, only when the person asked for them and is not looking at this page. */
export function notifyBrowser({ title, body, url, tag, icon }: { title: string; body?: string; url?: string; tag?: string; icon?: string }): boolean {
  if (!notifyEnabled() || document.visibilityState === 'visible') return false;
  try {
    const n = new Notification(title, { body, tag, icon });
    n.onclick = () => {
      window.focus();
      if (url) location.href = url;
      n.close();
    };
    return true;
  } catch {
    return false;
  }
}

export interface Unread {
  /** conversations with something new */
  messages: number;
  requests: number;
  shares: number;
  /** invitations to groups and rooms waiting for a yes or no */
  invites: number;
  /** per mount id: what a card or switcher entry shows */
  byMount: Record<string, number>;
}

/** Unread counts for the hub's cards and the switcher, live. */
export function useUnread(): Unread {
  const kiwi = useKiwi();
  const identity = useIdentity();
  const people = usePeople();
  const messages = useMessages();
  const groups = useGroups();
  // a stable subscription: one made anew each render could miss an emit between unsubscribing and resubscribing
  const version = useTick(useCallback((cb: () => void) => (messages ? messages.onChange(cb) : () => {}), [messages]));
  const [convs, setConvs] = useState<any[]>([]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` is the inbox saying something changed
  useEffect(() => {
    if (!messages) return;
    let live = true;
    messages.conversations().then((c: any[]) => live && setConvs(c));
    return () => {
      live = false;
    };
  }, [messages, version, kiwi]);
  const unread = messages ? convs.filter((c) => c.from !== identity.pk && DirectMessages.timeOf(c) > messages.lastRead(c.conv)).length : 0;
  const requests = people?.incoming().length || 0;
  const shares: any[] = people?.shares() || [];
  const byMount: Record<string, number> = {};
  const chat = chatMount();
  const invites = groups?.invites().length || 0;
  if (chat && unread + invites) byMount[chat.id] = unread + invites;
  for (const s of shares) {
    const m = mountsOf(s.app)[0];
    if (m) byMount[m.id] = (byMount[m.id] || 0) + 1;
  }
  return { messages: unread, requests, shares: shares.length, invites, byMount };
}
