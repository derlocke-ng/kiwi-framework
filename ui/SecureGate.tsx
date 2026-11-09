// A hub opened over plain HTTP from another machine: the browser gives such a
// page no WebCrypto (it exists in a secure context only: https, or localhost),
// and everything here is sealed and opened with it, so nothing would work and
// nothing would say why. The page says it instead, before the runtime starts,
// and offers the same address over HTTPS. No icon: the sprite is not loaded.
import { t } from '../shared/i18n.js';

export function SecureGate() {
  const https = location.href.replace(/^http:/, 'https:');
  return (
    <div className="wjs-gate" id="secureGate" role="alertdialog" aria-labelledby="secureTitle" aria-describedby="secureText">
      <div className="wjs-gate-card">
        <h2 id="secureTitle">{t('gate.secure.title')}</h2>
        <p id="secureText">{t('gate.secure.text')}</p>
        <a className="btn btn-primary" id="secureGo" href={https}>
          {t('gate.secure.go')}
        </a>
      </div>
    </div>
  );
}
