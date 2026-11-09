// A live room: pick a nickname, enter, talk with whoever has the link.
// Nothing is stored anywhere; leaving is the end of it for you.
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { hintQuery } from '../../../shared/relaylists.js';
import { BackLink } from '../../../ui/BackLink';
import { Icon } from '../../../ui/components';
import { pickPeople } from '../../../ui/dialogs';
import { useGroups, useIdentity, useKiwi, usePeople, useT, useTick } from '../../../ui/hooks';
import { copyText, toast, toastError } from '../../../ui/toast';
import { NICK, Room, remembered } from '../data/rooms.js';
import { savedNick, saveNick } from '../state';
import { Composer } from './Conversation';

const SHOWN = 6; // names in the header; the rest is a count, the full list on a tap

export function RoomView({ secret, relays = [] }: { secret: string; relays?: string[] }) {
  const t = useT();
  const kiwi = useKiwi();
  const identity = useIdentity();
  const people = usePeople();
  const groups = useGroups();
  // one room object per visit: a name learned later changes the suggestion, never the room
  // biome-ignore lint/correctness/useExhaustiveDependencies: the alias is only the first suggestion for the name
  const room = useMemo(() => {
    const before = remembered(secret); // this tab was in the room before a reload: the same name, the same voice
    // a link's hints are where the room is: followed as guests, unless this is a locked hub's own network
    const follow = kiwi.hints(relays).filter((r) => !kiwi.whole.pool.urlsOf(kiwi.network).includes(r));
    return new Room(secret, kiwi.net, { nick: before?.nick || savedNick() || identity.alias || '', sk: before?.sk, relays: follow });
  }, [secret, kiwi.net]);
  useTick(useCallback((fn: () => void) => room.onChange(fn), [room]));
  const [joined, setJoined] = useState(() => Boolean(remembered(secret))); // straight back in after a reload
  const [busy, setBusy] = useState(false);
  const [everyone, setEveryone] = useState(false);
  const end = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (joined) room.join();
    return () => room.leave();
  }, [room, joined]);
  const last = room.messages[room.messages.length - 1];
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when the newest message changes
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [last?.id]);

  const hints = kiwi.hints(relays);
  const link = `${location.origin}${location.pathname}#/room/${encodeURIComponent(secret)}${hints.length ? `?${hintQuery(hints)}` : ''}`;
  const enter = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const nick = String(new FormData(e.currentTarget).get('nick') || '')
      .trim()
      .slice(0, NICK);
    if (!nick || busy) return;
    saveNick(nick);
    setBusy(true);
    try {
      await room.setNick(nick);
      setJoined(true); // the effect joins; no relay is waited for
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };
  const leave = () => {
    room.leave();
    location.hash = '#/';
  };
  const names = room.present().map((m: any) => m.nick || t('chat.room.anon'));
  const hidden = everyone ? 0 : Math.max(0, names.length - SHOWN);

  if (!joined) {
    return (
      <section className="room-enter page-enter">
        <div className="page-head">
          <BackLink href="#/" label={t('chat.back')} />
          <h1>{t('chat.room.title')}</h1>
        </div>
        <form className="card form" id="enterRoom" onSubmit={enter}>
          <label className="field">
            {t('chat.room.nick')}
            <input name="nick" maxLength={NICK} required defaultValue={room.nick} autoComplete="nickname" data-autofocus />
          </label>
          <p className="hint">
            <Icon name="lock" /> {t('chat.room.hint')}
          </p>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" id="enterBtn" disabled={busy}>
              {t('chat.room.enter')}
            </button>
          </div>
        </form>
      </section>
    );
  }
  return (
    <section className="room" data-room={room.id.slice(0, 12)} data-invite={link}>
      <div className="page-head">
        <button type="button" className="icon-btn back" id="leaveRoom" aria-label={t('chat.room.leave')} title={t('chat.room.leave')} onClick={leave}>
          <Icon name="log-out" />
        </button>
        <div className="who">
          <h1>{t('chat.room.title')}</h1>
          <small className="muted">
            {t('chat.room.here')} ({names.length}):{' '}
            <span id="members" title={names.join(', ')}>
              {(hidden ? names.slice(0, SHOWN) : names).join(', ')}
              {hidden ? (
                <>
                  {', '}
                  <button type="button" className="link-btn" id="moreMembers" onClick={() => setEveryone(true)}>
                    +{hidden}
                  </button>
                </>
              ) : null}
            </span>
          </small>
        </div>
        <button type="button" className="btn btn-sm" id="copyRoom" title={t('chat.room.copy')} onClick={() => copyText(link, t('chat.room.copied'))}>
          <Icon name="link" />
          <span>{t('chat.room.copy')}</span>
        </button>
        {people ? (
          <button
            type="button"
            className="btn btn-sm"
            id="inviteRoom"
            title={t('chat.room.invite')}
            onClick={async () => {
              // friends get the room sealed to them, inside the chat; nothing to copy or forward
              const pks: string[] = await pickPeople(people, { base: kiwi.base });
              if (!pks.length) return;
              groups
                .inviteRoom(pks, { secret, name: room.nick ? t('chat.room.ofNick', { nick: room.nick }) : '', relays: hints })
                .then(() => toast(t('chat.group.invited', { n: pks.length }), 'success'), toastError);
            }}
          >
            <Icon name="user-plus" />
            <span>{t('chat.room.invite')}</span>
          </button>
        ) : null}
      </div>
      <div className="messages" id="roomMessages">
        {room.messages.length ? null : <p className="empty">{t('chat.room.empty')}</p>}
        {room.messages.map((m: any) => (
          <div key={m.id} className={`msg ${m.me ? 'mine' : 'theirs'}`}>
            {m.me ? null : <b className="nick">{m.nick || t('chat.room.anon')}</b>}
            <p>{m.text}</p>
          </div>
        ))}
        <div ref={end} />
      </div>
      <Composer id="roomComposer" onSend={(text) => room.say(text)} placeholder={t('chat.write')} />
    </section>
  );
}
