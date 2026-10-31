// The start, in two tabs: Messages (your conversations, a new one to a
// friend) and Groups (the groups you are in, the doors you are waiting at,
// a new group, a live room, joining by link).
import { type FormEvent, useEffect, useState } from 'react';
import { DirectMessages } from '../../../shared/chat.js';
import { fingerprint } from '../../../shared/events.js';
import { relTime } from '../../../shared/i18n.js';
import { Icon } from '../../../ui/components';
import { useGroups, useIdentity, useKiwi, usePeople, useT } from '../../../ui/hooks';
import { toast, toastError } from '../../../ui/toast';
import { Modal } from '../../../ui/widgets/Modal';
import { randomSecret } from '../data/rooms.js';
import { parseJoinInput, useDm, useDmVersion } from '../state';

const go = (hash: string) => {
  location.hash = hash;
};

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

function NewGroup({ onClose }: { onClose: () => void }) {
  const t = useT();
  const groups = useGroups();
  const identity = useIdentity();
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const name = String(f.get('name') || '')
      .trim()
      .slice(0, 60);
    const myName = String(f.get('myName') || '')
      .trim()
      .slice(0, 60);
    if (!name) return;
    setBusy(true);
    try {
      const pub = await groups.create(name, { myName, open: f.get('open') === 'on' });
      const g = groups.entry(pub);
      onClose();
      go(`#/group/${pub}/${g.host}/${g.invite}/${encodeURIComponent(name)}`);
    } catch (err) {
      setBusy(false);
      toastError(err);
    }
  };
  return (
    <Modal open title={t('chat.group.new')} onClose={onClose}>
      <form className="form" id="groupForm" onSubmit={submit}>
        <label className="field">
          {t('chat.group.name')}
          <input name="name" maxLength={60} required placeholder={t('chat.group.namePlaceholder')} data-autofocus />
        </label>
        <label className="field">
          {t('chat.group.yourName')}
          <input name="myName" maxLength={60} defaultValue={identity.alias || ''} autoComplete="nickname" />
        </label>
        <label className="check-row">
          <input type="checkbox" name="open" />
          <span>{t('chat.group.openOn')}</span>
        </label>
        <p className="hint">
          <Icon name="lock" /> {t('chat.group.newHint')}
        </p>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {t('common.create')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Messages({ convs }: { convs: any[] }) {
  const t = useT();
  const dm = useDm();
  const people = usePeople();
  const identity = useIdentity();
  const [picking, setPicking] = useState(false);
  const name = (pk: string) => people?.nameOf?.(pk) || fingerprint(pk);
  const unread = (c: any) => c.from !== identity.pk && DirectMessages.timeOf(c) > dm.lastRead(c.conv);
  return (
    <>
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
    </>
  );
}

function GroupsTab({ convs }: { convs: any[] }) {
  const t = useT();
  const dm = useDm();
  const groups = useGroups();
  const identity = useIdentity();
  const [making, setMaking] = useState(false);
  const list: any[] = groups.list();
  const knocks: any[] = groups.knocks();
  const lastOf = (pub: string) => convs.find((c) => c.conv === pub);
  const unread = (pub: string) => {
    const c = lastOf(pub);
    return Boolean(c && c.from !== identity.pk && DirectMessages.timeOf(c) > dm.lastRead(pub));
  };
  const join = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const hash = parseJoinInput(String(new FormData(e.currentTarget).get('room') || ''));
    if (!hash) return toast(t('chat.rooms.invalid'), 'error');
    go(hash);
  };
  const sorted = [...list].sort((a, b) => (lastOf(b.pub)?.at || b.joined || 0) - (lastOf(a.pub)?.at || a.joined || 0));
  return (
    <>
      <div className="list-head">
        <h1>{t('chat.groups.title')}</h1>
        <button type="button" className="btn btn-primary" id="newGroup" onClick={() => setMaking(true)}>
          <Icon name="users" />
          <span>{t('chat.group.new')}</span>
        </button>
      </div>
      <div className="rooms-actions">
        <button type="button" className="btn" id="startRoom" onClick={() => go(`#/room/${randomSecret(16)}`)}>
          <Icon name="radio" />
          <span>{t('chat.rooms.start')}</span>
        </button>
        <form className="join" id="joinRoom" onSubmit={join}>
          <input name="room" placeholder={t('chat.groups.joinPlaceholder')} autoComplete="off" spellCheck={false} required />
          <button type="submit" className="btn">
            {t('chat.rooms.join')}
          </button>
        </form>
      </div>
      {sorted.length || knocks.length ? (
        <ul className="convs" id="groupList">
          {knocks.map((k) => (
            <li key={`knock-${k.pub}`} className="knocking">
              <a href={`#/group/${k.pub}/${k.host}/${k.invite}/${encodeURIComponent(k.name)}`} className="conv">
                <span className="avatar" aria-hidden="true">
                  <Icon name="users" />
                </span>
                <span className="conv-main">
                  <span className="conv-name">{k.name || t('chat.group.title')}</span>
                  <span className="conv-preview">{t('chat.group.waitingShort')}</span>
                </span>
              </a>
            </li>
          ))}
          {sorted.map((g) => {
            const c = lastOf(g.pub);
            return (
              <li key={g.pub} className={unread(g.pub) ? 'unread' : ''} data-group={g.pub.slice(0, 12)}>
                <a href={`#/group/${g.pub}/${g.host}/${g.invite || '-'}/${encodeURIComponent(groups.info(g.pub)?.name || g.name)}`} className="conv">
                  <span className="avatar" aria-hidden="true">
                    <Icon name="users" />
                  </span>
                  <span className="conv-main">
                    <span className="conv-name">{groups.info(g.pub)?.name || g.name || t('chat.group.title')}</span>
                    <span className="conv-preview">
                      {c
                        ? `${c.from === identity.pk ? t('chat.you') : c.name || fingerprint(c.from)}: ${c.text}`
                        : t('chat.group.members', { n: groups.members(g.pub).length })}
                    </span>
                  </span>
                  <span className="conv-meta">
                    {c ? <time>{relTime(c.at * 1000)}</time> : null}
                    {unread(g.pub) ? <span className="dot" /> : null}
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="empty">{t('chat.groups.empty')}</p>
      )}
      <p className="muted small">{t('chat.rooms.text')}</p>
      {making ? <NewGroup onClose={() => setMaking(false)} /> : null}
    </>
  );
}

export function Home({ tab }: { tab: 'messages' | 'groups' }) {
  const t = useT();
  const dm = useDm();
  const version = useDmVersion(dm);
  const [convs, setConvs] = useState<any[]>([]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` is the inbox saying something changed
  useEffect(() => {
    let live = true;
    dm.conversations().then((c: any[]) => live && setConvs(c));
    return () => {
      live = false;
    };
  }, [dm, version]);
  return (
    <section className="home">
      <div className="seg tabs" role="tablist" id="chatTabs">
        <label>
          <input type="radio" name="chatTab" value="messages" checked={tab === 'messages'} onChange={() => go('#/')} />
          <span>{t('chat.title')}</span>
        </label>
        <label>
          <input type="radio" name="chatTab" value="groups" checked={tab === 'groups'} onChange={() => go('#/groups')} />
          <span>{t('chat.groups.title')}</span>
        </label>
      </div>
      {tab === 'groups' ? <GroupsTab convs={convs.filter((c) => c.group)} /> : <Messages convs={convs.filter((c) => !c.group)} />}
    </section>
  );
}
