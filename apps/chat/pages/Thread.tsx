// A thread: the messages of one conversation or group, oldest at the top, and
// the composer. What a conversation and a group share (0.30): replies quoted
// above the answer, reactions under a message, edits marked, deletions shown
// as such, the pinned messages in a bar under the header, the timer's lines,
// a message's actions (tap it: react, reply, copy, edit, pin, delete), and a
// jump to one message (from a search, a quote or the pin bar), loading older
// ones until it is there. The data comes folded from the inbox
// (shared/chat.js messages(), shared/chatlog.js); `api` sends.
import { type FormEvent, type KeyboardEvent, type MouseEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { RING_FOR } from '../../../shared/calls.js';
import { DirectMessages, TEXT } from '../../../shared/chat.js';
import { QUICK, TIMERS } from '../../../shared/chatlog.js';
import { now } from '../../../shared/events.js';
import { relTime } from '../../../shared/i18n.js';
import { Icon } from '../../../ui/components';
import { confirmDialog } from '../../../ui/dialogs';
import { useIdentity, useT } from '../../../ui/hooks';
import { copyText, toastError } from '../../../ui/toast';
import { FileCard } from '../../../ui/widgets/FileCard';
import { Modal } from '../../../ui/widgets/Modal';
import { useDm, useDmVersion } from '../state';

const PAGE = 50;
const URL_RE = /(https?:\/\/[^\s<>"'`]+)/g;
type T = (key: string, params?: Record<string, unknown>) => string;

/** What a thread sends with: a conversation's (shared/chat.js) or a group's (shared/groups.js). */
export interface ThreadApi {
  send: (text: string, reply: string) => Promise<unknown>;
  sendFile?: (file: File, onProgress: (share: number) => void, reply: string) => Promise<unknown>;
  react: (m: any, emoji: string) => Promise<unknown>;
  unreact: (m: any) => Promise<unknown>;
  edit: (m: any, text: string) => Promise<unknown>;
  remove: (m: any) => Promise<unknown>;
  pin: (m: any, on: boolean) => Promise<unknown>;
  /** someone's name in this thread */
  nameOf: (pk: string) => string;
}

/** Message text with its links clickable: the site's own open here, others in a new tab. */
export function Text({ text }: { text: string }) {
  const parts = text.split(URL_RE);
  return (
    <p>
      {parts.map((part, i) =>
        /^https?:\/\//.test(part) ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: the parts of one text are fixed
          <a key={i} href={part} rel="noopener noreferrer" target={part.startsWith(location.origin) ? undefined : '_blank'}>
            {part}
          </a>
        ) : (
          part
        ),
      )}
    </p>
  );
}

const TIMER_KEYS: Record<number, string> = { 300: 'm5', 3600: 'h1', 28800: 'h8', 86400: 'd1', 604800: 'w1', 2419200: 'w4' };

/** A timer for people: "5 minutes", "1 day"; one another app set to something else, in minutes. */
export function timerLabel(t: T, seconds: number): string {
  if (!seconds) return t('chat.timer.off');
  return TIMER_KEYS[seconds] ? t(`chat.timer.${TIMER_KEYS[seconds]}`) : t('chat.timer.minutes', { n: Math.max(1, Math.round(seconds / 60)) });
}

const JOIN_FOR = 6 * 3600; // a group's call is offered to join for so long after it started (nobody knows when the last one left)

/** A call's line: how it went, or that it is going on. */
export function callText(t: T, m: any, me: string, nameOf: (pk: string) => string): string {
  const c = m.call;
  if (c.state === 'ended') return t('call.line.ended', { time: `${Math.floor((c.duration || 0) / 60)}:${String((c.duration || 0) % 60).padStart(2, '0')}` });
  if (c.state === 'declined') return t('call.line.declined');
  if (m.group && (c.state === 'ringing' || c.state === 'answered')) return t('call.line.group', { name: nameOf(m.from) });
  if (c.state === 'answered') return t(c.video ? 'call.video' : 'call.voice');
  if (c.state === 'ringing' && now() - m.at < RING_FOR) return t('call.line.ringing');
  return m.from === me ? t('call.line.noAnswer') : t('call.line.missed');
}

/** A group's call that may still be going on: it can be joined. */
export const joinable = (m: any) =>
  m.system === 'call' && m.group && ['ringing', 'answered'].includes(m.call.state) && m.call.secret && now() - m.at < JOIN_FOR;

const callIcon = (m: any, me: string) =>
  m.call.state === 'missed' || (m.call.state === 'ringing' && !m.group && m.from !== me && now() - m.at >= RING_FOR)
    ? 'phone-missed'
    : m.call.video
      ? 'video'
      : 'phone';

/** The line a timer or a call leaves in the thread. */
export function systemText(t: T, m: any, me: string, nameOf: (pk: string) => string): string {
  if (m.system === 'call') return callText(t, m, me, nameOf);
  const time = timerLabel(t, m.timer);
  if (m.from === me) return m.timer ? t('chat.timer.youSet', { time }) : t('chat.timer.youOff');
  return m.timer ? t('chat.timer.theySet', { name: nameOf(m.from), time }) : t('chat.timer.theyOff', { name: nameOf(m.from) });
}

/** A message in one line: its text, a file's name, or that it was deleted (lists, quotes, the pin bar, results). */
export function preview(t: T, m: any, me = '', nameOf: (pk: string) => string = () => ''): string {
  if (!m) return '';
  if (m.system) return systemText(t, m, me, nameOf);
  if (m.deleted) return t('chat.deleted');
  if (m.file) return t('files.preview', { name: m.file.name });
  return String(m.text || '').split('\n')[0];
}

type Context = { kind: 'reply' | 'edit'; m: any } | null;

/** `draft`: text the composer starts with (a link from another app: "About your listing …"), not sent until the person sends it. */
export function Composer({
  onSend,
  onFile,
  placeholder,
  id = 'composer',
  draft = '',
  context = null,
  contextLabel = '',
  onCancel,
}: {
  onSend: (text: string) => Promise<unknown>;
  /** a file chosen with the paperclip: upload it (reporting progress, 0 to 1) and send it */
  onFile?: (file: File, onProgress: (share: number) => void) => Promise<unknown>;
  placeholder: string;
  id?: string;
  draft?: string;
  /** a reply or an edit under way: shown above the text, Escape or the cross ends it */
  context?: Context;
  contextLabel?: string;
  onCancel?: () => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const picker = useRef<HTMLInputElement | null>(null);
  // an edit puts the message's text in the box; a reply only asks for the answer
  const editing = context?.kind === 'edit' ? context.m : null;
  const wasEditing = useRef(false);
  useEffect(() => {
    const ta = ref.current;
    if (!ta) return;
    if (editing) ta.value = editing.text || '';
    else if (wasEditing.current) ta.value = ''; // an edit ended (saved or not): its text does not stay for the next message
    wasEditing.current = Boolean(editing);
    if (context) ta.focus();
  }, [context, editing]);
  const attach = async (file: File) => {
    if (!onFile || busy) return;
    setBusy(true);
    setProgress(0);
    try {
      await onFile(file, setProgress);
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };
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
    } else if (e.key === 'Escape' && context) {
      e.preventDefault();
      onCancel?.();
    }
  };
  return (
    <form className="composer" id={id} onSubmit={submit}>
      {progress != null ? <progress className="upload-progress" max={1} value={progress} aria-label={t('files.uploading')} /> : null}
      {context ? (
        <div className="composer-context" data-context={context.kind}>
          <Icon name={context.kind === 'edit' ? 'pencil' : 'reply'} />
          <span className="context-main">
            <b>{contextLabel}</b>
            <span>{preview(t, context.m)}</span>
          </span>
          <button
            type="button"
            className="icon-btn"
            data-act="cancel-context"
            aria-label={t('common.cancel')}
            title={t('common.cancel')}
            onClick={() => onCancel?.()}
          >
            <Icon name="x" />
          </button>
        </div>
      ) : null}
      {onFile && !editing ? (
        <>
          <input
            ref={picker}
            type="file"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void attach(f);
            }}
          />
          <button
            type="button"
            className="icon-btn attach"
            data-act="attach"
            aria-label={t('files.attach')}
            title={t('files.attach')}
            disabled={busy}
            onClick={() => picker.current?.click()}
          >
            <Icon name="paperclip" />
          </button>
        </>
      ) : null}
      <textarea
        ref={ref}
        name="text"
        rows={draft ? 3 : 1}
        maxLength={TEXT}
        placeholder={placeholder}
        aria-label={placeholder}
        onKeyDown={onKey}
        defaultValue={draft}
      />
      <button
        type="submit"
        className="btn btn-primary"
        disabled={busy}
        aria-label={editing ? t('common.save') : t('chat.send')}
        title={editing ? t('common.save') : t('chat.send')}
      >
        <Icon name={editing ? 'check' : 'send'} />
      </button>
    </form>
  );
}

/** A message's actions: a row of reactions, then reply, copy, edit, pin and delete. A sheet on a phone, beside the message elsewhere. */
function Actions({ m, anchor, mine, close, api }: { m: any; anchor: HTMLElement; mine: boolean; close: () => void; api: ActionsApi }) {
  const t = useT();
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = anchor.getBoundingClientRect();
    const h = el.offsetHeight;
    const w = el.offsetWidth;
    const vw = document.documentElement.clientWidth;
    const top = r.bottom + 6 + h < window.innerHeight ? r.bottom + 6 : Math.max(8, r.top - h - 6);
    const left = Math.max(8, Math.min(mine ? r.right - w : r.left, vw - w - 8));
    setPos({ top, left });
    el.querySelector<HTMLButtonElement>('button')?.focus();
  }, [anchor, mine]);
  useEffect(() => {
    const outside = (e: Event) => !ref.current?.contains(e.target as Node) && close();
    const onKey = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && close();
    const timer = setTimeout(() => {
      document.addEventListener('pointerdown', outside, true);
      document.addEventListener('keydown', onKey, true);
    });
    return () => {
      clearTimeout(timer);
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [close]);
  const mineEmoji = m.reactions?.find((r: any) => r.mine)?.emoji || '';
  const run = (fn: () => unknown) => () => {
    close();
    Promise.resolve(fn()).catch(toastError);
  };
  const item = (act: string, icon: string, label: string, fn: () => unknown, danger = false) => (
    <button type="button" role="menuitem" data-act={act} className={danger ? 'danger' : ''} onClick={run(fn)}>
      <Icon name={icon} />
      <span>{label}</span>
    </button>
  );
  return createPortal(
    <>
      <div className="msg-actions-shade" aria-hidden="true" />
      <div
        className="msg-actions"
        role="menu"
        id="msgActions"
        ref={ref}
        style={pos ? { top: pos.top, left: pos.left } : { visibility: 'hidden', top: 0, left: 0 }}
      >
        <div className="quick" role="group" aria-label={t('chat.react')}>
          {QUICK.map((e) => (
            <button
              key={e}
              type="button"
              data-react={e}
              className={mineEmoji === e ? 'on' : ''}
              aria-pressed={mineEmoji === e}
              onClick={run(() => (mineEmoji === e ? api.unreact(m) : api.react(m, e)))}
            >
              {e}
            </button>
          ))}
        </div>
        {item('reply', 'reply', t('chat.reply'), () => api.reply(m))}
        {m.file ? null : item('copy', 'copy', t('chat.copy'), () => copyText(m.text, t('chat.message')))}
        {mine && !m.file ? item('edit', 'pencil', t('chat.edit'), () => api.startEdit(m)) : null}
        {m.pinned ? item('unpin', 'pin-off', t('chat.unpin'), () => api.pin(m, false)) : item('pin', 'pin', t('chat.pin'), () => api.pin(m, true))}
        {mine ? item('delete', 'trash-2', t('chat.delete'), () => api.askRemove(m), true) : null}
      </div>
    </>,
    document.body,
  );
}

type ActionsApi = ThreadApi & { reply: (m: any) => void; startEdit: (m: any) => void; askRemove: (m: any) => Promise<void> };

/** Pick how long messages stay: off, or one of TIMERS. */
export function TimerDialog({ current, onPick, onClose }: { current: number; onPick: (s: number) => Promise<unknown>; onClose: () => void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const pick = async (s: number) => {
    setBusy(true);
    try {
      await onPick(s);
      onClose();
    } catch (err) {
      setBusy(false);
      toastError(err);
    }
  };
  return (
    <Modal open title={t('chat.timer.title')} onClose={onClose} id="timerDialog">
      <p className="modal-text">{t('chat.timer.text')}</p>
      <div className="timer-options" role="radiogroup" aria-label={t('chat.timer.title')}>
        {TIMERS.map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={s === current}
            data-timer={s}
            disabled={busy}
            className={s === current ? 'on' : ''}
            onClick={() => pick(s)}
          >
            <Icon name={s ? 'timer' : 'x'} />
            <span>{timerLabel(t, s)}</span>
            {s === current ? <Icon name="check" /> : null}
          </button>
        ))}
      </div>
      <p className="hint small">{t('chat.timer.hint')}</p>
    </Modal>
  );
}

/**
 * The thread: messages of `conv` with their actions, the pin bar, the composer.
 * `group`: names over others' messages; `focus`: a message to show at once (from a search or a link).
 */
export function Thread({
  conv,
  api,
  group = false,
  focus = '',
  draft = '',
  listId,
  composerId = 'composer',
  closed = false,
  empty = '',
  onJoin,
}: {
  conv: string;
  api: ThreadApi;
  group?: boolean;
  focus?: string;
  draft?: string;
  listId: string;
  composerId?: string;
  /** no composer (a blocked person) */
  closed?: boolean;
  empty?: string;
  /** a group's call line offers to join it */
  onJoin?: (m: any) => void;
}) {
  const t = useT();
  const dm = useDm();
  const version = useDmVersion(dm);
  const identity = useIdentity();
  const me = identity.pk;
  const [msgs, setMsgs] = useState<any[]>([]);
  const [pins, setPins] = useState<any[]>([]);
  const [pinAt, setPinAt] = useState(0);
  const [limit, setLimit] = useState(PAGE);
  const [hasMore, setHasMore] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [acting, setActing] = useState<{ m: any; anchor: HTMLElement } | null>(null);
  const [context, setContext] = useState<Context>(null);
  const [want, setWant] = useState(focus); // a message to bring into view, loading older ones until it is here
  useEffect(() => {
    if (focus) setWant(focus);
  }, [focus]);
  const [lit, setLit] = useState('');
  const [clock, setClock] = useState(0); // the next message to run out: the list is read again then
  const end = useRef<HTMLDivElement | null>(null);
  const list = useRef<HTMLDivElement | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` and `clock` say the store changed or a message ran out
  useEffect(() => {
    let live = true;
    Promise.all([dm.messages(conv, { limit: limit + 1 }), dm.pinned(conv)]).then(([m, p]: [any[], any[]]) => {
      if (!live) return;
      setHasMore(m.length > limit);
      setMsgs(m.slice(-limit));
      setPins(p);
      setLoaded(true);
    });
    return () => {
      live = false;
    };
  }, [dm, conv, limit, version, clock]);
  // a disappearing message leaves the screen when it runs out, not at the next change
  useEffect(() => {
    const next = Math.min(...msgs.filter((m) => m.expires).map((m) => m.expires));
    if (!Number.isFinite(next)) return;
    const id = setTimeout(() => setClock((c) => c + 1), Math.max(500, next * 1000 - Date.now() + 200));
    return () => clearTimeout(id);
  }, [msgs]);
  const last = msgs[msgs.length - 1];
  useEffect(() => {
    if (last) dm.markRead(conv, DirectMessages.timeOf(last));
  }, [dm, conv, last]);
  // what is on screen is not announced elsewhere on the page
  useEffect(() => {
    dm.setActive(conv);
    return () => dm.setActive(null);
  }, [dm, conv]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when the newest message changes
  useEffect(() => {
    if (!want) end.current?.scrollIntoView({ block: 'end' });
  }, [last?.id]);
  // a jump: once the message is loaded, it is brought into view and lit for a moment; older pages load until then
  // biome-ignore lint/correctness/useExhaustiveDependencies: `msgs`: the list was drawn again, the message may be in it now
  useEffect(() => {
    if (!want || !loaded) return;
    const el = list.current?.querySelector<HTMLElement>(`[data-id="${want}"]`);
    if (el) {
      el.scrollIntoView({ block: 'center' });
      setLit(want);
      setWant('');
      const id = setTimeout(() => setLit(''), 2000);
      return () => clearTimeout(id);
    }
    if (hasMore) setLimit((n) => n + PAGE);
    else setWant('');
  }, [want, msgs, hasMore, loaded]);

  const reply = (m: any) => setContext({ kind: 'reply', m });
  const startEdit = (m: any) => setContext({ kind: 'edit', m });
  const askRemove = async (m: any) => {
    if (!(await confirmDialog({ title: t('chat.deleteTitle'), message: t('chat.deleteText'), confirm: t('chat.delete'), danger: true }))) return;
    await api.remove(m);
    if (context?.m?.id === m.id) setContext(null);
  };
  const actionsApi: ActionsApi = { ...api, reply, startEdit, askRemove };
  const closeActions = useCallback(() => setActing(null), []);
  const sendFile = api.sendFile;
  const open = (e: MouseEvent<HTMLDivElement>, m: any) => {
    if (m.deleted || m.system) return;
    if ((e.target as HTMLElement).closest('a, button, input, video, audio')) return;
    if (String(window.getSelection?.() || '').trim()) return; // selecting text, not asking for the actions
    setActing({ m, anchor: e.currentTarget });
  };
  const send = async (text: string) => {
    if (context?.kind === 'edit') {
      if (text !== context.m.text) await api.edit(context.m, text);
    } else await api.send(text, context?.kind === 'reply' ? context.m.id : '');
    setContext(null);
  };
  const nameIn = (pk: string) => (pk === me ? t('chat.you') : api.nameOf(pk));
  const pin = pins.length ? pins[pinAt % pins.length] : null;

  return (
    <>
      {pin ? (
        <button
          type="button"
          className="pinbar"
          id="pinbar"
          data-pin={pin.id}
          onClick={() => {
            setWant(pin.id);
            setPinAt((i) => (i + 1) % pins.length);
          }}
        >
          <Icon name="pin" />
          <span className="pin-main">
            <b>{pins.length > 1 ? t('chat.pins.many', { i: (pinAt % pins.length) + 1, n: pins.length }) : t('chat.pins.one')}</b>
            <span>{preview(t, pin)}</span>
          </span>
        </button>
      ) : null}
      <div className="messages" id={listId} ref={list}>
        {hasMore ? (
          <button type="button" className="link-btn older" onClick={() => setLimit((n) => n + PAGE)}>
            {t('chat.older')}
          </button>
        ) : null}
        {loaded && !msgs.length && empty ? <p className="empty">{empty}</p> : null}
        {msgs.map((m) =>
          m.system ? (
            <p key={m.id} className="sysline" data-system={m.system} data-id={m.id} data-state={m.call?.state}>
              <Icon name={m.system === 'call' ? callIcon(m, me) : 'timer'} />
              <span>{systemText(t, m, me, api.nameOf)}</span>
              {onJoin && joinable(m) ? (
                <button type="button" className="btn btn-sm btn-primary" data-act="join" onClick={() => onJoin(m)}>
                  {t('call.join')}
                </button>
              ) : null}
            </p>
          ) : (
            // a tap on the bubble opens its actions (it holds links and files of its own, so it is no button); by keyboard, its time is the button
            <div
              key={m.id}
              data-id={m.id}
              className={`msg ${m.from === me ? 'mine' : 'theirs'}${m.deleted ? ' deleted' : ''}${lit === m.id ? ' lit' : ''}${m.reactions?.length ? ' reacted' : ''}`}
              onClick={(e) => open(e, m)}
            >
              {group && m.from !== me ? <b className="nick">{m.name || api.nameOf(m.from)}</b> : null}
              {m.reply ? (
                <button type="button" className="quote" data-quote={m.reply} onClick={() => setWant(m.reply)}>
                  <b>{m.replyTo ? nameIn(m.replyTo.from) : ''}</b>
                  <span>{m.replyTo ? preview(t, m.replyTo) : t('chat.replyMissing')}</span>
                </button>
              ) : null}
              {m.deleted ? <p className="gone">{t('chat.deleted')}</p> : m.file ? <FileCard file={m.file} /> : <Text text={m.text} />}
              <button
                type="button"
                className="meta"
                aria-label={t('chat.actions')}
                disabled={m.deleted}
                onClick={(e) => setActing({ m, anchor: e.currentTarget.parentElement as HTMLElement })}
              >
                {m.pinned ? <Icon name="pin" /> : null}
                {m.expires ? <Icon name="timer" /> : null}
                <time dateTime={new Date(m.at * 1000).toISOString()}>{relTime(m.at * 1000)}</time>
                {m.edited ? <span className="edited">{t('chat.edited')}</span> : null}
              </button>
              {m.reactions?.length ? (
                <div className="reactions">
                  {m.reactions.map((r: any) => (
                    <button
                      key={r.emoji}
                      type="button"
                      className={`reaction${r.mine ? ' mine' : ''}`}
                      data-react={r.emoji}
                      title={r.from.map(nameIn).join(', ')}
                      aria-pressed={r.mine}
                      onClick={() => (r.mine ? api.unreact(m) : api.react(m, r.emoji)).catch(toastError)}
                    >
                      {r.emoji}
                      {r.from.length > 1 ? <span>{r.from.length}</span> : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ),
        )}
        <div ref={end} />
      </div>
      {closed ? null : (
        <Composer
          id={composerId}
          onSend={send}
          onFile={
            sendFile ? (file, onProgress) => sendFile(file, onProgress, context?.kind === 'reply' ? context.m.id : '').then(() => setContext(null)) : undefined
          }
          placeholder={t('chat.write')}
          draft={draft}
          context={context}
          contextLabel={context ? (context.kind === 'edit' ? t('chat.editing') : t('chat.replyingTo', { name: nameIn(context.m.from) })) : ''}
          onCancel={() => setContext(null)}
        />
      )}
      {acting ? <Actions m={acting.m} anchor={acting.anchor} mine={acting.m.from === me} close={closeActions} api={actionsApi} /> : null}
    </>
  );
}
