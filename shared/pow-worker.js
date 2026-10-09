// One mining thread: nonces start, start+stride, … until the id meets the
// target. Picks the faster hasher for this browser first (the bundled
// SHA-256 with a JIT, the native one without), and reports how many it
// tried every few hundred milliseconds.
import { mineNonce, mineNonceSubtle, pickMiner } from './pow.js';

self.onmessage = async (e) => {
  const { template, bits, start = 0, stride = 1 } = e.data;
  let last = Date.now();
  const onCount = (tried) => {
    const t = Date.now();
    if (t - last < 400) return;
    last = t;
    self.postMessage({ tried });
  };
  try {
    const how = await pickMiner(template);
    const { event } = how === 'subtle' ? await mineNonceSubtle(template, bits, { start, stride, onCount }) : mineNonce(template, bits, { start, stride, onCount });
    self.postMessage({ event, how });
  } catch (err) {
    self.postMessage({ error: String(err?.message || err) });
  }
};
