// Sending to people: the friends and groups to send to, then the files go up
// once (encrypted on the person's media servers) and a sealed file message goes
// to each: a friend gets it in their conversation with the sender, a group in
// the group, in Uplink, as Uplink's own files (NIP-17 file messages).
import { type FormEvent, useState } from 'react';
import { uploadFile } from '../../../shared/files.js';
import { tErr } from '../../../shared/i18n.js';
import { Icon } from '../../../ui/components';
import { useGroups, useIdentity, useKiwi, useMessages, usePeople, useT } from '../../../ui/hooks';
import { chatMount } from '../../../ui/notify';
import { toast } from '../../../ui/toast';
import { Modal } from '../../../ui/widgets/Modal';
import { size } from '../state';
import { Bar } from './Direct';

export function SendTo({ files, onDone, onCancel }: { files: File[]; onDone: () => void; onCancel: () => void }) {
  const t = useT();
  const kiwi = useKiwi();
  const id = useIdentity();
  const people = usePeople();
  const messages = useMessages();
  const groups = useGroups();
  const chat = chatMount();
  const friends: { pk: string; name: string }[] = people?.friends() || [];
  const myGroups: { pub: string; name: string }[] = groups?.list() || [];
  const [to, setTo] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const flip = (key: string) => {
    const next = new Set(to);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setTo(next);
  };
  const total = files.reduce((s, f) => s + f.size, 0) || 1;
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!to.size || !messages) return;
    setBusy(true);
    try {
      // each file up once, encrypted; then one sealed message per file to each friend and group
      const uploaded = [];
      let done = 0;
      for (const file of files) {
        uploaded.push(await uploadFile(file, { servers: kiwi.mediaServers(), sk: id.sk, onProgress: (p) => setProgress((done + p * file.size) / total) }));
        done += file.size;
      }
      let people = 0;
      let rooms = 0;
      for (const key of to) {
        const [type, who] = key.split(':');
        for (const f of uploaded) {
          if (type === 'p') await messages.sendFile(who, f);
          else await groups.sayFile(who, f);
        }
        if (type === 'p') people++;
        else rooms++;
      }
      const sentTo = [people ? t('pl.nPeople', { n: people }) : '', rooms ? t('pl.nGroups', { n: rooms }) : ''].filter(Boolean).join(' + ');
      toast(t('pl.sent', { to: sentTo }), 'success', 6000, chat ? { label: t('pl.openApp', { app: chat.name }), href: `${kiwi.base}${chat.id}/` } : null);
      onDone();
    } catch (err) {
      setBusy(false);
      toast(tErr(err), 'error', 6000);
    }
  };
  return (
    <Modal open id="sendTo" title={t('pl.sendToTitle', { n: files.length, size: size(total) })} onClose={() => !busy && onCancel()}>
      <form className="form" id="sendToForm" onSubmit={submit}>
        {!friends.length && !myGroups.length ? (
          <p className="muted" id="noPeople">
            {t('pl.noPeople')} <a href={`${kiwi.base}settings.html#people`}>{t('pl.addFriends')}</a>
          </p>
        ) : null}
        {friends.length ? (
          <fieldset className="pl-pick">
            <legend>{t('pl.friends')}</legend>
            {friends.map((f) => (
              <label key={f.pk} className="check-row">
                <input type="checkbox" data-pk={f.pk} checked={to.has(`p:${f.pk}`)} disabled={busy} onChange={() => flip(`p:${f.pk}`)} />
                <Icon name="user" />
                <span>{f.name}</span>
              </label>
            ))}
          </fieldset>
        ) : null}
        {myGroups.length ? (
          <fieldset className="pl-pick">
            <legend>{t('pl.groups')}</legend>
            {myGroups.map((g) => (
              <label key={g.pub} className="check-row">
                <input type="checkbox" data-group={g.pub} checked={to.has(`g:${g.pub}`)} disabled={busy} onChange={() => flip(`g:${g.pub}`)} />
                <Icon name="users-round" />
                <span>{g.name || t('pl.unnamedGroup')}</span>
              </label>
            ))}
          </fieldset>
        ) : null}
        {busy ? <Bar value={Math.round(progress * 100)} id="sendBar" /> : null}
        <p className="hint">{t('pl.sendToHint', { app: chat?.name || 'Uplink' })}</p>
        <div className="modal-actions">
          <button type="button" className="btn" data-close disabled={busy} onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn-primary" id="sendToBtn" disabled={busy || !to.size}>
            <Icon name="send" />
            <span>{t('pl.send')}</span>
          </button>
        </div>
      </form>
    </Modal>
  );
}
