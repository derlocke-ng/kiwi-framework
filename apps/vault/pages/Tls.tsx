// TLS certificates in the vault, like kiwi-server's ksslgen but in the
// browser and more of it: a CA of your own (limited to your domains with name
// constraints, or brought in as it is: kiwiCA.pem and kiwiCA.key work as they
// are), installed once on your devices; certificates for a host and every name
// below it (host and *.host) in one step, saved as privkey.pem, cert.pem and
// fullchain.pem with the nginx lines that use them, renewed with one tap and
// listed in the health report before they run out; a self-signed certificate;
// and a key and request for another CA, its certificate pasted back when it
// comes. The crypto is shared/x509.js, loaded on first use.
import { type FormEvent, useState } from 'react';
import { tErr } from '../../../shared/i18n.js';
import { Icon } from '../../../ui/components';
import { confirmDialog } from '../../../ui/dialogs';
import { useT } from '../../../ui/hooks';
import { goBack } from '../../../ui/route';
import { toast } from '../../../ui/toast';
import { useVault, type VaultItem } from '../../../ui/vault/VaultProvider';
import { Modal } from '../../../ui/widgets/Modal';
import { Block, date, fileName } from './Keys';

const loadX509 = () => import('../../../shared/x509.js');

const KEY_TYPES = [
  ['ec-p256', 'ECDSA P-256'],
  ['ec-p384', 'ECDSA P-384'],
  ['rsa-2048', 'RSA 2048'],
  ['rsa-3072', 'RSA 3072'],
  ['rsa-4096', 'RSA 4096'],
];
const DAYS = 825; // the longest a certificate may live for Apple's devices, as kiwi-server issues them

type Pki = NonNullable<VaultItem['pki']>;

/** Words separated by spaces, commas or lines. */
const words = (s: string) =>
  String(s || '')
    .split(/[\s,]+/)
    .map((w) => w.trim())
    .filter(Boolean);

/** Names typed in one field, sorted into DNS names, addresses and emails. */
function sortNames(text: string) {
  const all = words(text);
  return {
    dns: all.filter((n) => !n.includes('@') && !/^[\d.]+$/.test(n) && !(n.includes(':') && /^[0-9a-f:]+$/i.test(n))),
    ips: all.filter((n) => /^[\d.]+$/.test(n) || (n.includes(':') && /^[0-9a-f:]+$/i.test(n))),
    emails: all.filter((n) => n.includes('@')),
  };
}

function saveBytes(name: string, bytes: Uint8Array, type: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function KeyTypeField({ name = 'keyType', value }: { name?: string; value: string }) {
  const t = useT();
  return (
    <label className="field">
      <span>{t('pw.ca.keyType')}</span>
      <select name={name} defaultValue={value}>
        {KEY_TYPES.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Organisation, unit, country, state, place: the rest of a subject, folded away. */
function SubjectFields({ open = false }: { open?: boolean }) {
  const t = useT();
  return (
    <details className="pw-more" open={open}>
      <summary>{t('pw.tls.subjectMore')}</summary>
      <div className="pw-two">
        <label className="field">
          <span>{t('pw.ca.o')}</span>
          <input name="o" maxLength={64} />
        </label>
        <label className="field">
          <span>{t('pw.ca.ou')}</span>
          <input name="ou" maxLength={64} />
        </label>
      </div>
      <div className="pw-three">
        <label className="field">
          <span>{t('pw.ca.c')}</span>
          <input name="c" maxLength={2} placeholder="DE" />
        </label>
        <label className="field">
          <span>{t('pw.ca.st')}</span>
          <input name="st" maxLength={64} />
        </label>
        <label className="field">
          <span>{t('pw.ca.l')}</span>
          <input name="l" maxLength={64} />
        </label>
      </div>
    </details>
  );
}

const subjectFrom = (f: FormData) => {
  const text = (k: string) => String(f.get(k) || '').trim();
  return { cn: text('cn'), o: text('o'), ou: text('ou'), c: text('c'), st: text('st'), l: text('l') };
};

// ---- a CA ----

/** A new root CA (limited to some domains, when asked), or one brought in from its certificate and key. */
export function NewCa() {
  const t = useT();
  const vault = useVault();
  const [mode, setMode] = useState<'make' | 'import'>('make');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const text = (k: string) => String(f.get(k) || '').trim();
    setError('');
    setBusy(true);
    try {
      const x509 = await loadX509();
      let pki: Record<string, any>;
      if (mode === 'make') {
        const subject = subjectFrom(f);
        const limits = sortNames(text('permitted'));
        const permitted = { dns: limits.dns, ips: words(text('permitted')).filter((w) => /^[\d.:a-f]+\/\d+$/i.test(w)) };
        const ca = await x509.createCA({ ...subject, keyType: text('keyType'), days: Math.round(Number(text('years') || 10) * 365.25), permitted });
        pki = {
          kind: 'root',
          origin: 'ca',
          keyType: ca.keyType,
          certPem: ca.certPem,
          keyPem: ca.keyPem,
          chainPem: '',
          subject,
          permitted,
          serial: ca.serial,
          notAfter: ca.notAfter,
          issued: [],
        };
      } else {
        const keyPem = x509.importKey(text('keyPem'));
        const info = await x509.describe(text('certPem'), keyPem);
        if (!info.isCA) throw Object.assign(new Error('Not a CA'), { code: 'ca.error.notCa' });
        pki = {
          kind: info.selfSigned ? 'root' : 'intermediate',
          origin: 'ca',
          keyType: info.keyType,
          certPem: text('certPem'),
          keyPem,
          chainPem: text('chainPem'),
          subject: info.subject,
          permitted: info.permitted,
          serial: info.serial,
          notAfter: info.notAfter,
          issued: [],
        };
      }
      const saved = await vault.store.put({ type: 'ca', name: text('name') || pki.subject.cn, pki });
      location.replace(`#/e/${encodeURIComponent(saved.id)}`);
    } catch (err) {
      setError(tErr(err));
      setBusy(false);
    }
  };
  return (
    <Modal open wide id="editor" title={t('pw.newTitle.ca')} onClose={() => goBack('#/')}>
      <form className="form" id="entryForm" onSubmit={submit}>
        <div className="pw-segment" role="radiogroup">
          {(['make', 'import'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              className={`chip${mode === m ? ' active' : ''}`}
              data-mode={m}
              onClick={() => setMode(m)}
            >
              {t(`pw.ca.${m}`)}
            </button>
          ))}
        </div>
        <label className="field">
          <span>{t('pw.field.name')}</span>
          <input name="name" maxLength={200} placeholder={t('pw.ca.namePlaceholder')} />
        </label>
        {mode === 'make' ? (
          <>
            <label className="field">
              <span>{t('pw.ca.cn')}</span>
              <input name="cn" required maxLength={64} placeholder="Office Root CA" data-autofocus />
            </label>
            <SubjectFields />
            <label className="field">
              <span>{t('pw.ca.permitted')}</span>
              <textarea name="permitted" rows={2} spellCheck={false} autoCapitalize="none" className="mono" placeholder="office.lan example.org 10.8.0.0/16" />
            </label>
            <p className="hint">{t('pw.ca.permittedHint')}</p>
            <div className="pw-two">
              <KeyTypeField value="ec-p384" />
              <label className="field">
                <span>{t('pw.ca.years')}</span>
                <input name="years" type="number" min={1} max={30} defaultValue={10} />
              </label>
            </div>
          </>
        ) : (
          <>
            <label className="field">
              <span>{t('pw.ca.certPem')}</span>
              <textarea name="certPem" rows={5} required spellCheck={false} className="mono" placeholder="-----BEGIN CERTIFICATE-----" />
            </label>
            <label className="field">
              <span>{t('pw.ca.keyPem')}</span>
              <textarea name="keyPem" rows={5} required spellCheck={false} className="mono" placeholder="-----BEGIN PRIVATE KEY-----" />
            </label>
            <p className="hint">{t('pw.ca.keyHint')}</p>
            <label className="field">
              <span>{t('pw.ca.chainPem')}</span>
              <textarea name="chainPem" rows={3} spellCheck={false} className="mono" />
            </label>
          </>
        )}
        {error ? (
          <p className="form-error" role="alert" id="editorError">
            {error}
          </p>
        ) : null}
        <div className="modal-actions">
          <button type="button" className="btn" data-close onClick={() => goBack('#/')}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn-primary" id="saveEntry" disabled={busy}>
            {busy ? t('pw.keys.working') : t('pw.save')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ---- a certificate ----

type Mode = 'ca' | 'self' | 'external';

/** The certificate an issuing CA's entry records, and the CA's own log of it. */
async function record(vault: ReturnType<typeof useVault>, ca: VaultItem, entryId: string, out: { serial: string; notAfter: number }, cn: string, kind: string) {
  const p = ca.pki as Pki;
  await vault.store.put({ id: ca.id, pki: { ...p, issued: [...p.issued, { serial: out.serial, cn, kind, notAfter: out.notAfter, at: Date.now(), entryId }] } });
}

/** A TLS certificate in one step: from a CA in the vault, self-signed, or a key and request for another CA. */
export function NewTls() {
  const t = useT();
  const vault = useVault();
  const cas = vault.items.filter((i) => i.type === 'ca' && i.pki?.keyPem);
  const [mode, setMode] = useState<Mode>(cas.length ? 'ca' : 'self');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const text = (k: string) => String(f.get(k) || '').trim();
    const subject = subjectFrom(f);
    const kind = (text('kind') || 'server') as 'server' | 'client' | 'both';
    const names = sortNames(text('names'));
    const o = { ...subject, ...names, kind, wildcard: f.get('wildcard') === 'on', keyType: text('keyType'), days: Number(text('days')) || DAYS };
    setError('');
    setBusy(true);
    try {
      const x509 = await loadX509();
      const name = text('name') || subject.cn;
      if (mode === 'external') {
        const { csrPem, keyPem } = await x509.newCsr(o);
        const sans = x509.namesOf(o);
        const saved = await vault.store.put({
          type: 'cert',
          name,
          pki: { kind, origin: 'external', keyType: o.keyType, keyPem, csrPem, subject, sans, days: o.days, issued: [] },
        });
        location.replace(`#/e/${encodeURIComponent(saved.id)}`);
        return;
      }
      const ca = mode === 'ca' ? cas.find((c) => c.id === text('ca')) : null;
      if (mode === 'ca' && !ca) throw Object.assign(new Error('No CA'), { code: 'ca.error.noCa' });
      const out = ca
        ? await x509.issue({ keyPem: ca.pki?.keyPem || '', certPem: ca.pki?.certPem || '', chainPem: ca.pki?.chainPem || '' }, o)
        : await x509.selfSigned(o);
      const info = await x509.describe(out.certPem);
      const saved = await vault.store.put({
        type: 'cert',
        name,
        pki: {
          kind,
          origin: ca ? 'ca' : 'self',
          keyType: info.keyType,
          certPem: out.certPem,
          keyPem: out.keyPem,
          chainPem: out.chainPem,
          subject: info.subject,
          sans: info.sans,
          serial: out.serial,
          notAfter: out.notAfter,
          caId: ca?.id || '',
          days: o.days,
          issued: [],
        },
      });
      if (ca) await record(vault, ca, saved.id, out, info.subject.cn, kind);
      location.replace(`#/e/${encodeURIComponent(saved.id)}`);
    } catch (err) {
      setError(tErr(err));
      setBusy(false);
    }
  };
  return (
    <Modal open wide id="editor" title={t('pw.newTitle.tls')} onClose={() => goBack('#/')}>
      <form className="form" id="entryForm" onSubmit={submit}>
        <div className="pw-segment" role="radiogroup">
          {(['ca', 'self', 'external'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              className={`chip${mode === m ? ' active' : ''}`}
              data-mode={m}
              onClick={() => setMode(m)}
            >
              {t(`pw.tls.mode.${m}`)}
            </button>
          ))}
        </div>
        <p className="hint">{t(`pw.tls.modeText.${mode}`)}</p>
        {mode === 'ca' ? (
          cas.length ? (
            <label className="field">
              <span>{t('pw.tls.fromCa')}</span>
              <select name="ca" defaultValue={cas[0].id}>
                {cas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="hint" id="noCa">
              {t('pw.tls.noCa')} <a href="#/new/ca">{t('pw.tls.makeCa')}</a>
            </p>
          )
        ) : null}
        <label className="field">
          <span>{t('pw.tls.host')}</span>
          <input name="cn" required maxLength={64} spellCheck={false} autoCapitalize="none" placeholder="cloud.office.lan" data-autofocus />
        </label>
        <label className="check-row">
          <input type="checkbox" name="wildcard" defaultChecked />
          <span>
            {t('pw.tls.wildcard')}
            <br />
            <span className="muted small">{t('pw.tls.wildcardText')}</span>
          </span>
        </label>
        <label className="field">
          <span>{t('pw.tls.moreNames')}</span>
          <textarea name="names" rows={2} spellCheck={false} autoCapitalize="none" className="mono" placeholder="office.lan 10.0.0.5" />
        </label>
        <div className="pw-two">
          <label className="field">
            <span>{t('pw.tls.kind')}</span>
            <select name="kind" defaultValue="server">
              {(['server', 'client', 'both'] as const).map((k) => (
                <option key={k} value={k}>
                  {t(`pw.ca.issueKind.${k}`)}
                </option>
              ))}
            </select>
          </label>
          <KeyTypeField value="ec-p256" />
        </div>
        {mode !== 'external' ? (
          <label className="field">
            <span>{t('pw.ca.days')}</span>
            <input name="days" type="number" min={1} max={3650} defaultValue={DAYS} />
          </label>
        ) : null}
        <SubjectFields />
        <label className="field">
          <span>{t('pw.field.name')}</span>
          <input name="name" maxLength={200} placeholder={t('pw.tls.namePlaceholder')} />
        </label>
        {error ? (
          <p className="form-error" role="alert" id="editorError">
            {error}
          </p>
        ) : null}
        <div className="modal-actions">
          <button type="button" className="btn" data-close onClick={() => goBack('#/')}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn-primary" id="saveEntry" disabled={busy || (mode === 'ca' && !cas.length)}>
            {busy ? t('pw.keys.working') : t(`pw.tls.make.${mode}`)}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** A CA or a certificate: what it is, its files, and what can be done with it. */
export function PkiView({ item }: { item: VaultItem }) {
  const t = useT();
  const vault = useVault();
  const p = item.pki;
  if (!p) return null;
  const isCa = item.type === 'ca';
  const base = fileName(p.subject.cn || item.name);
  const issuer = p.caId ? vault.store.get(p.caId) : null;
  const sans = [...p.sans.dns, ...p.sans.ips, ...p.sans.emails];
  const pending = p.origin === 'external' && !p.certPem;
  const soon = p.notAfter && p.notAfter - Date.now() < 30 * 86400e3;
  const limits = [...p.permitted.dns, ...p.permitted.ips];
  return (
    <div className="pw-keys" id="pkiView">
      <div className="pw-field" data-field="subject">
        <span className="pw-label">{t(`pw.ca.kind.${p.kind}`)}</span>
        <span className="pw-value">{[p.subject.cn, p.subject.o, p.subject.c].filter(Boolean).join(' · ')}</span>
      </div>
      {sans.length ? (
        <div className="pw-field" data-field="sans">
          <span className="pw-label">{t('pw.ca.sans')}</span>
          <span className="pw-value mono">{sans.join(', ')}</span>
        </div>
      ) : null}
      {limits.length ? (
        <div className="pw-field" data-field="permitted">
          <span className="pw-label">{t('pw.ca.permittedShown')}</span>
          <span className="pw-value mono">{limits.join(', ')}</span>
        </div>
      ) : null}
      {p.notAfter ? (
        <div className="pw-field" data-field="notAfter">
          <span className="pw-label">{t('pw.ca.validUntil')}</span>
          <span className={`pw-value${soon ? ' pw-expired' : ''}`}>{date(p.notAfter)}</span>
        </div>
      ) : null}
      {issuer ? (
        <div className="pw-field" data-field="issuer">
          <span className="pw-label">{t('pw.ca.issuer')}</span>
          <a className="pw-value" href={`#/e/${encodeURIComponent(issuer.id)}`}>
            {issuer.name}
          </a>
        </div>
      ) : p.origin === 'self' ? (
        <div className="pw-field" data-field="issuer">
          <span className="pw-label">{t('pw.ca.issuer')}</span>
          <span className="pw-value">{t('pw.tls.selfIssued')}</span>
        </div>
      ) : null}
      {pending ? (
        <>
          <p className="hint" id="pendingHint">
            {t('pw.tls.pending')}
          </p>
          <Block key="csr" id="csr" label={t('pw.tls.request')} text={p.csrPem} file={`${base}.csr`} />
          <Block key="key" id="key" label={t('pw.ca.privateKey')} text={p.keyPem} file="privkey.pem" secret />
          <PasteForm item={item} />
        </>
      ) : isCa ? (
        <>
          <Block key="cert" id="cert" label={t('pw.ca.certificate')} text={p.certPem} file={`${base}.crt`} />
          <Block key="key" id="key" label={t('pw.ca.privateKey')} text={p.keyPem} file={`${base}.key`} secret />
          {p.kind === 'intermediate' ? <Block key="chain" id="chain" label={t('pw.ca.chain')} text={p.chainPem} file={`${base}-chain.pem`} /> : null}
          <Devices item={item} />
        </>
      ) : (
        <>
          <Block key="key" id="key" label={t('pw.tls.files.key')} text={p.keyPem} file="privkey.pem" secret />
          <Block key="cert" id="cert" label={t('pw.tls.files.cert')} text={p.certPem} file="cert.pem" />
          <Block key="chain" id="chain" label={t('pw.tls.files.chain')} text={p.chainPem} file="fullchain.pem" />
          {p.keyPem && p.kind !== 'client' ? (
            <div className="pw-block" id="nginx">
              <span className="pw-label">{t('pw.tls.nginx')}</span>
              <pre
                className="pw-pre"
                data-text="nginx"
              >{`ssl_certificate     /etc/ssl/${base}/fullchain.pem;\nssl_certificate_key /etc/ssl/${base}/privkey.pem;`}</pre>
            </div>
          ) : null}
        </>
      )}
      {!isCa && !pending ? <Renew item={item} /> : null}
      {p.previous.length ? (
        <details className="pw-history" id="previous">
          <summary>{t('pw.tls.previous', { n: p.previous.length })}</summary>
          <ul>
            {[...p.previous].reverse().map((c) => (
              <li key={`${c.serial}-${c.at}`}>
                <code>{c.serial.slice(0, 12)}</code> · {t('pw.keys.until', { date: date(c.notAfter) })}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {isCa ? <IssueForm item={item} /> : null}
      {isCa && p.issued.length ? (
        <details className="pw-history" id="issued">
          <summary>{t('pw.keys.issued', { n: p.issued.length })}</summary>
          <ul>
            {[...p.issued].reverse().map((c) => (
              <li key={`${c.serial}-${c.at}`}>
                {c.entryId && vault.store.get(c.entryId) ? <a href={`#/e/${encodeURIComponent(c.entryId)}`}>{c.cn}</a> : c.cn} · {t(`pw.ca.kind.${c.kind}`)} ·{' '}
                {t('pw.keys.until', { date: date(c.notAfter) })}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

/**
 * A new certificate for the same names: a new key, from the same CA (or self-signed again), the entry kept and its
 * old serial remembered; one from another CA starts a new request.
 */
function Renew({ item }: { item: VaultItem }) {
  const t = useT();
  const vault = useVault();
  const [busy, setBusy] = useState(false);
  const p = item.pki as Pki;
  const ca = p.caId ? vault.store.get(p.caId) : null;
  if (p.origin === 'ca' && !ca?.pki?.keyPem) return null; // the CA is not in this vault: renew where it is
  const renew = async () => {
    if (!(await confirmDialog({ title: t('pw.tls.renewTitle', { name: item.name }), message: t(`pw.tls.renewText.${p.origin}`), confirm: t('pw.tls.renew') })))
      return;
    setBusy(true);
    try {
      const x509 = await loadX509();
      const o = { ...p.subject, ...p.sans, kind: p.kind as 'server' | 'client' | 'both', keyType: p.keyType || 'ec-p256', days: p.days || DAYS };
      const previous = p.serial ? [...p.previous, { serial: p.serial, notAfter: p.notAfter, at: Date.now() }] : p.previous;
      if (p.origin === 'external') {
        const { csrPem, keyPem } = await x509.newCsr(o);
        await vault.store.put({ id: item.id, pki: { ...p, csrPem, keyPem, certPem: '', chainPem: '', serial: '', notAfter: 0, previous } });
      } else {
        const out = ca?.pki ? await x509.issue({ keyPem: ca.pki.keyPem, certPem: ca.pki.certPem, chainPem: ca.pki.chainPem }, o) : await x509.selfSigned(o);
        await vault.store.put({
          id: item.id,
          pki: { ...p, certPem: out.certPem, keyPem: out.keyPem, chainPem: out.chainPem, serial: out.serial, notAfter: out.notAfter, previous },
        });
        if (ca) await record(vault, ca, item.id, out, p.subject.cn, p.kind);
      }
      toast(t('pw.tls.renewed'), 'success');
    } catch (err) {
      toast(tErr(err), 'error');
    }
    setBusy(false);
  };
  return (
    <button type="button" className="btn" id="renewBtn" disabled={busy} onClick={() => void renew()}>
      <Icon name="refresh-cw" />
      <span>{busy ? t('pw.keys.working') : p.origin === 'external' ? t('pw.tls.newRequest') : t('pw.tls.renew')}</span>
    </button>
  );
}

/** The certificate another CA sent back for this entry's request: checked to be for its key. */
function PasteForm({ item }: { item: VaultItem }) {
  const t = useT();
  const vault = useVault();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const p = item.pki as Pki;
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const text = (k: string) => String(f.get(k) || '').trim();
    setError('');
    setBusy(true);
    try {
      const x509 = await loadX509();
      // the certificate first; what follows it in the same paste, and the chain field, is the chain
      const pasted = text('certPem');
      const first = pasted.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/)?.[0] || '';
      const info = await x509.describe(first, p.keyPem);
      const rest = `${pasted.slice(pasted.indexOf(first) + first.length).trim()}\n${text('chainPem')}`.trim();
      const certPem = `${first}\n`;
      await vault.store.put({
        id: item.id,
        pki: {
          ...p,
          certPem,
          chainPem: rest ? `${certPem}${rest}\n` : certPem,
          subject: info.subject,
          sans: info.sans,
          serial: info.serial,
          notAfter: info.notAfter,
          keyType: info.keyType,
        },
      });
      toast(t('pw.tls.stored'), 'success');
    } catch (err) {
      setError(tErr(err));
    }
    setBusy(false);
  };
  return (
    <div className="card pw-sign" id="pasteCard">
      <h3>
        <Icon name="clipboard-paste" />
        {t('pw.tls.paste')}
      </h3>
      <form className="form" id="pasteForm" onSubmit={submit}>
        <label className="field">
          <span>{t('pw.tls.pasteCert')}</span>
          <textarea name="certPem" rows={5} required spellCheck={false} className="mono" placeholder="-----BEGIN CERTIFICATE-----" />
        </label>
        <label className="field">
          <span>{t('pw.ca.chainPem')}</span>
          <textarea name="chainPem" rows={3} spellCheck={false} className="mono" />
        </label>
        {error ? (
          <p className="form-error" role="alert" id="pasteError">
            {error}
          </p>
        ) : null}
        <div className="modal-actions">
          <button type="submit" className="btn btn-primary" id="pasteBtn" disabled={busy}>
            {t('pw.tls.store')}
          </button>
        </div>
      </form>
    </div>
  );
}

const PLATFORMS = ['windows', 'macos', 'ios', 'android', 'linux', 'firefox'];

/** The CA on your devices: its certificate as PEM and DER, and where each system wants it. */
function Devices({ item }: { item: VaultItem }) {
  const t = useT();
  const p = item.pki as Pki;
  const base = fileName(p.subject.cn || item.name);
  return (
    <div className="card pw-sign" id="devicesCard">
      <h3>
        <Icon name="shield-check" />
        {t('pw.ca.devices')}
      </h3>
      <p className="muted small">{t('pw.ca.devicesText')}</p>
      <div className="vault-buttons">
        <button
          type="button"
          className="btn"
          id="saveCrt"
          onClick={() => saveBytes(`${base}.crt`, new TextEncoder().encode(p.certPem), 'application/x-x509-ca-cert')}
        >
          <Icon name="download" />
          <span>{base}.crt (PEM)</span>
        </button>
        <button
          type="button"
          className="btn"
          id="saveCer"
          onClick={() => void loadX509().then((x) => saveBytes(`${base}.cer`, x.derOf(p.certPem), 'application/pkix-cert'))}
        >
          <Icon name="download" />
          <span>{base}.cer (DER)</span>
        </button>
      </div>
      {PLATFORMS.map((os) => (
        <details className="pw-more" key={os} data-platform={os}>
          <summary>{t(`pw.ca.os.${os}`)}</summary>
          <p className="small">{t(`pw.ca.osText.${os}`, { file: `${base}.crt`, der: `${base}.cer` })}</p>
        </details>
      ))}
    </div>
  );
}

/** A certificate from this CA: for a key made here (host and *.host in one step), or for a CSR whose key stays where it was made. */
function IssueForm({ item }: { item: VaultItem }) {
  const t = useT();
  const vault = useVault();
  const [kind, setKind] = useState<'server' | 'client' | 'both' | 'ca'>('server');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const p = item.pki;
  if (!p) return null;
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const text = (n: string) => String(f.get(n) || '').trim();
    const names = sortNames(text('names'));
    setError('');
    setBusy(true);
    try {
      const x509 = await loadX509();
      const csr = text('csr');
      const cn = text('cn') || (csr ? '' : names.dns[0] || names.emails[0] || '');
      if (!cn && !csr) throw Object.assign(new Error('A name is needed'), { code: 'ca.error.noName' });
      const days = Number(text('days')) || (kind === 'ca' ? 1825 : DAYS);
      const o = { kind, cn, o: text('o'), ...names, wildcard: kind !== 'ca' && f.get('wildcard') === 'on', days, keyType: text('keyType'), csr };
      const out = await x509.issue({ keyPem: p.keyPem, certPem: p.certPem, chainPem: p.chainPem }, o);
      const info = await x509.describe(out.certPem);
      const entryKind = kind === 'ca' ? 'intermediate' : kind;
      const entry = await vault.store.put({
        type: kind === 'ca' ? 'ca' : 'cert',
        name: info.subject.cn || cn,
        pki: {
          kind: entryKind,
          origin: 'ca',
          keyType: info.keyType,
          certPem: out.certPem,
          keyPem: out.keyPem,
          chainPem: out.chainPem,
          subject: info.subject,
          sans: info.sans,
          permitted: info.permitted,
          serial: out.serial,
          notAfter: out.notAfter,
          caId: item.id,
          days,
          issued: [],
        },
      });
      await record(vault, item, entry.id, out, info.subject.cn || cn, entryKind);
      toast(t('pw.ca.issuedToast'), 'success');
      location.hash = `#/e/${encodeURIComponent(entry.id)}`;
    } catch (err) {
      setError(tErr(err));
    }
    setBusy(false);
  };
  return (
    <div className="card pw-sign" id="issueCard">
      <h3>
        <Icon name="file-badge" />
        {t('pw.ca.issue')}
      </h3>
      <form className="form" id="issueForm" onSubmit={submit}>
        <div className="pw-segment" role="radiogroup">
          {(['server', 'client', 'both', 'ca'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={kind === m}
              className={`chip${kind === m ? ' active' : ''}`}
              data-kind={m}
              onClick={() => setKind(m)}
            >
              {t(`pw.ca.issueKind.${m}`)}
            </button>
          ))}
        </div>
        <label className="field">
          <span>{kind === 'server' || kind === 'both' ? t('pw.tls.host') : t('pw.ca.cn')}</span>
          <input
            name="cn"
            maxLength={64}
            spellCheck={false}
            autoCapitalize="none"
            placeholder={kind === 'ca' ? 'Example Intermediate CA' : kind === 'client' ? 'ada' : 'cloud.office.lan'}
          />
        </label>
        {kind === 'server' || kind === 'both' ? (
          <label className="check-row">
            <input type="checkbox" name="wildcard" defaultChecked />
            <span>
              {t('pw.tls.wildcard')}
              <br />
              <span className="muted small">{t('pw.tls.wildcardText')}</span>
            </span>
          </label>
        ) : null}
        {kind !== 'ca' ? (
          <label className="field">
            <span>{t('pw.ca.names')}</span>
            <textarea name="names" rows={2} spellCheck={false} autoCapitalize="none" className="mono" placeholder="office.lan 10.0.0.5" />
          </label>
        ) : null}
        <div className="pw-two">
          <label className="field">
            <span>{t('pw.ca.days')}</span>
            <input name="days" type="number" min={1} max={3650} defaultValue={kind === 'ca' ? 1825 : DAYS} key={kind} />
          </label>
          <KeyTypeField value={kind === 'ca' ? 'ec-p384' : 'ec-p256'} key={`k-${kind}`} />
        </div>
        {kind !== 'ca' ? (
          <details className="pw-more">
            <summary>{t('pw.ca.fromCsr')}</summary>
            <label className="field">
              <span>{t('pw.ca.csr')}</span>
              <textarea name="csr" rows={5} spellCheck={false} className="mono" placeholder="-----BEGIN CERTIFICATE REQUEST-----" />
            </label>
            <p className="hint">{t('pw.ca.csrHint')}</p>
          </details>
        ) : null}
        {error ? (
          <p className="form-error" role="alert" id="issueError">
            {error}
          </p>
        ) : null}
        <div className="modal-actions">
          <button type="submit" className="btn btn-primary" id="issueBtn" disabled={busy}>
            {busy ? t('pw.keys.working') : t('pw.ca.issueBtn')}
          </button>
        </div>
      </form>
    </div>
  );
}
