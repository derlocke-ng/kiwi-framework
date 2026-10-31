// The start: live rooms (start one, join one) and your conversations.
import { type FormEvent, useEffect, useState } from 'react';
import { DirectMessages } from '../../../shared/chat.js';
import { fingerprint } from '../../../shared/events.js';
import { relTime } from '../../../shared/i18n.js';
import { Icon } from '../../../ui/components';
import { useIdentity, useKiwi, usePeople, useT } from '../../../ui/hooks';
import { toast } from '../../../ui/toast';
import { Modal } from '../../../ui/widgets/Modal';
import { randomSecret } from '../data/rooms.js';
import { parseRoomInput, useDm, useDmVersion } from '../state';

const go = (hash: string) => {
  location.hash = hash;
};

function Rooms() {
  const t = useT();
  const join = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const secret = parseRoomInput(String(new FormData(e.currentTarget).get('room') || ''));
    if (!secret) return toast(t('chat.rooms.invalid'), 'error');
    go(`#/room/${encodeURIComponent(secret)}`);
  };
  return (
    <section className="card rooms" id="rooms">
      <h2>
        <Icon name="radio" />
        {t('chat.rooms.title')}
      </h2>
      <p className="muted">{t('chat.rooms.text')}</p>
      <div className="rooms-actions">
        <button type="button" className="btn btn-primary" id="startRoom" onClick={() => go(`#/room/${randomSecret(16)}`)}>
          <Icon name="plus" />
          <span>{t('chat.rooms.start')}</span>
        </button>
        <form className="join" id="joinRoom" onSubmit={join}>
          <input name="room" placeholder={t('chat.rooms.placeholder')} autoComplete="off" spellCheck={false} required />
          <button type="submit" className="btn">
            {t('chat.rooms.join')}
          </button>
        </form>
      </div>
    </section>
  );
}

function PickFriend({ onClose }: { onClose: () => void }) {
  const t = useT();
  const kiwi = useKiwi();
  const people = usePeople();
  const friends: any[] = people?.friends() || [];
  return (
    <Modal open title={t('chat.pickFriend')} onClose={onClose}>
      {friends.length ? (
        <ul className="pick-list" id="friendPick">
          {friends.map((f) => (
            <li key={f.pk}>
              <button type="button" className="row-btn" onClick={() => go(`#/dm/${f.pk}`)}>
                <span className="avatar" aria-hidden="true">
                  {(f.name || '?')[0].toUpperCase()}
                </span>
                <span>
                  <b>{f.name || fingerprint(f.pk)}</b>
                  <small className="muted">{fingerprint(f.pk)}</small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="modal-text" dangerouslySetInnerHTML={{ __html: t('chat.noFriends', { base: kiwi.base }) }} />
      )}
    </Modal>
  );
}

export function Home() {
  const t = useT();
  const dm = useDm();
  const version = useDmVersion(dm);
  const people = usePeople();
  const identity = useIdentity();
  const [convs, setConvs] = useState<any[]>([]);
  const [picking, setPicking] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` is the inbox saying something changed
  useEffect(() => {
    let live = true;
    dm.conversations().then((c: any[]) => live && setConvs(c));
    return () => {
      live = false;
    };
  }, [dm, version]);
  const name = (pk: string) => people?.nameOf?.(pk) || fingerprint(pk);
  const unread = (c: any) => c.from !== identity.pk && DirectMessages.timeOf(c) > dm.lastRead(c.conv);
  return (
    <section className="home">
      <Rooms />
      <div className="list-head">
        <h1>{t('chat.title')}</h1>
        <button type="button" className="btn btn-primary" id="newMessage" onClick={() => setPicking(true)}>
          <Icon name="message-circle" />
          <span>{t('chat.new')}</span>
        </button>
      </div>
      {convs.length ? (
        <ul className="convs" id="convs">
          {convs.map((c) => (
            <li key={c.conv} className={unread(c) ? 'unread' : ''}>
              <a href={`#/dm/${c.conv}`} className="conv">
                <span className="avatar" aria-hidden="true">
                  {name(c.conv)[0].toUpperCase()}
                </span>
                <span className="conv-main">
                  <span className="conv-name">{name(c.conv)}</span>
                  <span className="conv-preview">
                    {c.from === identity.pk ? `${t('chat.you')}: ` : ''}
                    {c.text}
                  </span>
                </span>
                <span className="conv-meta">
                  <time>{relTime(c.at * 1000)}</time>
                  {unread(c) ? <span className="dot" /> : null}
                </span>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty">{t('chat.empty')}</p>
      )}
      {picking ? <PickFriend onClose={() => setPicking(false)} /> : null}
    </section>
  );
}
