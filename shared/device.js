// This device, for the key's list of devices (ui/kiwi.ts): an id made here
// once and kept in localStorage, and a name from the browser. The id is made
// anew on every sign-in, so a device signed out from elsewhere and signed in
// again by its owner is a new device, not the revoked one.
import { randomId, store } from './util.js';

const KEY = 'wjs.device';

/** This device's id; `fresh` makes a new one (a sign-in). */
export function deviceId({ fresh = false } = {}) {
  const have = store.get(KEY);
  if (!fresh && typeof have === 'string' && have) return have;
  const id = randomId(12);
  store.set(KEY, id);
  return id;
}

/** "Chrome on Android", "Safari on iPhone", "Firefox on Linux": enough to tell devices apart in a list. */
export function deviceName() {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent || '';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Android/.test(ua) ? 'Android' : /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /CrOS/.test(ua) ? 'ChromeOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}
