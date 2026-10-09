// The site's settings. Each card is its own component; they share nothing
// but the runtime, so a fork can drop or reorder cards without touching the rest.
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { adoptIdentity, decodeKey, forgetIdentity, npub, pubkeyOf } from '../../shared/account.js';
import { MOUNTS } from '../../shared/apps.js';
import { decryptBackup, encryptBackup } from '../../shared/backup.js';
import { DISTRIBUTION } from '../../shared/distribution.js';
import { fingerprint, isHex64 } from '../../shared/events.js';
import { currentLanguage, fmtDateTime, LANGUAGES, tErr } from '../../shared/i18n.js';
import { CORES_KEY, cores, hardwareCores } from '../../shared/pow.js';
import { DEFAULT_RELAYS, normalizeRelayUrl, savedRelays, saveRelays } from '../../shared/relays.js';
import { theme } from '../../shared/theme.js';
import { store } from '../../shared/util.js';
import { Icon, RelayList, StatusPill, Toasts, TopBar } from '../../ui/components';
import { useBlocks, useIdentity, useKiwi, useKiwiTick, usePeople, useRelayInfos, useT } from '../../ui/hooks';
import { usePeopleNotices } from '../../ui/notices';
import { copyText, toast } from '../../ui/toast';
import { Account } from './Account';

const LAST_BACKUP = 'wjs.lastBackup';
const fail = (err: unknown) => toast(tErr(err), 'error');

function Card({ id, icon, title, children, className = '' }: { id: string; icon: string; title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`.trim()} id={id} aria-labelledby={`${id}Title`}>
      <h2 id={`${id}Title`}>
        <Icon name={icon} />
        <span>{title}</span>
      </h2>
      {children}
    </section>
  );
}

function AccountCard() {
  const t = useT();
  return (
    <Card id="account" icon="key-round" title={t('hub.account')}>
      <div id="accountBody">
        <Account full />
      </div>
    </Card>
  );
}

function DeviceCard() {
  const kiwi = useKiwi();
  const t = useT();
  useKiwiTick();
  const th = theme();
  return (
    <Card id="device" icon="languages" title={t('settings.deviceSettings')}>
      <p className="muted">{t('settings.deviceText')}</p>
      <div className="device-settings">
        <label className="lang-foot">
          <Icon name="languages" />
          <select id="langSelect" aria-label={t('lang.title')} value={currentLanguage()} onChange={(e) => kiwi.chooseLanguage(e.target.value)}>
            {Object.entries(LANGUAGES).map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <div className="seg" id="themeSeg" role="radiogroup" aria-label={t('account.appearance')}>
          {['system', 'light', 'dark'].map((v) => (
            <label key={v}>
              <input type="radio" name="theme" value={v} checked={th === v} onChange={() => kiwi.chooseTheme(v)} />
              <span>{t(`account.theme.${v}`)}</span>
            </label>
          ))}
        </div>
      </div>
    </Card>
  );
}

/** Proof of work is a device matter: how many cores the shared miner may use. */
function PowCard() {
  const t = useT();
  const [n, setN] = useState(cores());
  const max = Math.max(hardwareCores(), n);
  return (
    <Card id="pow" icon="shield" title={t('settings.pow')}>
      <p className="muted" id="powText">
        {t('settings.powText', { n: hardwareCores() })}
      </p>
      <label className="field cores">
        <span>{t('settings.cores')}</span>
        <select
          id="coresSelect"
          value={n}
          onChange={(e) => {
            const v = Number(e.target.value);
            store.set(CORES_KEY, v);
            setN(v);
          }}
        >
          {Array.from({ length: max }, (_, i) => i + 1).map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </label>
    </Card>
  );
}

function AppsCard() {
  const kiwi = useKiwi();
  const t = useT();
  useKiwiTick();
  const hidden = kiwi.hiddenApps();
  return (
    <Card id="apps" icon="list-checks" title={t('settings.apps')}>
      <p className="muted">{t('settings.appsText')}</p>
      <ul className="app-toggles" id="appToggles">
        {MOUNTS.map((app) => (
          <li key={app.id}>
            <label className="check-row">
              <input
                type="checkbox"
                data-app={app.id}
                checked={!hidden.includes(app.id)}
                onChange={(e) => kiwi.setAppHidden(app.id, !e.target.checked).catch(fail)}
              />
              <span>{app.name}</span>
            </label>
          </li>
        ))}
      </ul>
    </Card>
  );
}

const Fp = ({ pk }: { pk: string }) => <code title={npub(pk)}>{fingerprint(pk)}</code>;
const Who = ({ name, pk }: { name?: string; pk: string }) => (
  <span className="who">
    {name ? (
      <>
        <b>{name}</b>{' '}
      </>
    ) : null}
    <Fp pk={pk} />
  </span>
);

/** A form with one text field that resets itself after `onSubmit` succeeds. */
function OneField({
  id,
  name,
  label,
  button,
  placeholder,
  maxLength,
  onSubmit,
}: {
  id: string;
  name: string;
  label: string;
  button: string;
  placeholder?: string;
  maxLength?: number;
  onSubmit: (value: string) => Promise<boolean | undefined> | boolean | undefined;
}) {
  const [value, setValue] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if ((await onSubmit(value.trim())) !== false) setValue('');
  };
  return (
    <form className="form" id={id} onSubmit={submit}>
      <label className="field">
        <span>{label}</span>
        <input
          name={name}
          placeholder={placeholder}
          maxLength={maxLength}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          required
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </label>
      <div className="form-actions">
        <button type="submit" className="btn btn-sm">
          {button}
        </button>
      </div>
    </form>
  );
}

function PeopleCard() {
  const t = useT();
  const id = useIdentity();
  const people = usePeople();
  if (!people) return null;
  const act = (p: Promise<unknown>) => p.catch(fail);
  const incoming = people.incoming();
  const outgoing = people.outgoing();
  const friends = people.friends();
  const request = async (who: string) => {
    let pk: string;
    try {
      pk = decodeKey(who);
    } catch {
      toast(t('settings.blockInvalid'), 'error');
      return false;
    }
    if (pk === id.pk) {
      toast(t('settings.selfKey'), 'error');
      return false;
    }
    try {
      const result = await people.request(pk);
      toast(t(result === 'friends' ? 'settings.nowFriends' : 'settings.requestSent'), 'success');
      return true;
    } catch (err) {
      fail(err);
      return false;
    }
  };
  return (
    <Card id="people" icon="users" title={t('settings.people')}>
      <p className="muted">{t('settings.peopleText')}</p>
      <p className="small my-key">
        <span>{t('settings.yourKey')}</span> <code id="myNpub">{npub(id.pk)}</code>{' '}
        <button type="button" className="link-btn" data-act="copy-npub" onClick={() => copyText(npub(id.pk), t('account.publicKey'))}>
          {t('account.copyNpub')}
        </button>
      </p>
      <ul className="people-list" id="requestList" hidden={!incoming.length && !outgoing.length}>
        {incoming.map((r: any) => (
          <li key={`in-${r.pk}`} data-pk={r.pk}>
            <Who name={r.name} pk={r.pk} />
            <span className="muted small">{t('settings.requestIncoming')}</span>
            <span className="actions">
              <button type="button" className="btn btn-sm btn-primary" data-accept={r.pk} onClick={() => act(people.accept(r.pk))}>
                {t('settings.accept')}
              </button>
              <button type="button" className="btn btn-sm btn-ghost" data-ignore={r.pk} onClick={() => act(people.ignore(r.pk))}>
                {t('settings.ignore')}
              </button>
            </span>
          </li>
        ))}
        {outgoing.map((r: any) => (
          <li key={`out-${r.pk}`} data-pk={r.pk}>
            <Who pk={r.pk} />
            <span className="muted small">{t('settings.requestOutgoing')}</span>
            <span className="actions">
              <button type="button" className="btn btn-sm btn-ghost" data-cancel={r.pk} onClick={() => act(people.cancel(r.pk))}>
                {t('settings.cancelRequest')}
              </button>
            </span>
          </li>
        ))}
      </ul>
      <ul className="people-list" id="friendList">
        {friends.length ? (
          friends.map((f: any) => (
            <li key={f.pk} data-pk={f.pk}>
              <Who name={f.name} pk={f.pk} />
              <span className="actions">
                <button type="button" className="btn btn-sm btn-ghost" data-remove={f.pk} onClick={() => act(people.remove(f.pk))}>
                  {t('settings.removeFriend')}
                </button>
              </span>
            </li>
          ))
        ) : (
          <li className="muted small">{t('settings.noFriends')}</li>
        )}
      </ul>
      <OneField id="friendForm" name="who" label={t('settings.friendAdd')} button={t('settings.friendSend')} placeholder="npub1…" onSubmit={request} />
    </Card>
  );
}

function CirclesCard() {
  const t = useT();
  const people = usePeople();
  if (!people) return null;
  const friends = people.friends();
  const toggle = (circle: any, pk: string, on: boolean) => {
    const members = on ? [...circle.members, pk] : circle.members.filter((m: string) => m !== pk);
    people.circleSet(circle.id, members).catch(fail);
  };
  return (
    <Card id="circles" icon="users-round" title={t('settings.circles')}>
      <p className="muted">{t('settings.circlesText')}</p>
      <div className="circle-list" id="circleList">
        {people.circles().map((c: any) => (
          <div className="circle" data-circle={c.id} key={c.id}>
            <div className="circle-head">
              <b>{c.name}</b>
              <button type="button" className="btn btn-sm btn-ghost" data-circle-delete={c.id} onClick={() => people.circleRemove(c.id).catch(fail)}>
                {t('settings.circleDelete')}
              </button>
            </div>
            {friends.length ? (
              <ul className="people-list">
                {friends.map((f: any) => (
                  <li key={f.pk}>
                    <label className="check-row">
                      <input
                        type="checkbox"
                        data-circle-member={c.id}
                        value={f.pk}
                        checked={c.members.includes(f.pk)}
                        onChange={(e) => toggle(c, f.pk, e.target.checked)}
                      />
                      <span>
                        {f.name ? `${f.name} ` : ''}
                        <Fp pk={f.pk} />
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted small">{t('settings.circleEmpty')}</p>
            )}
          </div>
        ))}
      </div>
      <OneField
        id="circleForm"
        name="name"
        label={t('settings.circleAdd')}
        button={t('settings.circleCreate')}
        maxLength={40}
        onSubmit={async (name) => {
          if (!name) return false;
          try {
            await people.circleCreate(name);
            return true;
          } catch (err) {
            fail(err);
            return false;
          }
        }}
      />
    </Card>
  );
}

function RelaysCard() {
  const kiwi = useKiwi();
  const { net } = kiwi;
  const t = useT();
  const infos = useRelayInfos();
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState(() => savedRelays().join('\n'));
  const syncNow = async () => {
    setBusy(true);
    try {
      await net.sync.healAll();
      toast(t('account.synced'), 'success');
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };
  const diagnostics = async () => {
    const id = kiwi.identity();
    const box = await net.sync.outbox();
    const kinds: Record<number, number> = {};
    for (const ev of await net.db.byAuthor(id.pk)) kinds[ev.kind] = (kinds[ev.kind] || 0) + 1;
    const report = {
      at: new Date().toISOString(),
      lang: currentLanguage(),
      account: Boolean(id.alias),
      pubkey: id.pk,
      ownEventsByKind: kinds,
      outbox: box,
      relays: net.pool.status().relays.map((r: any) => ({
        url: r.url,
        open: r.open,
        latency: r.latency,
        lastOk: r.lastOkAt ? new Date(r.lastOkAt).toISOString() : null,
        publishError: r.publishError,
        connectError: r.error || null,
        info: infos.get(r.url)?.name || null,
      })),
      userAgent: navigator.userAgent,
    };
    copyText(JSON.stringify(report, null, 2), t('account.diagnostics'));
  };
  const save = (e: FormEvent) => {
    e.preventDefault();
    const list = text.split('\n').filter((l) => l.trim());
    if (list.some((l) => !normalizeRelayUrl(l))) return toast(t('account.invalidRelay'), 'error');
    saveRelays(list);
    location.reload();
  };
  return (
    <Card id="relays" icon="radio-tower" title={t('account.relays')}>
      <p className="muted">{t('account.relaysText')}</p>
      <RelayList detailed />
      <div className="form-actions">
        <button type="button" className="btn btn-sm" data-act="sync-now" disabled={busy} onClick={syncNow}>
          <span>{t('account.syncNow')}</span>
        </button>
        <button type="button" className="btn btn-sm btn-ghost" data-act="diagnostics" onClick={diagnostics}>
          <span>{t('account.diagnostics')}</span>
        </button>
      </div>
      <details className="relay-edit">
        <summary>{t('account.editRelays')}</summary>
        <form className="form" id="relayForm" onSubmit={save}>
          <label className="field">
            <span>{t('account.oneUrlPerLine')}</span>
            <textarea name="relays" rows={5} spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} />
          </label>
          <div className="form-actions">
            <button type="submit" className="btn btn-sm" dangerouslySetInnerHTML={{ __html: t('account.saveReconnect') }} />
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              data-act="relay-reset"
              onClick={() => {
                saveRelays(DEFAULT_RELAYS);
                location.reload();
              }}
            >
              {t('account.resetRelays')}
            </button>
          </div>
        </form>
      </details>
    </Card>
  );
}

function BackupCard() {
  const kiwi = useKiwi();
  const t = useT();
  const id = useIdentity();
  const [panel, setPanel] = useState<'none' | 'backup' | 'restore'>('none');
  const [last, setLast] = useState<number | null>(() => store.get(LAST_BACKUP, null));
  const [progress, setProgress] = useState('');
  const [restoreError, setRestoreError] = useState('');
  const [busy, setBusy] = useState(false);
  const file = useRef<File | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const backup = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const pass = String(f.get('pass') || '');
    if (pass.length < 10) return toast(t('account.export.min10'), 'error');
    if (pass !== String(f.get('pass2') || '')) return toast(t('account.backupDialog.mismatch'), 'error');
    setProgress(t('account.backupDialog.encrypting'));
    try {
      const events = await kiwi.net.db.all();
      const payload = { app: 'kiwi', v: 3, created: new Date().toISOString(), identity: kiwi.identity(), events };
      const out = await encryptBackup(payload, pass);
      const url = URL.createObjectURL(new Blob([JSON.stringify(out)], { type: 'application/json' }));
      const a = Object.assign(document.createElement('a'), {
        href: url,
        download: `${DISTRIBUTION.id}-backup-${id.alias || 'device'}-${new Date().toISOString().slice(0, 10)}.json`,
      });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      const now = Date.now();
      store.set(LAST_BACKUP, now);
      setLast(now);
      setPanel('none');
      toast(t('settings.backedUp', { n: events.length }), 'success');
    } catch (err) {
      fail(err);
    } finally {
      setProgress('');
    }
  };

  const restore = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!file.current) return;
    const pass = String(new FormData(e.currentTarget).get('pass') || '');
    setRestoreError('');
    setBusy(true);
    try {
      setProgress(t('account.restoreDialog.decrypting'));
      const payload = await decryptBackup(JSON.parse(await file.current.text()), pass);
      const rid = payload.identity;
      if (!isHex64(rid?.sk) || pubkeyOf(rid.sk) !== rid.pk) throw new Error(t('account.restoreDialog.noKey'));
      const events = Array.isArray(payload.events) ? payload.events : [];
      setProgress(t('session.restoring', { n: events.length }));
      for (const ev of events) await kiwi.net.db.put(ev);
      adoptIdentity({ sk: rid.sk, pk: rid.pk, alias: rid.alias || null, accountPk: rid.accountPk || null, created: Date.now() });
      for (const ev of events) kiwi.net.sync.publish(ev).catch(() => {});
      setProgress(t('session.syncing'));
      await new Promise((r) => setTimeout(r, 1500));
      location.reload();
    } catch (err) {
      setRestoreError(err instanceof SyntaxError ? t('account.restoreDialog.notJson') : tErr(err));
      setBusy(false);
      setProgress('');
    }
  };

  return (
    <Card id="backup" icon="shield" title={t('account.backup')}>
      <p className="muted">{t('settings.backupText')}</p>
      <div className="form-actions">
        <button type="button" className="btn" data-act="backup" onClick={() => setPanel('backup')}>
          <span>{t('account.downloadBackup')}</span>
        </button>
        <label className="btn btn-ghost file-btn">
          <span>{t('account.restoreBackup')}</span>
          <input
            type="file"
            accept=".json,application/json"
            id="restoreFile"
            hidden
            ref={fileInput}
            onChange={(e) => {
              file.current = e.target.files?.[0] || null;
              setRestoreError('');
              setPanel(file.current ? 'restore' : 'none');
            }}
          />
        </label>
      </div>
      <p className="muted small" id="lastBackup">
        {last ? t('account.lastBackup', { when: fmtDateTime(last) }) : ''}
      </p>
      <form className="form passphrase" id="backupForm" hidden={panel !== 'backup'} onSubmit={backup}>
        <p className="small">{t('account.backupDialog.text')}</p>
        <label className="field">
          <span>{t('account.backupDialog.passphrase')}</span>
          <input name="pass" type="password" autoComplete="new-password" required minLength={10} />
        </label>
        <label className="field">
          <span>{t('account.backupDialog.repeat')}</span>
          <input name="pass2" type="password" autoComplete="new-password" required />
        </label>
        <div className="form-actions">
          <button type="submit" className="btn btn-primary btn-sm">
            {t('account.backupDialog.download')}
          </button>
          <button type="button" className="btn btn-sm btn-ghost" data-act="cancel-backup" onClick={() => setPanel('none')}>
            {t('common.cancel')}
          </button>
          <span className="progress-text" id="bkProgress">
            {panel === 'backup' ? progress : ''}
          </span>
        </div>
      </form>
      <form className="form passphrase" id="restoreForm" hidden={panel !== 'restore'} onSubmit={restore}>
        <p className="small">{t('account.restoreDialog.text')}</p>
        <label className="field">
          <span>{t('account.backupDialog.passphrase')}</span>
          <input name="pass" type="password" autoComplete="off" required />
        </label>
        <div className="form-actions">
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
            {t('account.restoreDialog.restore')}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            data-act="cancel-restore"
            onClick={() => {
              setPanel('none');
              file.current = null;
              if (fileInput.current) fileInput.current.value = '';
            }}
          >
            {t('common.cancel')}
          </button>
          <span className="progress-text" id="rsProgress">
            {panel === 'restore' ? progress : ''}
          </span>
        </div>
        <p className="form-error" id="rsError" hidden={!restoreError}>
          {restoreError}
        </p>
      </form>
    </Card>
  );
}

function BlockedCard() {
  const t = useT();
  const id = useIdentity();
  const blocks = useBlocks();
  const entries = blocks?.list() || [];
  const block = async (who: string) => {
    let pk: string;
    try {
      pk = decodeKey(who);
    } catch {
      toast(t('settings.blockInvalid'), 'error');
      return false;
    }
    if (pk === id.pk) {
      toast(t('settings.blockInvalid'), 'error');
      return false;
    }
    try {
      await blocks.block(pk);
      return true;
    } catch (err) {
      fail(err);
      return false;
    }
  };
  return (
    <Card id="blocked" icon="shield" title={t('settings.blocked')}>
      <p className="muted">{t('settings.blockedText')}</p>
      <ul className="blocked-list" id="blockedList">
        {entries.length ? (
          entries.map((e: any) => (
            <li key={e.pubkey}>
              <Fp pk={e.pubkey} />
              {e.reason ? <span className="muted small">{e.reason}</span> : null}
              <button type="button" className="btn btn-sm btn-ghost" data-unblock={e.pubkey} onClick={() => blocks.unblock(e.pubkey).catch(fail)}>
                {t('settings.unblock')}
              </button>
            </li>
          ))
        ) : (
          <li className="muted small">{t('settings.blockedEmpty')}</li>
        )}
      </ul>
      <OneField id="blockForm" name="who" label={t('settings.blockAdd')} button={t('settings.block')} placeholder="npub1…" onSubmit={block} />
    </Card>
  );
}

function DeviceWipeCard() {
  const { net } = useKiwi();
  const t = useT();
  const wipe = () => {
    if (!confirm(t('settings.wipeConfirm'))) return;
    forgetIdentity();
    for (const key of Object.keys(localStorage)) if (/^(wjs\.(identity|carried|settings)|loadout\.)/.test(key)) localStorage.removeItem(key);
    net.db.clear().finally(() => location.replace('./'));
  };
  return (
    <Card id="thisDevice" icon="log-out" title={t('account.device')} className="card-danger">
      <p className="muted">{t('settings.deviceCardText')}</p>
      <button type="button" className="btn btn-danger" data-act="wipe" onClick={wipe}>
        {t('settings.wipe')}
      </button>
    </Card>
  );
}

function HowCard() {
  const t = useT();
  return (
    <details className="card how">
      <summary>
        <h2>
          <Icon name="shield" />
          <span>{t('account.how')}</span>
        </h2>
      </summary>
      <ul id="howList">
        {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
          <li key={i} dangerouslySetInnerHTML={{ __html: t(`account.how.${i}`) }} />
        ))}
      </ul>
    </details>
  );
}

export function Settings() {
  const t = useT();
  usePeopleNotices();
  // The page draws after the runtime is up, so the browser's jump to #relays or #people needs a nudge.
  useEffect(() => {
    if (location.hash.length > 1) document.getElementById(location.hash.slice(1))?.scrollIntoView();
  }, []);
  return (
    <>
      <TopBar
        brand={{ href: './', html: DISTRIBUTION.brandHtml, label: DISTRIBUTION.name }}
        right={
          <>
            <StatusPill href="#relays" />
            <a className="wjs-pill" href="./">
              <Icon name="chevron-left" />
              <span>{t('settings.back')}</span>
            </a>
          </>
        }
      />
      <main className="settings">
        <h1>{t('settings.title')}</h1>
        <AccountCard />
        <DeviceCard />
        <PowCard />
        <AppsCard />
        <PeopleCard />
        <CirclesCard />
        <RelaysCard />
        <BackupCard />
        <BlockedCard />
        <DeviceWipeCard />
        <HowCard />
      </main>
      <footer className="foot">
        <p dangerouslySetInnerHTML={{ __html: t('hub.footer') }} />
      </footer>
      <Toasts />
    </>
  );
}
