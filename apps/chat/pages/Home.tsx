// The start, in two tabs: Messages (your conversations, a new one to a
// friend) and Groups (the groups you are in, the doors you are waiting at,
// a new group, a live room, joining by link). Pinned conversations come
// first in both; the search is a tap away.

import { type FormEvent, useEffect, useState } from 'react';
import { DirectMessages } from '../../../shared/chat.js';
import { fingerprint } from '../../../shared/events.js';
import { relTime } from '../../../shared/i18n.js';
import { hintQuery } from '../../../shared/relaylists.js';
import { Icon } from '../../../ui/components';
import { useGroups, useIdentity, useKiwi, usePeople, useT } from '../../../ui/hooks';
import { toast, toastError } from '../../../ui/toast';
import { Modal } from '../../../ui/widgets/Modal';
import { randomSecret } from '../data/rooms.js';
import { parseJoinInput, useDm, useDmVersion } from '../state';
import { preview } from './Thread';

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

/** Pinned first (the last pinned on top), then the rest as they were (newest first). */
const pinnedFirst = <X,>(list: X[], key: (x: X) => string, pinned: string[]) => {
  const at = (x: X) => pinned.indexOf(key(x));
  return [...list.filter((x) => at(x) >= 0).sort((a, b) => at(a) - at(b)), ...list.filter((x) => at(x) < 0)];
};

function Messages({ convs }: { convs: any[] }) {
  const t = useT();
  const dm = useDm();
  const people = usePeople();
  const groups = useGroups();
  const identity = useIdentity();
  const [picking, setPicking] = useState(false);
  // the friend's name, else the name the other side signs their messages with, else the key's fingerprint
  const name = (c: any) => people?.friends?.().find((f: any) => f.pk === c.conv)?.name || (c.from !== identity.pk && c.name) || fingerprint(c.conv);
  const unread = (c: any) => c.from !== identity.pk && DirectMessages.timeOf(c) > dm.lastRead(c.conv);
  const pinned: string[] = groups?.pinned() || [];
  const sorted = pinnedFirst(convs, (c) => c.conv, pinned);
  return (
    <>
      <div className="list-head">
        <h1>{t('chat.title')}</h1>
        <button type="button" className="btn btn-primary fab" id="newMessage" onClick={() => setPicking(true)}>
          <Icon name="message-circle" />
          <span>{t('chat.new')}</span>
        </button>
      </div>
      {sorted.length ? (
        <ul className="convs" id="convs">
          {sorted.map((c) => (
            <li key={c.conv} className={`${unread(c) ? 'unread' : ''}${pinned.includes(c.conv) ? ' pinned' : ''}`} data-conv={c.conv.slice(0, 12)}>
              <a href={`#/dm/${c.conv}`} className="conv">
                <span className="avatar" aria-hidden="true">
                  {name(c)[0].toUpperCase()}
                </span>
                <span className="conv-main">
                  <span className="conv-name">{name(c)}</span>
                  <span className="conv-preview">
                    {c.from === identity.pk && !c.system ? `${t('chat.you')}: ` : ''}
                    {preview(t, c, identity.pk, () => name(c))}
                  </span>
                </span>
                <span className="conv-meta">
                  <time>{relTime(c.at * 1000)}</time>
                  {pinned.includes(c.conv) ? <Icon name="pin" /> : null}
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
  const invites: any[] = groups.invites();
  const people = usePeople();
  const whoInvited = (pk: string) => people?.nameOf?.(pk) || fingerprint(pk);
  const accept = async (id: string) => {
    try {
      const r = await groups.acceptInvite(id);
      if (r?.type === 'group') {
        const g = groups.entry(r.pub);
        go(`#/group/${r.pub}/${g.host}/${g.invite || '-'}/${encodeURIComponent(g.name || '')}`);
      } else if (r?.type === 'room') go(`#/room/${encodeURIComponent(r.secret)}${r.relays?.length ? `?${hintQuery(r.relays)}` : ''}`);
    } catch (err) {
      toastError(err);
    }
  };
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
  const pinned: string[] = groups.pinned();
  const sorted = pinnedFirst(
    [...list].sort((a, b) => (lastOf(b.pub)?.at || b.joined || 0) - (lastOf(a.pub)?.at || a.joined || 0)),
    (g) => g.pub,
    pinned,
  );
  return (
    <>
      <div className="list-head">
        <h1>{t('chat.groups.title')}</h1>
        <button type="button" className="btn btn-primary fab" id="newGroup" onClick={() => setMaking(true)}>
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
      {invites.length ? (
        <ul className="convs invites" id="invites" aria-label={t('chat.invites.title')}>
          {invites.map((i) => (
            <li key={i.id} className="invite" data-invite={i.type}>
              <div className="conv">
                <span className="avatar" aria-hidden="true">
                  <Icon name={i.type === 'room' ? 'radio' : 'users'} />
                </span>
                <span className="conv-main">
                  <span className="conv-name">{i.name || t(i.type === 'room' ? 'chat.room.title' : 'chat.group.title')}</span>
                  <span className="conv-preview">{t(i.type === 'room' ? 'chat.invites.room' : 'chat.invites.group', { name: whoInvited(i.from) })}</span>
                </span>
                <span className="invite-actions">
                  <button type="button" className="btn btn-sm btn-primary" data-accept={i.id} onClick={() => accept(i.id)}>
                    {t('chat.invites.accept')}
                  </button>
                  <button type="button" className="btn btn-sm" data-decline={i.id} onClick={() => groups.declineInvite(i.id).catch(toastError)}>
                    {t('chat.invites.decline')}
                  </button>
                </span>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
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
            const asking = g.host === identity.pk ? groups.requests(g.pub) : [];
            return (
              <li key={g.pub} className={`${unread(g.pub) ? 'unread' : ''}${pinned.includes(g.pub) ? ' pinned' : ''}`} data-group={g.pub.slice(0, 12)}>
                <a href={`#/group/${g.pub}/${g.host}/${g.invite || '-'}/${encodeURIComponent(groups.info(g.pub)?.name || g.name)}`} className="conv">
                  <span className="avatar" aria-hidden="true">
                    <Icon name="users" />
                  </span>
                  <span className="conv-main">
                    <span className="conv-name">{groups.info(g.pub)?.name || g.name || t('chat.group.title')}</span>
                    <span className="conv-preview">
                      {asking.length
                        ? asking.length === 1
                          ? t('chat.group.asking', { name: asking[0].name || fingerprint(asking[0].pk) })
                          : t('chat.group.askingMany', { n: asking.length })
                        : c
                          ? c.system
                            ? preview(t, c, identity.pk, (pk) => c.name || fingerprint(pk))
                            : `${c.from === identity.pk ? t('chat.you') : c.name || fingerprint(c.from)}: ${preview(t, c)}`
                          : t('chat.group.members', { n: groups.members(g.pub).length })}
                    </span>
                  </span>
                  <span className="conv-meta">
                    {c ? <time>{relTime(c.at * 1000)}</time> : null}
                    {pinned.includes(g.pub) ? <Icon name="pin" /> : null}
                    {asking.length ? (
                      <span className="badge" data-requests={asking.length}>
                        <Icon name="user-plus" />
                        {asking.length}
                      </span>
                    ) : unread(g.pub) ? (
                      <span className="dot" />
                    ) : null}
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="empty">{t('chat.groups.empty')}</p>
      )}
      <p className="muted small">{t('chat.groups.hint')}</p>
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
      <div className="app-bar">
        <a href="#/search" className="icon-btn search-btn" id="searchBtn" aria-label={t('chat.search.title')} title={t('chat.search.title')}>
          <Icon name="search" />
        </a>
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
      </div>
      {tab === 'groups' ? <GroupsTab convs={convs.filter((c) => c.group)} /> : <Messages convs={convs.filter((c) => !c.group)} />}
    </section>
  );
}
