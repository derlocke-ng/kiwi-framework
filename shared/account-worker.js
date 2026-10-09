// The password → key derivation (scrypt, 64 MB) off the main thread, so the
// page stays responsive while signing in; progress goes back as a fraction.
import { scryptAsync } from './nostr.mjs';

self.onmessage = async (e) => {
  const { password, salt, params } = e.data;
  let lastPct = -1;
  try {
    const dk = await scryptAsync(password, salt, {
      ...params,
      onProgress: (p) => {
        const pct = Math.floor(p * 100);
        if (pct === lastPct) return;
        lastPct = pct;
        self.postMessage({ progress: p });
      },
    });
    self.postMessage({ dk });
  } catch (err) {
    self.postMessage({ error: String(err?.message || err) });
  }
};
