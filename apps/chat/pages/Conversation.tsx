// One conversation: the messages with one person, oldest at the top, and
// the composer. Enter sends, Shift+Enter breaks a line.
import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { npub } from '../../../shared/account.js';
import { fingerprint } from '../../../shared/events.js';
import { relTime } from '../../../shared/i18n.js';
import { Icon } from '../../../ui/components';
import { confirmDialog, openMenu } from '../../../ui/dialogs';
import { useBlocks, useIdentity, usePeople, useT } from '../../../ui/hooks';
import { copyText, toast, toastError } from '../../../ui/toast';
import { TEXT } from '../data/dm.js';
import { useDm, useDmVersion } from '../state';

const PAGE = 50;

export function Composer({ onSend, placeholder, id = 'composer' }: { onSend: (text: string) => Promise<unknown>; placeholder: string; id?: string }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const submit = async (e?: FormEvent<HTMLFormElement>) => {
    e?.preventDefault();
    const ta = ref.current;
    const text = ta?.value.trim() || '';
    if (!text || busy) return;
    setBusy(true);
    try {
      await onSend(text);
      if (ta) ta.value = '';
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
      ta?.focus();
    }
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  };
  return (
    <form className="composer" id={id} onSubmit={submit}>
      <textarea ref={ref} name="text" rows={1} maxLength={TEXT} placeholder={placeholder} aria-label={placeholder} onKeyDown={onKey} />
      <button type="submit" className="btn btn-primary" disabled={busy} aria-label={t('chat.send')} title={t('chat.send')}>
        <Icon name="send" />
      </button>
    </form>
  );
}

export function Conversation({ pk }: { pk: string }) {
  const t = useT();
  const dm = useDm();
  const version = useDmVersion(dm);
  const people = usePeople();
  const blocks = useBlocks();
  const identity = useIdentity();
  const [msgs, setMsgs] = useState<any[]>([]);
  const [limit, setLimit] = useState(PAGE);
  const [hasMore, setHasMore] = useState(false);
  const menuBtn = useRef<HTMLButtonElement | null>(null);
  const end = useRef<HTMLDivElement | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` is the inbox saying something changed
  useEffect(() => {
    let live = true;
    dm.messages(pk, { limit: limit + 1 }).then((m: any[]) => {
      if (!live) return;
      setHasMore(m.length > limit);
      setMsgs(m.slice(-limit));
    });
    return () => {
      live = false;
    };
  }, [dm, pk, limit, version]);
  const last = msgs[msgs.length - 1];
  useEffect(() => {
    if (last) dm.markRead(pk, last.at);
  }, [dm, pk, last]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when the newest message changes
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [last?.id]);

  const name = people?.nameOf?.(pk) || fingerprint(pk);
  const friend = Boolean(people?.isFriend(pk));
  const asked = Boolean(people?.outgoing().some((r: any) => r.pk === pk));
  const blocked = Boolean(blocks?.isBlocked(pk));
  const addFriend = () =>
    people
      .request(pk)
      .then(() => toast(t('chat.requested'), 'success'))
      .catch(toastError);
  const block = async () => {
    try {
      await blocks.block(pk);
      await dm.forget(pk);
      toast(t('chat.blockedDone'), 'success');
      location.hash = '#/';
    } catch (err) {
      toastError(err);
    }
  };
  const forget = async () => {
    if (!(await confirmDialog({ title: t('chat.forgetTitle'), message: t('chat.forgetText'), confirm: t('chat.forget'), danger: true }))) return;
    await dm.forget(pk);
    location.hash = '#/';
  };
  const menu = () => {
    if (!menuBtn.current) return;
    openMenu(menuBtn.current, [
      { label: t('chat.copyNpub'), icon: 'copy', run: () => copyText(npub(pk), 'npub') },
      ...(!friend && !asked && !blocked ? [{ label: t('chat.addFriend'), icon: 'user-plus', run: addFriend }] : []),
      '-',
      { label: t('chat.forget'), icon: 'trash-2', run: forget },
      ...(!blocked ? [{ label: t('chat.block'), icon: 'x', danger: true, run: block }] : []),
    ]);
  };

  return (
    <section className="conversation" data-pk={pk}>
      <div className="page-head">
        <a className="icon-btn back" href="#/" aria-label={t('chat.back')}>
          <Icon name="chevron-left" />
        </a>
        <div className="who">
          <h1>{name}</h1>
          {name !== fingerprint(pk) ? <small className="muted">{fingerprint(pk)}</small> : null}
        </div>
        <button type="button" className="icon-btn" data-act="menu" aria-label={t('common.more')} ref={menuBtn} onClick={menu}>
          <Icon name="ellipsis" />
        </button>
      </div>
      {blocked ? (
        <div className="banner" id="blockedBanner">
          <Icon name="shield" />
          <p>{t('chat.blocked')}</p>
          <button type="button" className="btn btn-sm" onClick={() => blocks.unblock(pk).catch(toastError)}>
            {t('chat.unblock')}
          </button>
        </div>
      ) : !friend ? (
        <div className="banner" id="notFriend">
          <Icon name="user-plus" />
          <p>{t('chat.notFriend', { name })}</p>
          {!asked ? (
            <button type="button" className="btn btn-sm btn-primary" data-act="add-friend" onClick={addFriend}>
              {t('chat.addFriend')}
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="messages" id="messages">
        {hasMore ? (
          <button type="button" className="link-btn older" onClick={() => setLimit((n) => n + PAGE)}>
            {t('chat.older')}
          </button>
        ) : null}
        {msgs.map((m) => (
          <div key={m.id} className={`msg ${m.from === identity.pk ? 'mine' : 'theirs'}`}>
            <p>{m.text}</p>
            <time dateTime={new Date(m.at * 1000).toISOString()}>{relTime(m.at * 1000)}</time>
          </div>
        ))}
        <div ref={end} />
      </div>
      {blocked ? null : <Composer onSend={(text) => dm.send(pk, text)} placeholder={t('chat.write')} />}
    </section>
  );
}
