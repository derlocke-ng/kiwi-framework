// Making or changing an entry, in a sheet over the list: the fields its kind
// has (a login: who, the password with the generator beside it and its
// strength, sites, a 2FA secret; a card: its numbers; a note: text), custom
// fields, tags. Saved, the entry opens; a new password puts the old one in the
// entry's history (shared/vaultstore.js).
import { type FormEvent, useState } from 'react';
import { ALGORITHMS, cleanEntry, parseOtpauth } from '../../../shared/totp.js';
import { Icon } from '../../../ui/components';
import { useT } from '../../../ui/hooks';
import { goBack } from '../../../ui/route';
import { toastError } from '../../../ui/toast';
import { useVault, type VaultItem } from '../../../ui/vault/VaultProvider';
import { Modal } from '../../../ui/widgets/Modal';
import { NEW_TYPES } from './common';
import { StrengthBar } from './EntryView';
import { Generator } from './Generator';

type Field = { name: string; value: string; hidden: boolean };

/** A 2FA secret as typed: an otpauth:// link (its settings kept) or the base32 secret; undefined when it is neither. */
function totpFrom(text: string, algorithm: string, digits: number, period: number) {
  const s = text.trim();
  if (!s) return null;
  const e = s.startsWith('otpauth:') ? parseOtpauth(s) : cleanEntry({ secret: s, algorithm, digits, period });
  return e ? { secret: e.secret, algorithm: e.algorithm, digits: e.digits, period: e.period } : undefined;
}

export function Editor({ item, type }: { item?: VaultItem; type?: string }) {
  const t = useT();
  const vault = useVault();
  const kind = item?.type || (type && NEW_TYPES.includes(type) ? type : 'login');
  const [password, setPassword] = useState(item?.password || '');
  const [showPass, setShowPass] = useState(!item);
  const [generating, setGenerating] = useState(false);
  const [fields, setFields] = useState<Field[]>(item?.fields || []);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const close = () => goBack(item ? `#/e/${encodeURIComponent(item.id)}` : '#/');

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const text = (k: string) => String(f.get(k) || '');
    const totp =
      kind === 'login' || kind === 'totp'
        ? totpFrom(text('totp'), text('algorithm') || 'SHA1', Number(text('digits') || 6), Number(text('period') || 30))
        : null;
    if (totp === undefined) return setError(t('pw.badSecret'));
    if (kind === 'totp' && !totp) return setError(t('pw.badSecret'));
    const patch: Record<string, any> = {
      id: item?.id,
      type: kind,
      name: text('name').trim(),
      username: text('username'),
      notes: text('notes'),
      tags: text('tags')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      fields: fields.filter((x) => x.name || x.value),
    };
    if (kind === 'login') {
      patch.password = password;
      patch.urls = text('urls')
        .split(/\n+/)
        .map((s) => s.trim())
        .filter(Boolean);
      patch.totp = totp;
    }
    if (kind === 'totp') patch.totp = totp;
    if (kind === 'card') patch.card = { holder: text('holder'), number: text('number'), exp: text('exp'), code: text('code'), brand: text('brand') };
    setBusy(true);
    try {
      const saved = await vault.store.put(patch);
      // a change goes back to the entry it was opened from; a new entry takes the editor's place in the history
      if (item) goBack(`#/e/${encodeURIComponent(saved.id)}`);
      else location.replace(`#/e/${encodeURIComponent(saved.id)}`);
    } catch (err) {
      toastError(err);
      setBusy(false);
    }
  };

  const setField = (i: number, patch: Partial<Field>) => setFields(fields.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  return (
    <Modal open wide id="editor" title={item ? t('pw.editTitle', { name: item.name || t('pw.unnamed') }) : t(`pw.newTitle.${kind}`)} onClose={close}>
      <form className="form" id="entryForm" onSubmit={submit}>
        <label className="field">
          <span>{t('pw.field.name')}</span>
          <input name="name" defaultValue={item?.name || ''} maxLength={200} required data-autofocus />
        </label>
        {kind === 'login' || kind === 'totp' ? (
          <label className="field">
            <span>{kind === 'totp' ? t('pw.field.account') : t('pw.field.username')}</span>
            <input name="username" defaultValue={item?.username || ''} autoComplete="off" spellCheck={false} autoCapitalize="none" />
          </label>
        ) : null}
        {kind === 'login' ? (
          <>
            <div className="field">
              <span>{t('pw.field.password')}</span>
              <div className="pw-password-row">
                <input
                  name="password"
                  type={showPass ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  spellCheck={false}
                  autoCapitalize="none"
                  className="mono"
                />
                <button
                  type="button"
                  className="icon-btn"
                  data-act="show-password"
                  aria-label={showPass ? t('pw.hide') : t('pw.show')}
                  onClick={() => setShowPass(!showPass)}
                >
                  <Icon name={showPass ? 'eye-off' : 'eye'} />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  id="openGenerator"
                  aria-label={t('pw.generator')}
                  title={t('pw.generator')}
                  onClick={() => setGenerating(!generating)}
                >
                  <Icon name="wand-sparkles" />
                </button>
              </div>
              <StrengthBar password={password} />
            </div>
            {generating ? (
              <div className="card pw-inline-gen">
                <Generator
                  onUse={(value) => {
                    setPassword(value);
                    setShowPass(true);
                    setGenerating(false);
                  }}
                />
              </div>
            ) : null}
            <label className="field">
              <span>{t('pw.field.urls')}</span>
              <textarea name="urls" rows={2} defaultValue={(item?.urls || []).join('\n')} spellCheck={false} autoCapitalize="none" placeholder="https://" />
            </label>
          </>
        ) : null}
        {kind === 'card' ? (
          <>
            <label className="field">
              <span>{t('pw.field.holder')}</span>
              <input name="holder" defaultValue={item?.card?.holder || ''} autoComplete="off" />
            </label>
            <label className="field">
              <span>{t('pw.field.number')}</span>
              <input name="number" defaultValue={item?.card?.number || ''} inputMode="numeric" autoComplete="off" className="mono" />
            </label>
            <div className="pw-two">
              <label className="field">
                <span>{t('pw.field.exp')}</span>
                <input name="exp" defaultValue={item?.card?.exp || ''} placeholder="MM/YY" maxLength={7} autoComplete="off" />
              </label>
              <label className="field">
                <span>{t('pw.field.cvc')}</span>
                <input name="code" defaultValue={item?.card?.code || ''} inputMode="numeric" maxLength={8} autoComplete="off" />
              </label>
            </div>
            <label className="field">
              <span>{t('pw.field.brand')}</span>
              <input name="brand" defaultValue={item?.card?.brand || ''} autoComplete="off" />
            </label>
          </>
        ) : null}
        {kind === 'login' || kind === 'totp' ? (
          <>
            <label className="field">
              <span>{kind === 'totp' ? t('pw.field.secret') : t('pw.field.totp')}</span>
              <input
                name="totp"
                defaultValue={item?.totp?.secret || ''}
                required={kind === 'totp'}
                autoComplete="off"
                spellCheck={false}
                autoCapitalize="none"
                className="mono"
                placeholder="otpauth://totp/… · JBSW Y3DP EHPK 3PXP"
              />
            </label>
            <details className="pw-more">
              <summary>{t('pw.totpMore')}</summary>
              <div className="pw-three">
                <label className="field">
                  <span>{t('pw.field.algorithm')}</span>
                  <select name="algorithm" defaultValue={item?.totp?.algorithm || 'SHA1'}>
                    {ALGORITHMS.map((a: string) => (
                      <option key={a} value={a}>
                        {a}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>{t('pw.field.digits')}</span>
                  <select name="digits" defaultValue={String(item?.totp?.digits || 6)}>
                    {[6, 7, 8].map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>{t('pw.field.period')}</span>
                  <select name="period" defaultValue={String(item?.totp?.period || 30)}>
                    {[30, 60].map((p) => (
                      <option key={p} value={p}>
                        {p} s
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </details>
          </>
        ) : null}
        <label className="field">
          <span>{t('pw.field.notes')}</span>
          <textarea name="notes" rows={kind === 'note' ? 8 : 3} defaultValue={item?.notes || ''} />
        </label>
        <div className="pw-fields" id="customFields">
          {fields.map((x, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: fields have no ids; their order is what tells them apart
            <div className="pw-custom" key={i}>
              <input
                aria-label={t('pw.field.fieldName')}
                placeholder={t('pw.field.fieldName')}
                value={x.name}
                onChange={(e) => setField(i, { name: e.target.value })}
              />
              <input
                aria-label={t('pw.field.fieldValue')}
                placeholder={t('pw.field.fieldValue')}
                type={x.hidden ? 'password' : 'text'}
                value={x.value}
                onChange={(e) => setField(i, { value: e.target.value })}
                autoComplete="off"
              />
              <label className="check-row" title={t('pw.field.hidden')}>
                <input type="checkbox" checked={x.hidden} onChange={(e) => setField(i, { hidden: e.target.checked })} />
                <span className="small">{t('pw.field.hidden')}</span>
              </label>
              <button type="button" className="icon-btn" aria-label={t('common.delete')} onClick={() => setFields(fields.filter((_, k) => k !== i))}>
                <Icon name="x" />
              </button>
            </div>
          ))}
          <button type="button" className="btn" id="addField" onClick={() => setFields([...fields, { name: '', value: '', hidden: false }])}>
            <Icon name="plus" />
            <span>{t('pw.addField')}</span>
          </button>
        </div>
        <label className="field">
          <span>{t('pw.field.tags')}</span>
          <input name="tags" defaultValue={(item?.tags || []).join(', ')} placeholder={t('pw.tagsHint')} />
        </label>
        {error ? (
          <p className="form-error" role="alert" id="editorError">
            {error}
          </p>
        ) : null}
        <div className="modal-actions">
          <button type="button" className="btn" data-close onClick={close}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn-primary" id="saveEntry" disabled={busy}>
            {t('pw.save')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
