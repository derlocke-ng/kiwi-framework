// Received: the files people sent in Uplink, from conversations and groups,
// newest first, to download again (fetched from the sender's media server,
// checked and decrypted here), with the way to the conversation they came in.
import { useEffect, useState } from 'react';
import { openFile } from '../../../shared/files.js';
import { relTime, tErr } from '../../../shared/i18n.js';
import { Icon } from '../../../ui/components';
import { useGroups, useIdentity, useKiwi, useMessages, usePeople, useT } from '../../../ui/hooks';
import { chatMount } from '../../../ui/notify';
import { toast } from '../../../ui/toast';
import { Tabs } from '../App';
import { saveBytes, size } from '../state';

export function Received() {
  const t = useT();
  const kiwi = useKiwi();
  const me = useIdentity();
  const messages = useMessages();
  const groups = useGroups();
  const people = usePeople();
  const chat = chatMount();
  const [list, setList] = useState<any[] | null>(null);
  const [busy, setBusy] = useState<string>('');
  // read again whenever the inbox changes (a new message, a file among them)
  useEffect(() => {
    if (!messages) return;
    let live = true;
    const read = () =>
      messages
        .files()
        .then((all: any[]) => live && setList(all.filter((m) => m.from !== me.pk)))
        .catch(() => live && setList([]));
    read();
    const off = messages.onChange(read);
    return () => {
      live = false;
      off();
    };
  }, [messages, me.pk]);
  const where = (m: any) => {
    if (!chat) return null;
    if (!m.group) return `${kiwi.base}${chat.id}/#/dm/${m.conv}`;
    const g = groups?.entry(m.conv);
    return g ? `${kiwi.base}${chat.id}/#/group/${g.pub}/${g.host}/${g.invite || '-'}/${encodeURIComponent(g.name || '')}` : null;
  };
  const who = (m: any) => (people?.isFriend(m.from) ? people.nameOf(m.from) : m.name || t('pl.someone'));
  const download = async (m: any) => {
    setBusy(m.id);
    try {
      saveBytes(await openFile(m.file, { servers: kiwi.mediaServers() }), m.file.name, m.file.type);
    } catch (err) {
      toast(tErr(err), 'error', 6000);
    } finally {
      setBusy('');
    }
  };
  return (
    <div className="pl-page">
      <div className="app-bar">
        <Tabs page="received" />
      </div>
      {list === null ? (
        <p className="empty">{t('common.loading')}</p>
      ) : list.length ? (
        <ul className="pl-list" id="received">
          {list.map((m) => {
            const href = where(m);
            const group = m.group ? groups?.entry(m.conv)?.name || t('pl.aGroup') : '';
            return (
              <li key={m.id} className="pl-item" data-file={m.file.name}>
                <Icon name={/^image\//.test(m.file.type) ? 'image' : 'file'} />
                <span className="pl-what">
                  <b>{m.file.name}</b>
                  <span className="muted small">
                    {[
                      m.file.size != null ? size(m.file.size) : '',
                      group ? t('pl.fromIn', { name: who(m), group }) : t('pl.fromShort', { name: who(m) }),
                      relTime(m.at * 1000),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                <span className="pl-buttons">
                  <button
                    type="button"
                    className="btn btn-primary"
                    data-act="download"
                    disabled={busy === m.id}
                    onClick={() => void download(m)}
                    aria-label={t('pl.downloadName', { name: m.file.name })}
                  >
                    <Icon name="download" />
                    <span className="phone-hide">{t('pl.download')}</span>
                  </button>
                  {href ? (
                    <a className="icon-btn" href={href} aria-label={t('pl.inApp', { app: chat?.name || '' })} title={t('pl.inApp', { app: chat?.name || '' })}>
                      <Icon name="message-circle" />
                    </a>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="empty" id="receivedEmpty">
          {t('pl.receivedEmpty', { app: chat?.name || 'Uplink' })}
        </p>
      )}
      <a className="btn btn-primary fab" href="#/" id="newSend">
        <Icon name="plus" />
        <span>{t('pl.sendFiles')}</span>
      </a>
    </div>
  );
}
