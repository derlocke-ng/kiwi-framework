// What Payload's screens share: the app's settings in the account (the links
// made here, the usual way to send), and small helpers for files on the page.
import { createContext, useCallback, useContext } from 'react';
import { fileSize } from '../../shared/files.js';
import { currentLanguage } from '../../shared/i18n.js';
import { useTick } from '../../ui/hooks';

export const PayloadContext = createContext<{ prefs: any }>({ prefs: null });

/** The app's settings, re-rendering on every change (null until they are read). */
export function usePrefs(): any {
  const { prefs } = useContext(PayloadContext);
  useTick(useCallback((fn: () => void) => (prefs ? prefs.onChange(fn) : () => {}), [prefs]));
  return prefs;
}

/** A size in the person's language: 1.2 MB. */
export const size = (n: number) => fileSize(n, currentLanguage());

/** Hand the browser a file to save. */
export function saveBytes(bytes: Uint8Array | Blob, name: string, type = 'application/octet-stream') {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Through the relays only, never a direct connection (the person's choice on this device, or ?relay for a test). */
export function forceRelay(): boolean {
  if (new URLSearchParams(location.search).has('relay')) return true;
  try {
    return JSON.parse(localStorage.getItem('payload.forceRelay') || 'false') === true;
  } catch {
    return false;
  }
}

/** What this device is called to the other side of a direct transfer: its browser and system. */
export function deviceName() {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Android/.test(ua)
    ? 'Android'
    : /iPhone|iPad/.test(ua)
      ? 'iOS'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Mac OS/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : '';
  return os ? `${browser} · ${os}` : browser;
}
