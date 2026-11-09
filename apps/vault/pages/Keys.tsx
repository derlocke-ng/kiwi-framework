// Keys and certificates in the vault (0.28): SSH keys (made here or brought in,
// their private file given out with or without a passphrase), an SSH key used
// as a certificate authority signing other keys for users and hosts, and an
// X.509 certificate authority issuing server and client certificates or an
// intermediate CA, for a key made here or for a certificate signing request.
// The crypto is shared/ssh.js and shared/x509.js, loaded on first use.
import { type FormEvent, type ReactNode, useState } from 'react';
import { tErr } from '../../../shared/i18n.js';
import { Icon } from '../../../ui/components';
import { useT } from '../../../ui/hooks';
import { goBack } from '../../../ui/route';
import { download, toast } from '../../../ui/toast';
import { useVault, type VaultItem } from '../../../ui/vault/VaultProvider';
import { Modal } from '../../../ui/widgets/Modal';
import { copySecret } from './common';

const loadSsh = () => import('../../../shared/ssh.js');
const loadX509 = () => import('../../../shared/x509.js');

const fileName = (s: string) => (s || 'key').replace(/[^\w.@-]+/g, '-').replace(/^-+|-+$/g, '') || 'key';
const date = (ms: number | null) => (ms ? new Date(ms).toLocaleDateString() : '');

/** A block of text (a key, a certificate) to copy and save, hidden until shown when it is secret. */
function Block({
  id,
  label,
  text,
  file,
  secret = false,
  extra = null,
}: {
  id: string;
  label: string;
  text: string;
  file: string;
  secret?: boolean;
  extra?: ReactNode;
}) {
  const t = useT();
  const [shown, setShown] = useState(!secret);
  if (!text) return null;
  return (
    <div className="pw-block" data-block={id}>
      <div className="pw-block-head">
        <span className="pw-label">{label}</span>
        <span className="pw-actions">
          {secret ? (
            <button
              type="button"
              className="icon-btn"
              data-act={`show-${id}`}
              aria-label={shown ? t('pw.hide') : t('pw.show')}
              onClick={() => setShown(!shown)}
            >
              <Icon name={shown ? 'eye-off' : 'eye'} />
            </button>
          ) : null}
          <button
            type="button"
            className="icon-btn"
            data-act={`copy-${id}`}
            aria-label={t('pw.copy', { what: label })}
            onClick={() => void copySecret(text, label)}
          >
            <Icon name="copy" />
          </button>
          <button
            type="button"
            className="icon-btn"
            data-act={`save-${id}`}
            aria-label={t('pw.keys.save', { file })}
            title={file}
            onClick={() => download(file, text, 'application/x-pem-file')}
          >
            <Icon name="download" />
          </button>
        </span>
      </div>
      {shown ? (
        <pre className="pw-pre" data-text={id}>
          {text}
        </pre>
      ) : (
        <p className="muted small">{t('pw.keys.hidden')}</p>
      )}
      {extra}
    </div>
  );
}

// ---- SSH ----

/** Making an SSH key, or bringing one in from its private file. */
export function NewSsh() {
  const t = useT();
  const vault = useVault();
  const [mode, setMode] = useState<'make' | 'import'>('make');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const text = (k: string) => String(f.get(k) || '');
    setError('');
    setBusy(true);
    try {
      const ssh = await loadSsh();
      let made: { publicKey: string; privateKey: string; fingerprint: string; comment: string; keyType: string };
      if (mode === 'make') {
        const k = await ssh.newSshKey(text('keyType'), text('comment').trim());
        made = { ...k, keyType: k.type };
      } else {
        const read = await ssh.readPrivateKey(text('privateKey'), text('passphrase'));
        made = {
          publicKey: read.publicKey,
          privateKey: await ssh.exportPrivateKey(text('privateKey'), '', text('passphrase')),
          fingerprint: read.fingerprint,
          comment: read.comment,
          keyType: read.publicKey.split(' ')[0],
        };
      }
      const saved = await vault.store.put({
        type: 'ssh',
        name: text('name').trim() || made.comment || made.fingerprint,
        ssh: { ...made, ca: f.get('ca') === 'on', issued: [] },
      });
      location.replace(`#/e/${encodeURIComponent(saved.id)}`);
    } catch (err) {
      setError(tErr(err));
      setBusy(false);
    }
  };
  return (
    <Modal open wide id="editor" title={t('pw.newTitle.ssh')} onClose={() => goBack('#/')}>
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
              {t(`pw.ssh.${m}`)}
            </button>
          ))}
        </div>
        <label className="field">
          <span>{t('pw.field.name')}</span>
          <input name="name" maxLength={200} placeholder={t('pw.ssh.namePlaceholder')} data-autofocus />
        </label>
        {mode === 'make' ? (
          <>
            <label className="field">
              <span>{t('pw.ssh.keyType')}</span>
              <select name="keyType" defaultValue="ed25519">
                <option value="ed25519">Ed25519</option>
                <option value="ecdsa-p256">ECDSA P-256</option>
                <option value="ecdsa-p384">ECDSA P-384</option>
                <option value="rsa-3072">RSA 3072</option>
                <option value="rsa-4096">RSA 4096</option>
              </select>
            </label>
            <label className="field">
              <span>{t('pw.ssh.comment')}</span>
              <input name="comment" maxLength={200} placeholder="ada@laptop" spellCheck={false} autoCapitalize="none" />
            </label>
          </>
        ) : (
          <>
            <label className="field">
              <span>{t('pw.ssh.privateFile')}</span>
              <textarea
                name="privateKey"
                rows={6}
                required
                spellCheck={false}
                autoCapitalize="none"
                className="mono"
                placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
              />
            </label>
            <label className="field">
              <span>{t('pw.ssh.filePassphrase')}</span>
              <input name="passphrase" type="password" autoComplete="off" />
            </label>
          </>
        )}
        <label className="check-row">
          <input type="checkbox" name="ca" />
          <span>
            {t('pw.ssh.asCa')}
            <br />
            <span className="muted small">{t('pw.ssh.asCaText')}</span>
          </span>
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
          <button type="submit" className="btn btn-primary" id="saveEntry" disabled={busy}>
            {busy ? t('pw.keys.working') : t('pw.save')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** An SSH key's parts; for a CA, its lines for servers and the signing of other keys. */
export function SshView({ item }: { item: VaultItem }) {
  const t = useT();
  const vault = useVault();
  const k = item.ssh;
  const [pass, setPass] = useState('');
  const [hosts, setHosts] = useState('*');
  if (!k) return null;
  const base = fileName(item.name);
  const bare = k.publicKey.split(' ').slice(0, 2).join(' ');
  const saveProtected = async () => {
    try {
      const ssh = await loadSsh();
      download(`${base}`, await ssh.exportPrivateKey(k.privateKey, pass), 'application/x-pem-file');
      setPass('');
    } catch (err) {
      toast(tErr(err), 'error');
    }
  };
  return (
    <div className="pw-keys" id="sshView">
      <div className="pw-field" data-field="fingerprint">
        <span className="pw-label">{t('pw.ssh.fingerprint')}</span>
        <span className="pw-value mono" data-value={k.fingerprint}>
          {k.fingerprint}
        </span>
      </div>
      <Block id="public" label={t('pw.ssh.public')} text={k.publicKey} file={`${base}.pub`} />
      <Block
        id="private"
        label={t('pw.ssh.private')}
        text={k.privateKey}
        file={base}
        secret
        extra={
          <div className="pw-inline">
            <input
              type="password"
              id="filePass"
              aria-label={t('pw.ssh.filePassphrase')}
              placeholder={t('pw.ssh.filePassphrase')}
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              autoComplete="new-password"
            />
            <button type="button" className="btn" id="saveProtected" disabled={!pass} onClick={() => void saveProtected()}>
              <Icon name="lock" />
              <span>{t('pw.ssh.saveProtected')}</span>
            </button>
          </div>
        }
      />
      {k.ca ? (
        <>
          <div className="pw-block" id="caLines">
            <span className="pw-label">{t('pw.ssh.trustUsers')}</span>
            <pre className="pw-pre" data-text="trusted">{`TrustedUserCAKeys /etc/ssh/ca.pub\n# /etc/ssh/ca.pub:\n${bare}`}</pre>
            <span className="pw-label">{t('pw.ssh.trustHosts')}</span>
            <div className="pw-inline">
              <input aria-label={t('pw.ssh.hostsPattern')} value={hosts} onChange={(e) => setHosts(e.target.value)} spellCheck={false} />
            </div>
            <pre className="pw-pre" data-text="knownHosts">{`@cert-authority ${hosts || '*'} ${bare}`}</pre>
          </div>
          <SignForm item={item} />
          {k.issued.length ? (
            <details className="pw-history" id="issued">
              <summary>{t('pw.keys.issued', { n: k.issued.length })}</summary>
              <ul>
                {[...k.issued].reverse().map((c) => (
                  <li key={c.serial}>
                    <code>#{c.serial}</code> {c.keyId} · {t(`pw.ssh.${c.type}`)} · {c.principals.join(', ')} ·{' '}
                    {c.validBefore ? t('pw.keys.until', { date: date(c.validBefore) }) : t('pw.ssh.forever')}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </>
      ) : (
        <button type="button" className="btn" id="makeCa" onClick={() => void vault.store.put({ id: item.id, ssh: { ...k, ca: true } })}>
          <Icon name="award" />
          <span>{t('pw.ssh.makeCa')}</span>
        </button>
      )}
    </div>
  );
}

const VALIDITY = [
  ['1h', 3600e3],
  ['1d', 86400e3],
  ['7d', 7 * 86400e3],
  ['30d', 30 * 86400e3],
  ['365d', 365 * 86400e3],
  ['forever', 0],
] as const;
const EXTENSIONS = ['permit-pty', 'permit-port-forwarding', 'permit-agent-forwarding', 'permit-X11-forwarding', 'permit-user-rc'];

/** A key signed by this CA: for a user (logging in as the principals) or a host (answering to its names). */
function SignForm({ item }: { item: VaultItem }) {
  const t = useT();
  const vault = useVault();
  const [kind, setKind] = useState<'user' | 'host'>('user');
  const [result, setResult] = useState<{ certificate: string; file: string } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const k = item.ssh;
  if (!k) return null;
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const text = (n: string) => String(f.get(n) || '').trim();
    const principals = text('principals')
      .split(/[\s,]+/)
      .filter(Boolean);
    const validity = VALIDITY.find(([v]) => v === text('validity'))?.[1] ?? 86400e3;
    setError('');
    setBusy(true);
    try {
      const ssh = await loadSsh();
      const subject = ssh.readPublicKey(text('publicKey'));
      const serial = Math.max(0, ...k.issued.map((c) => c.serial)) + 1;
      const validBefore = validity ? Date.now() + validity : null;
      const { certificate } = await ssh.signCert(k.privateKey, text('publicKey'), {
        type: kind,
        keyId: text('keyId') || subject.comment || 'key',
        principals,
        serial,
        validBefore,
        extensions: kind === 'user' ? EXTENSIONS.filter((x) => f.get(x) === 'on') : [],
        forceCommand: kind === 'user' ? text('forceCommand') : '',
        sourceAddress: kind === 'user' ? text('sourceAddress') : '',
      });
      const fp = await ssh.fingerprint(subject.blob);
      await vault.store.put({
        id: item.id,
        ssh: {
          ...k,
          issued: [...k.issued, { serial, type: kind, keyId: text('keyId') || subject.comment, principals, validBefore, at: Date.now(), fingerprint: fp }],
        },
      });
      setResult({ certificate, file: `${fileName(text('keyId') || subject.comment || 'key')}-cert.pub` });
    } catch (err) {
      setError(tErr(err));
    }
    setBusy(false);
  };
  return (
    <div className="card pw-sign" id="signCard">
      <h3>
        <Icon name="file-key" />
        {t('pw.ssh.sign')}
      </h3>
      <form className="form" id="signForm" onSubmit={submit}>
        <div className="pw-segment" role="radiogroup">
          {(['user', 'host'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={kind === m}
              className={`chip${kind === m ? ' active' : ''}`}
              data-kind={m}
              onClick={() => setKind(m)}
            >
              {t(`pw.ssh.${m}`)}
            </button>
          ))}
        </div>
        <label className="field">
          <span>{t('pw.ssh.toSign')}</span>
          <textarea name="publicKey" rows={3} required spellCheck={false} autoCapitalize="none" className="mono" placeholder="ssh-ed25519 AAAA… ada@laptop" />
        </label>
        <label className="field">
          <span>{t('pw.ssh.keyId')}</span>
          <input name="keyId" maxLength={200} spellCheck={false} />
        </label>
        <label className="field">
          <span>{kind === 'user' ? t('pw.ssh.principalsUser') : t('pw.ssh.principalsHost')}</span>
          <input name="principals" required spellCheck={false} autoCapitalize="none" placeholder={kind === 'user' ? 'ada, deploy' : 'web1.example.org'} />
        </label>
        <label className="field">
          <span>{t('pw.ssh.validity')}</span>
          <select name="validity" defaultValue={kind === 'user' ? '1d' : '365d'} key={kind}>
            {VALIDITY.map(([v]) => (
              <option key={v} value={v}>
                {t(`pw.ssh.valid.${v}`)}
              </option>
            ))}
          </select>
        </label>
        {kind === 'user' ? (
          <details className="pw-more">
            <summary>{t('pw.ssh.options')}</summary>
            {EXTENSIONS.map((x) => (
              <label className="check-row" key={x}>
                <input type="checkbox" name={x} defaultChecked />
                <span className="mono small">{x}</span>
              </label>
            ))}
            <label className="field">
              <span>{t('pw.ssh.forceCommand')}</span>
              <input name="forceCommand" spellCheck={false} autoCapitalize="none" />
            </label>
            <label className="field">
              <span>{t('pw.ssh.sourceAddress')}</span>
              <input name="sourceAddress" spellCheck={false} placeholder="10.0.0.0/8" />
            </label>
          </details>
        ) : null}
        {error ? (
          <p className="form-error" role="alert" id="signError">
            {error}
          </p>
        ) : null}
        <div className="modal-actions">
          <button type="submit" className="btn btn-primary" id="signBtn" disabled={busy}>
            {t('pw.ssh.signBtn')}
          </button>
        </div>
      </form>
      {result ? <Block id="cert" label={t('pw.ssh.certificate')} text={result.certificate} file={result.file} /> : null}
    </div>
  );
}

// ---- X.509 ----

const KEY_TYPES = [
  ['ec-p384', 'ECDSA P-384'],
  ['ec-p256', 'ECDSA P-256'],
  ['rsa-4096', 'RSA 4096'],
  ['rsa-3072', 'RSA 3072'],
  ['rsa-2048', 'RSA 2048'],
];

/** A new root CA, or one brought in from its certificate and key. */
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
        const subject = { cn: text('cn'), o: text('o'), ou: text('ou'), c: text('c') };
        const ca = await x509.createCA({ ...subject, keyType: text('keyType'), days: Math.round(Number(text('years') || 10) * 365.25) });
        pki = {
          kind: 'root',
          keyType: ca.keyType,
          certPem: ca.certPem,
          keyPem: ca.keyPem,
          chainPem: '',
          subject,
          serial: ca.serial,
          notAfter: ca.notAfter,
          issued: [],
        };
      } else {
        const info = await x509.describe(text('certPem'), text('keyPem'));
        pki = {
          kind: info.selfSigned ? 'root' : 'intermediate',
          keyType: info.keyType,
          certPem: text('certPem'),
          keyPem: text('keyPem'),
          chainPem: text('chainPem'),
          subject: info.subject,
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
              <input name="cn" required maxLength={64} placeholder="Example Root CA" data-autofocus />
            </label>
            <div className="pw-two">
              <label className="field">
                <span>{t('pw.ca.o')}</span>
                <input name="o" maxLength={64} />
              </label>
              <label className="field">
                <span>{t('pw.ca.c')}</span>
                <input name="c" maxLength={2} placeholder="DE" />
              </label>
            </div>
            <label className="field">
              <span>{t('pw.ca.ou')}</span>
              <input name="ou" maxLength={64} />
            </label>
            <div className="pw-two">
              <label className="field">
                <span>{t('pw.ca.keyType')}</span>
                <select name="keyType" defaultValue="ec-p384">
                  {KEY_TYPES.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
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

/** A CA or a certificate: its parts to copy and save; a CA issues from here. */
export function PkiView({ item }: { item: VaultItem }) {
  const t = useT();
  const vault = useVault();
  const p = item.pki;
  if (!p) return null;
  const isCa = item.type === 'ca';
  const base = fileName(p.subject.cn || item.name);
  const issuer = p.caId ? vault.store.get(p.caId) : null;
  const sans = [...p.sans.dns, ...p.sans.ips, ...p.sans.emails];
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
      <div className="pw-field" data-field="notAfter">
        <span className="pw-label">{t('pw.ca.validUntil')}</span>
        <span className={`pw-value${p.notAfter < Date.now() ? ' pw-expired' : ''}`}>{date(p.notAfter)}</span>
      </div>
      {issuer ? (
        <div className="pw-field" data-field="issuer">
          <span className="pw-label">{t('pw.ca.issuer')}</span>
          <a className="pw-value" href={`#/e/${encodeURIComponent(issuer.id)}`}>
            {issuer.name}
          </a>
        </div>
      ) : null}
      <Block id="cert" label={t('pw.ca.certificate')} text={p.certPem} file={`${base}.crt`} />
      <Block id="key" label={t('pw.ca.privateKey')} text={p.keyPem} file={`${base}.key`} secret />
      {!isCa || p.kind === 'intermediate' ? <Block id="chain" label={t('pw.ca.chain')} text={p.chainPem} file={`${base}-fullchain.pem`} /> : null}
      {isCa ? <IssueForm item={item} /> : null}
      {isCa && p.issued.length ? (
        <details className="pw-history" id="issued">
          <summary>{t('pw.keys.issued', { n: p.issued.length })}</summary>
          <ul>
            {[...p.issued].reverse().map((c) => (
              <li key={c.serial}>
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

/** A certificate from this CA: for a key made here, or for a CSR whose key stays where it was made. */
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
    const list = (n: string) =>
      text(n)
        .split(/[\s,]+/)
        .filter(Boolean);
    const names = list('names');
    const dns = names.filter((n) => !/^[\d.]+$|:/.test(n) && !n.includes('@'));
    const ips = names.filter((n) => /^[\d.]+$|:/.test(n));
    const emails = names.filter((n) => n.includes('@'));
    setError('');
    setBusy(true);
    try {
      const x509 = await loadX509();
      const csr = text('csr');
      const cn = text('cn') || (csr ? '' : dns[0] || emails[0] || '');
      if (!cn && !csr) throw Object.assign(new Error('A name is needed'), { code: 'ca.error.noName' });
      const out = await x509.issue(
        { keyPem: p.keyPem, certPem: p.certPem, chainPem: p.chainPem },
        { kind, cn, o: text('o'), dns, ips, emails, days: Number(text('days')) || (kind === 'ca' ? 1825 : 397), keyType: text('keyType'), csr },
      );
      const info = await x509.describe(out.certPem);
      const entry = await vault.store.put({
        type: kind === 'ca' ? 'ca' : 'cert',
        name: info.subject.cn || cn,
        pki: {
          kind: kind === 'ca' ? 'intermediate' : kind,
          keyType: info.keyType,
          certPem: out.certPem,
          keyPem: out.keyPem,
          chainPem: out.chainPem,
          subject: info.subject,
          sans: info.sans,
          serial: out.serial,
          notAfter: out.notAfter,
          caId: item.id,
          issued: [],
        },
      });
      await vault.store.put({
        id: item.id,
        pki: {
          ...p,
          issued: [
            ...p.issued,
            {
              serial: out.serial,
              cn: info.subject.cn || cn,
              kind: kind === 'ca' ? 'intermediate' : kind,
              notAfter: out.notAfter,
              at: Date.now(),
              entryId: entry.id,
            },
          ],
        },
      });
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
          <span>{t('pw.ca.cn')}</span>
          <input
            name="cn"
            maxLength={64}
            spellCheck={false}
            autoCapitalize="none"
            placeholder={kind === 'ca' ? 'Example Intermediate CA' : kind === 'server' ? 'www.example.org' : 'ada'}
          />
        </label>
        {kind !== 'ca' ? (
          <label className="field">
            <span>{t('pw.ca.names')}</span>
            <textarea name="names" rows={2} spellCheck={false} autoCapitalize="none" className="mono" placeholder="www.example.org example.org 10.0.0.5" />
          </label>
        ) : null}
        <div className="pw-two">
          <label className="field">
            <span>{t('pw.ca.days')}</span>
            <input name="days" type="number" min={1} max={3650} defaultValue={kind === 'ca' ? 1825 : 397} key={kind} />
          </label>
          <label className="field">
            <span>{t('pw.ca.keyType')}</span>
            <select name="keyType" defaultValue={kind === 'ca' ? 'ec-p384' : 'ec-p256'} key={`k-${kind}`}>
              {KEY_TYPES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
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
