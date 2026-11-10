// One group. From its link: the door (knock, then wait for the host). As a
// member: the people in it, the messages under their names, the composer;
// for the host, who is at the door, and the menu to run the room: invite
// friends directly, copy or reset the invite link, let anyone with the link
// in, make messages disappear, remove someone, close. Pinning the group to
// the top of the list and leaving are everyone's. The thread is ./Thread.tsx.
import { type FormEvent, useRef, useState } from 'react';
import { fingerprint } from '../../../shared/events.js';
import { uploadFile } from '../../../shared/files.js';
import { BackLink } from '../../../ui/BackLink';
import { Icon } from '../../../ui/components';
import { confirmDialog, openMenu, pickPeople } from '../../../ui/dialogs';
import { useGroups, useIdentity, useKiwi, usePeople, useT } from '../../../ui/hooks';
import { copyText, toast, toastError } from '../../../ui/toast';
import { savedNick, saveNick } from '../state';
import { Thread, type ThreadApi, TimerDialog, timerLabel } from './Thread';

const pageUrl = () => `${location.origin}${location.pathname}`;

/** The door: knock with a name, then wait until the host answers (the knock survives a reload: it is in the account). */
function Door({ pub, host, invite, name, relays }: { pub: string; host: string; invite: string; name: string; relays: string[] }) {
  const t = useT();
  const groups = useGroups();
  const identity = useIdentity();
  const [busy, setBusy] = useState(false);
  const knock = groups.knocks().find((k: any) => k.pub === pub);
  const ask = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const myName = String(new FormData(e.currentTarget).get('name') || '')
      .trim()
      .slice(0, 60);
    if (!myName) return;
    setBusy(true);
    try {
      saveNick(myName);
      await groups.knock({ pub, host, invite, name, myName, relays });
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="room-enter page-enter">
      <div className="page-head">
        <BackLink href="#/groups" label={t('chat.back')} />
        <h1>{name || knock?.name || t('chat.group.title')}</h1>
      </div>
      {knock ? (
        <div className="card" id="knockWaiting">
          <p>
            <span className="spinner" /> {t('chat.group.waiting', { name: knock.name || t('chat.group.title') })}
          </p>
          <p className="muted small">{t('chat.group.waitingHint')}</p>
          <button type="button" className="btn btn-sm" onClick={() => groups.forgetKnock(pub).then(() => (location.hash = '#/groups'))}>
            {t('common.cancel')}
          </button>
        </div>
      ) : (
        <form className="card form" id="joinGroup" onSubmit={ask}>
          <p>{t('chat.group.knockText', { name: name || t('chat.group.title') })}</p>
          <label className="field">
            {t('chat.group.yourName')}
            <input name="name" maxLength={60} required defaultValue={identity.alias || savedNick()} autoComplete="nickname" data-autofocus />
          </label>
          <p className="hint">
            <Icon name="lock" /> {t('chat.group.hint')}
          </p>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" id="knockBtn" disabled={busy}>
              {t('chat.group.knock')}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

/** Who is at the door, for the host. */
function Requests({ pub }: { pub: string }) {
  const t = useT();
  const groups = useGroups();
  const requests = groups.requests(pub);
  if (!requests.length) return null;
  return (
    <div className="banner requests" id="requests">
      <Icon name="user-plus" />
      <ul>
        {requests.map((r: any) => (
          <li key={r.pk}>
            <span>
              {t('chat.group.wantsIn', { name: r.name || fingerprint(r.pk) })} <code>{fingerprint(r.pk)}</code>
            </span>
            <button type="button" className="btn btn-sm btn-primary" data-admit={r.pk} onClick={() => groups.admit(pub, r.pk).catch(toastError)}>
              {t('chat.group.admit')}
            </button>
            <button type="button" className="btn btn-sm" data-decline={r.pk} onClick={() => groups.decline(pub, r.pk)}>
              {t('chat.group.decline')}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function GroupView({
  pub,
  host,
  invite,
  name: linkName,
  relays = [],
  focus = '',
}: {
  pub: string;
  host: string;
  invite: string;
  name: string;
  relays?: string[];
  focus?: string;
}) {
  const t = useT();
  const kiwi = useKiwi();
  const groups = useGroups();
  const people = usePeople();
  const identity = useIdentity();
  const entry = groups.entry(pub);
  const info = groups.info(pub);
  const [timing, setTiming] = useState(false);
  const menuBtn = useRef<HTMLButtonElement | null>(null);

  if (!entry) return <Door pub={pub} host={host} invite={invite} name={linkName} relays={kiwi.hints(relays)} />;

  const name = info?.name || entry.name || t('chat.group.title');
  const members = groups.members(pub);
  const isHost = groups.isHost(pub);
  const link = groups.inviteLink(pageUrl(), pub);
  const nameOf = (pk: string) => members.find((m: any) => m.pk === pk)?.name || people?.nameOf?.(pk) || fingerprint(pk);
  const inviteFriends = async () => {
    const pks: string[] = await pickPeople(people, { base: kiwi.base });
    if (!pks.length) return;
    try {
      await groups.invite(pub, pks);
      toast(t('chat.group.invited', { n: pks.length }), 'success');
    } catch (err) {
      toastError(err);
    }
  };
  const leave = async () => {
    if (
      !(await confirmDialog({ title: t('chat.group.leaveTitle', { name }), message: t('chat.group.leaveText'), confirm: t('chat.group.leave'), danger: true }))
    )
      return;
    await groups.leave(pub).catch(toastError);
    location.hash = '#/groups';
  };
  const close = async () => {
    if (
      !(await confirmDialog({ title: t('chat.group.closeTitle', { name }), message: t('chat.group.closeText'), confirm: t('chat.group.close'), danger: true }))
    )
      return;
    try {
      await groups.close(pub);
      toast(t('chat.group.closedDone', { name }), 'success');
      location.hash = '#/groups';
    } catch (err) {
      toastError(err);
    }
  };
  const remove = async (pk: string) => {
    if (
      !(await confirmDialog({
        title: t('chat.group.removeTitle', { name: nameOf(pk) }),
        message: t('chat.group.removeText'),
        confirm: t('chat.group.remove'),
        danger: true,
      }))
    )
      return;
    groups.kick(pub, pk).catch(toastError);
  };
  const pinned = groups.pinned().includes(pub);
  const timer = groups.timerOf(pub);
  const menu = () => {
    if (!menuBtn.current) return;
    openMenu(menuBtn.current, [
      ...(people ? [{ label: t('chat.room.invite'), icon: 'user-plus', run: inviteFriends }] : []),
      {
        label: pinned ? t('chat.unpinConv') : t('chat.pinConv'),
        icon: pinned ? 'pin-off' : 'pin',
        act: 'pin-conv',
        run: () => groups.setPinned(pub, !pinned).catch(toastError),
      },
      ...(link ? [{ label: t('chat.group.copyLink'), icon: 'link', run: () => copyText(link, t('chat.group.linkCopied')) }] : []),
      ...(isHost
        ? [
            {
              label: t('chat.group.resetLink'),
              icon: 'refresh-cw',
              run: () => groups.resetInvite(pub).then(() => toast(t('chat.group.linkReset'), 'success'), toastError),
            },
            {
              label: info?.open ? t('chat.group.openOff') : t('chat.group.openOn'),
              icon: info?.open ? 'lock' : 'globe',
              run: () => groups.setOpen(pub, !info?.open).catch(toastError),
            },
            { label: t('chat.timer.title'), icon: 'timer', act: 'timer', run: () => setTiming(true) },
          ]
        : []),
      '-',
      ...(isHost ? [{ label: t('chat.group.close'), icon: 'x', danger: true, run: close }] : []),
      { label: t('chat.group.leave'), icon: 'log-out', danger: !isHost, run: leave },
    ]);
  };

  const api: ThreadApi = {
    send: (text, reply) => groups.say(pub, text, { reply }),
    sendFile: (file, onProgress, reply) =>
      uploadFile(file, { servers: kiwi.mediaServers(), sk: identity.sk, onProgress }).then((f) => groups.sayFile(pub, f, { reply })),
    react: (m, emoji) => groups.react(pub, m, emoji),
    unreact: (m) => groups.unreact(pub, m),
    edit: (m, text) => groups.edit(pub, m, text),
    remove: (m) => groups.remove(pub, m),
    pin: (m, on) => groups.pin(pub, m, on),
    nameOf,
  };

  return (
    <section className="group page-enter" data-group={pub.slice(0, 12)} data-invite={link || ''}>
      <div className="page-head">
        <BackLink href="#/groups" label={t('chat.back')} />
        <div className="who">
          <h1>{name}</h1>
          <small className="muted" id="groupMembers">
            {timer ? (
              <span className="timer-badge" id="timerBadge" data-timer={timer}>
                <Icon name="timer" /> {timerLabel(t, timer)}
              </span>
            ) : null}
            {t('chat.group.members', { n: members.length })}:{' '}
            {members.map((m: any, i: number) => (
              <span key={m.pk} className="member">
                {i ? ', ' : ''}
                {m.name || fingerprint(m.pk)}
                {isHost && !m.me ? (
                  <button
                    type="button"
                    className="link-btn remove"
                    data-remove={m.pk}
                    title={t('chat.group.remove')}
                    aria-label={t('chat.group.remove')}
                    onClick={() => remove(m.pk)}
                  >
                    <Icon name="x" />
                  </button>
                ) : null}
              </span>
            ))}
          </small>
        </div>
        <button type="button" className="icon-btn" data-act="menu" aria-label={t('common.more')} ref={menuBtn} onClick={menu}>
          <Icon name="ellipsis" />
        </button>
      </div>
      {isHost ? <Requests pub={pub} /> : null}
      <Thread conv={pub} api={api} group focus={focus} listId="groupMessages" composerId="groupComposer" empty={t('chat.group.empty')} />
      {timing ? <TimerDialog current={timer} onPick={(s) => groups.setTimer(pub, s)} onClose={() => setTiming(false)} /> : null}
    </section>
  );
}
