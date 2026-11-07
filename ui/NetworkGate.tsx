// A private hub's pages wait while none of the hub's own relays is reachable:
// its relays are inside its network (a VPN), so outside it there is nothing to
// read or write to. The gate covers the page after a few seconds without a
// hub relay and lifts by itself when one connects. Pages on the public
// network (a semi-public hub's public area) are never gated.
import { useEffect, useState } from 'react';
import { DISTRIBUTION } from '../shared/distribution.js';
import { Icon } from './components';
import { useKiwi, useT } from './hooks';

const GATE_AFTER = 6000; // ms without a hub relay before the page is covered: a reconnect usually takes less

export function NetworkGate() {
  const kiwi = useKiwi();
  const t = useT();
  const required = Boolean(DISTRIBUTION.policy?.requireHub) && kiwi.network === 'hub';
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!required) return;
    const pool = kiwi.whole.pool;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const check = () => {
      if (pool.onlineOf('hub')) {
        if (timer) clearTimeout(timer);
        timer = null;
        setShown(false);
      } else if (!timer) {
        timer = setTimeout(() => setShown(true), GATE_AFTER);
      }
    };
    const off = pool.onStatus(check);
    return () => {
      off();
      if (timer) clearTimeout(timer);
    };
  }, [required, kiwi]);
  if (!shown) return null;
  return (
    <div className="wjs-gate" id="networkGate" role="alertdialog" aria-labelledby="gateTitle" aria-describedby="gateText">
      <div className="wjs-gate-card">
        <Icon name="radio-tower" />
        <h2 id="gateTitle">{t('gate.title', { hub: DISTRIBUTION.name })}</h2>
        <p id="gateText">{t('gate.text')}</p>
        <button type="button" className="btn btn-primary" onClick={() => kiwi.whole.pool.wake()}>
          {t('gate.retry')}
        </button>
      </div>
    </div>
  );
}
