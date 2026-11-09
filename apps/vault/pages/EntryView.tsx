// One entry, opened over the list: each field with a button that copies it,
// secrets hidden until shown, the 2FA code live, the sites to open, custom
// fields, the earlier passwords; pinning it to the top, editing, deleting.
import { useState } from 'react';
import { Icon } from '../../../ui/components';
import { confirmDialog } from '../../../ui/dialogs';
import { useT } from '../../../ui/hooks';
import { goBack } from '../../../ui/route';
import { toast } from '../../../ui/toast';
import { useVault, type VaultItem } from '../../../ui/vault/VaultProvider';
import { strength } from '../data/strength.js';
import { CodeLine, copySecret, openable, TYPE_ICON } from './common';
import { PkiView, SshView } from './Keys';

function Field({ id, label, value, secret = false, mono = false }: { id: string; label: string; value: string; secret?: boolean; mono?: boolean }) {
  const t = useT();
  const [shown, setShown] = useState(false);
  if (!value) return null;
  return (
    <div className="pw-field" data-field={id}>
      <span className="pw-label">{label}</span>
      <span className={`pw-value${mono || secret ? ' mono' : ''}`} data-value={shown || !secret ? value : ''}>
        {secret && !shown ? '••••••••••' : value}
      </span>
      <span className="pw-actions">
        {secret ? (
          <button type="button" className="icon-btn" data-act={`show-${id}`} aria-label={shown ? t('pw.hide') : t('pw.show')} onClick={() => setShown(!shown)}>
            <Icon name={shown ? 'eye-off' : 'eye'} />
          </button>
        ) : null}
        <button
          type="button"
          className="icon-btn"
          data-act={`copy-${id}`}
          aria-label={t('pw.copy', { what: label })}
          onClick={() => void copySecret(value, label)}
        >
          <Icon name="copy" />
        </button>
      </span>
    </div>
  );
}

const LEVELS = ['veryWeak', 'weak', 'fair', 'strong', 'veryStrong'];

export function StrengthBar({ password }: { password: string }) {
  const t = useT();
  if (!password) return null;
  const { level } = strength(password);
  return (
    <span className={`pw-strength level-${level}`} data-level={level}>
      <span style={{ width: `${(level + 1) * 20}%` }} />
      <em>{t(`pw.strength.${LEVELS[level]}`)}</em>
    </span>
  );
}

export function EntryView({ item }: { item: VaultItem }) {
  const t = useT();
  const vault = useVault();
  const date = (ms: number) => (ms ? new Date(ms).toLocaleDateString() : '');
  const remove = async () => {
    if (
      !(await confirmDialog({
        title: t('pw.deleteTitle', { name: item.name || t('pw.unnamed') }),
        message: t('pw.deleteText'),
        confirm: t('common.delete'),
        danger: true,
      }))
    )
      return;
    await vault.store.remove(item.id);
    toast(t('pw.deleted'), 'success');
    goBack('#/');
  };
  return (
    <div className="pw-entry" id="entryView" data-entry={item.name}>
      <div className="pw-entry-head">
        <span className={`pw-icon type-${item.type}`}>
          <Icon name={TYPE_ICON[item.type] || 'file'} />
        </span>
        <span className="muted small">{t(`pw.type.${item.type}`)}</span>
        <button
          type="button"
          className={`icon-btn${item.fav ? ' on' : ''}`}
          id="favBtn"
          aria-pressed={item.fav}
          aria-label={item.fav ? t('pw.unpin') : t('pw.pin')}
          title={item.fav ? t('pw.unpin') : t('pw.pin')}
          onClick={() => void vault.store.put({ id: item.id, fav: !item.fav })}
        >
          <Icon name="star" />
        </button>
      </div>
      <Field id="username" label={t('pw.field.username')} value={item.username} />
      {item.password ? (
        <>
          <Field id="password" label={t('pw.field.password')} value={item.password} secret />
          <StrengthBar password={item.password} />
        </>
      ) : null}
      {item.totp ? (
        <div className="pw-field" data-field="code">
          <span className="pw-label">{t('pw.field.code')}</span>
          <CodeLine secret={item.totp} />
        </div>
      ) : null}
      {item.card ? (
        <>
          <Field id="holder" label={t('pw.field.holder')} value={item.card.holder} />
          <Field id="number" label={t('pw.field.number')} value={item.card.number} secret />
          <Field id="exp" label={t('pw.field.exp')} value={item.card.exp} mono />
          <Field id="cvc" label={t('pw.field.cvc')} value={item.card.code} secret />
          <Field id="brand" label={t('pw.field.brand')} value={item.card.brand} />
        </>
      ) : null}
      {item.ssh ? <SshView item={item} /> : null}
      {item.pki ? <PkiView item={item} /> : null}
      {item.urls.map((url, i) => {
        const href = openable(url);
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: two sites may be the same address; their place tells them apart
          <div className="pw-field" data-field="url" key={`${i}-${url}`}>
            <span className="pw-label">{t('pw.field.url')}</span>
            <span className="pw-value">{url}</span>
            <span className="pw-actions">
              {href ? (
                <a className="icon-btn" href={href} target="_blank" rel="noopener noreferrer" aria-label={t('pw.openSite')} title={t('pw.openSite')}>
                  <Icon name="external-link" />
                </a>
              ) : null}
              <button
                type="button"
                className="icon-btn"
                aria-label={t('pw.copy', { what: t('pw.field.url') })}
                onClick={() => void copySecret(url, t('pw.field.url'))}
              >
                <Icon name="copy" />
              </button>
            </span>
          </div>
        );
      })}
      {item.fields.map((f, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: fields have no ids; their place tells them apart
        <Field key={`${i}-${f.name}`} id={`field${i}`} label={f.name || t('pw.field.custom')} value={f.value} secret={f.hidden} />
      ))}
      {item.notes ? (
        <div className="pw-notes" id="notes">
          <span className="pw-label">{t('pw.field.notes')}</span>
          <p>{item.notes}</p>
        </div>
      ) : null}
      {item.tags.length ? (
        <p className="pw-tags">
          {item.tags.map((tag) => (
            <span key={tag} className="chip">
              {tag}
            </span>
          ))}
        </p>
      ) : null}
      {item.history.length ? (
        <details className="pw-history" id="history">
          <summary>{t('pw.history', { n: item.history.length })}</summary>
          <ul>
            {item.history.map((h, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: two changes in one moment are told apart by their place
              <li key={`${h.at}-${i}`}>
                <span className="muted small">{date(h.at)}</span> <code>{h.password}</code>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <p className="muted small pw-meta">
        {t('pw.updated', { date: date(item.updated) })}
        {item.password && item.changed ? ` · ${t('pw.changed', { date: date(item.changed) })}` : ''}
      </p>
      <div className="modal-actions">
        <button type="button" className="btn btn-danger" id="deleteBtn" onClick={() => void remove()}>
          <Icon name="trash-2" />
          <span>{t('common.delete')}</span>
        </button>
        <a className="btn btn-primary" id="editBtn" href={`#/e/${encodeURIComponent(item.id)}/edit`}>
          <Icon name="pencil" />
          <span>{t('pw.edit')}</span>
        </a>
      </div>
    </div>
  );
}
