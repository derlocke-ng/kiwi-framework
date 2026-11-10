// One conversation: the messages with one person and the composer (the
// thread, ./Thread.tsx), under a header with their name, the timer when it
// is on, and the menu: copy their key, befriend, pin the conversation, make
// messages disappear, forget, block.
import { useEffect, useRef, useState } from 'react';
import { npub } from '../../../shared/account.js';
import { fingerprint } from '../../../shared/events.js';
import { uploadFile } from '../../../shared/files.js';
import { BackLink } from '../../../ui/BackLink';
import { Icon } from '../../../ui/components';
import { confirmDialog, openMenu } from '../../../ui/dialogs';
import { useBlocks, useGroups, useIdentity, useKiwi, usePeople, useT } from '../../../ui/hooks';
import { copyText, toast, toastError } from '../../../ui/toast';
import { activeCall, startCall } from '../calling';
import { useDm, useDmVersion } from '../state';
import { Thread, type ThreadApi, TimerDialog, timerLabel } from './Thread';

export function Conversation({ pk, draft = '', focus = '' }: { pk: string; draft?: string; focus?: string }) {
  const t = useT();
  const kiwi = useKiwi();
  const dm = useDm();
  const version = useDmVersion(dm);
  const people = usePeople();
  const blocks = useBlocks();
  const groups = useGroups();
  const identity = useIdentity();
  const [signed, setSigned] = useState('');
  const [timer, setTimer] = useState(0);
  const [timing, setTiming] = useState(false);
  const menuBtn = useRef<HTMLButtonElement | null>(null);

  // the name they sign their messages with (no friend yet, or one from before names travelled), and the conversation's timer
  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` is the inbox saying something changed
  useEffect(() => {
    let live = true;
    Promise.all([dm.messages(pk, { limit: 30 }), dm.timerOf(pk)]).then(([m, s]: [any[], number]) => {
      if (!live) return;
      setSigned([...m].reverse().find((x) => x.from === pk && x.name)?.name || '');
      setTimer(s);
    });
    return () => {
      live = false;
    };
  }, [dm, pk, version]);

  // the friend's name, else the signed one, else the key's fingerprint
  const name = people?.friends?.().find((f: any) => f.pk === pk)?.name || signed || fingerprint(pk);
  const friend = Boolean(people?.isFriend(pk));
  const asked = Boolean(people?.outgoing().some((r: any) => r.pk === pk));
  const blocked = Boolean(blocks?.isBlocked(pk));
  const pinned = Boolean(groups?.pinned().includes(pk));
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
      ...(groups
        ? [
            {
              label: pinned ? t('chat.unpinConv') : t('chat.pinConv'),
              icon: pinned ? 'pin-off' : 'pin',
              act: 'pin-conv',
              run: () => groups.setPinned(pk, !pinned).catch(toastError),
            },
          ]
        : []),
      ...(!blocked ? [{ label: t('chat.timer.title'), icon: 'timer', act: 'timer', run: () => setTiming(true) }] : []),
      '-',
      { label: t('chat.forget'), icon: 'trash-2', run: forget },
      ...(!blocked ? [{ label: t('chat.block'), icon: 'x', danger: true, run: block }] : []),
    ]);
  };
  const call = async (video: boolean) => {
    if (activeCall()) return toast(t('call.busy'), 'info');
    try {
      await startCall(kiwi, { conv: pk, video, title: name });
      location.hash = '#/call';
    } catch (err) {
      toastError(err);
    }
  };
  const api: ThreadApi = {
    send: (text, reply) => dm.send(pk, text, { reply }),
    sendFile: (file, onProgress, reply) =>
      uploadFile(file, { servers: kiwi.mediaServers(), sk: identity.sk, onProgress }).then((f) => dm.sendFile(pk, f, { reply })),
    react: (m, emoji) => dm.react(pk, m, emoji),
    unreact: (m) => dm.unreact(pk, m),
    edit: (m, text) => dm.edit(pk, m, text),
    remove: (m) => dm.remove(pk, m),
    pin: (m, on) => dm.pin(pk, m, on),
    nameOf: (who) => (who === pk ? name : people?.nameOf?.(who) || fingerprint(who)),
  };

  return (
    <section className="conversation page-enter" data-pk={pk}>
      <div className="page-head">
        <BackLink href="#/" label={t('chat.back')} />
        <div className="who">
          <h1>{name}</h1>
          {timer || name !== fingerprint(pk) ? (
            <small className="muted">
              {timer ? (
                <span className="timer-badge" id="timerBadge" data-timer={timer}>
                  <Icon name="timer" /> {timerLabel(t, timer)}
                </span>
              ) : null}
              {name !== fingerprint(pk) ? fingerprint(pk) : null}
            </small>
          ) : null}
        </div>
        {blocked ? null : (
          <>
            <button type="button" className="icon-btn" data-act="call" aria-label={t('call.voice')} title={t('call.voice')} onClick={() => call(false)}>
              <Icon name="phone" />
            </button>
            <button type="button" className="icon-btn" data-act="video-call" aria-label={t('call.video')} title={t('call.video')} onClick={() => call(true)}>
              <Icon name="video" />
            </button>
          </>
        )}
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
      <Thread conv={pk} api={api} focus={focus} draft={draft} listId="messages" closed={blocked} />
      {timing ? <TimerDialog current={timer} onPick={(s) => dm.setTimer(pk, s)} onClose={() => setTiming(false)} /> : null}
    </section>
  );
}
