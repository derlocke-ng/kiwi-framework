// A live room: pick a nickname, enter, talk with whoever has the link.
// Nothing is stored anywhere; leaving is the end of it for you.
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../../../ui/components';
import { useIdentity, useKiwi, useT, useTick } from '../../../ui/hooks';
import { copyText, toastError } from '../../../ui/toast';
import { NICK, Room } from '../data/rooms.js';
import { savedNick, saveNick } from '../state';
import { Composer } from './Conversation';

export function RoomView({ secret }: { secret: string }) {
  const t = useT();
  const kiwi = useKiwi();
  const identity = useIdentity();
  const room = useMemo(() => new Room(secret, kiwi.net, { nick: savedNick() || identity.alias || '' }), [secret, kiwi.net, identity.alias]);
  useTick(useCallback((fn: () => void) => room.onChange(fn), [room]));
  const [joined, setJoined] = useState(false);
  const end = useRef<HTMLDivElement | null>(null);
  useEffect(() => () => room.leave(), [room]);
  const last = room.messages[room.messages.length - 1];
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when the newest message changes
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [last?.id]);

  const link = `${location.origin}${location.pathname}#/room/${encodeURIComponent(secret)}`;
  const enter = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const nick = String(new FormData(e.currentTarget).get('nick') || '')
      .trim()
      .slice(0, NICK);
    if (!nick) return;
    saveNick(nick);
    try {
      await room.setNick(nick);
      await room.join();
      setJoined(true);
    } catch (err) {
      toastError(err);
    }
  };
  const leave = () => {
    room.leave();
    location.hash = '#/';
  };

  if (!joined) {
    return (
      <section className="room-enter">
        <div className="page-head">
          <a className="icon-btn back" href="#/" aria-label={t('chat.back')}>
            <Icon name="chevron-left" />
          </a>
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
            <button type="submit" className="btn btn-primary" id="enterBtn">
              {t('chat.room.enter')}
            </button>
          </div>
        </form>
      </section>
    );
  }
  return (
    <section className="room" data-room={room.id.slice(0, 12)}>
      <div className="page-head">
        <button type="button" className="icon-btn back" id="leaveRoom" aria-label={t('chat.room.leave')} title={t('chat.room.leave')} onClick={leave}>
          <Icon name="log-out" />
        </button>
        <div className="who">
          <h1>{t('chat.room.title')}</h1>
          <small className="muted">
            {t('chat.room.here')}:{' '}
            <span id="members">
              {room
                .present()
                .map((m: any) => m.nick || t('chat.room.anon'))
                .join(', ')}
            </span>
          </small>
        </div>
        <button type="button" className="btn btn-sm" id="copyRoom" onClick={() => copyText(link, t('chat.room.copied'))}>
          <Icon name="link" />
          <span>{t('chat.room.copy')}</span>
        </button>
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
