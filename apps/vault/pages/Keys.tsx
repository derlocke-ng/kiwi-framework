// SSH keys in the vault (0.28): keys made here or brought in, their private
// file given out with or without a passphrase, and an SSH key used as a
// certificate authority signing other keys for users and hosts. The crypto is
// shared/ssh.js, loaded on first use. Certificates for TLS are in Tls.tsx; the
// block that shows a key or a certificate is shared with it.
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

export const fileName = (s: string) => (s || 'key').replace(/[^\w.@-]+/g, '-').replace(/^-+|-+$/g, '') || 'key';
export const date = (ms: number | null) => (ms ? new Date(ms).toLocaleDateString() : '');

/**
 * A block of text (a key, a certificate) to copy and save, hidden until shown when it is secret. Give each a `key`
 * as well as its id: a view that swaps blocks would otherwise hand one block's shown state to another.
 */
export function Block({
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
      <Block key="public" id="public" label={t('pw.ssh.public')} text={k.publicKey} file={`${base}.pub`} />
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
      {result ? <Block key="cert" id="cert" label={t('pw.ssh.certificate')} text={result.certificate} file={result.file} /> : null}
    </div>
  );
}
