// One conversation: the messages with one person, oldest at the top, and
// the composer. Enter sends, Shift+Enter breaks a line.
import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { npub } from '../../../shared/account.js';
import { DirectMessages, TEXT } from '../../../shared/chat.js';
import { fingerprint } from '../../../shared/events.js';
import { uploadFile } from '../../../shared/files.js';
import { relTime } from '../../../shared/i18n.js';
import { BackLink } from '../../../ui/BackLink';
import { Icon } from '../../../ui/components';
import { confirmDialog, openMenu } from '../../../ui/dialogs';
import { useBlocks, useIdentity, useKiwi, usePeople, useT } from '../../../ui/hooks';
import { copyText, toast, toastError } from '../../../ui/toast';
import { FileCard } from '../../../ui/widgets/FileCard';
import { useDm, useDmVersion } from '../state';

const PAGE = 50;
const URL_RE = /(https?:\/\/[^\s<>"'`]+)/g;

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

/** `draft`: text the composer starts with (a link from another app: "About your listing …"), not sent until the person sends it. */
export function Composer({
  onSend,
  onFile,
  placeholder,
  id = 'composer',
  draft = '',
}: {
  onSend: (text: string) => Promise<unknown>;
  /** a file chosen with the paperclip: upload it (reporting progress, 0 to 1) and send it */
  onFile?: (file: File, onProgress: (share: number) => void) => Promise<unknown>;
  placeholder: string;
  id?: string;
  draft?: string;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const picker = useRef<HTMLInputElement | null>(null);
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
    }
  };
  return (
    <form className="composer" id={id} onSubmit={submit}>
      {progress != null ? <progress className="upload-progress" max={1} value={progress} aria-label={t('files.uploading')} /> : null}
      {onFile ? (
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
      <button type="submit" className="btn btn-primary" disabled={busy} aria-label={t('chat.send')} title={t('chat.send')}>
        <Icon name="send" />
      </button>
    </form>
  );
}

export function Conversation({ pk, draft = '' }: { pk: string; draft?: string }) {
  const t = useT();
  const kiwi = useKiwi();
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
    if (last) dm.markRead(pk, DirectMessages.timeOf(last));
  }, [dm, pk, last]);
  // what is on screen is not announced elsewhere on the page
  useEffect(() => {
    dm.setActive(pk);
    return () => dm.setActive(null);
  }, [dm, pk]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when the newest message changes
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [last?.id]);

  // the friend's name, else the name they sign their messages with (no friend yet, or one from before names travelled), else the key's fingerprint
  const signed = [...msgs].reverse().find((m) => m.from === pk && m.name)?.name;
  const name = people?.friends?.().find((f: any) => f.pk === pk)?.name || signed || fingerprint(pk);
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
    <section className="conversation page-enter" data-pk={pk}>
      <div className="page-head">
        <BackLink href="#/" label={t('chat.back')} />
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
            {m.file ? <FileCard file={m.file} /> : <Text text={m.text} />}
            <time dateTime={new Date(m.at * 1000).toISOString()}>{relTime(m.at * 1000)}</time>
          </div>
        ))}
        <div ref={end} />
      </div>
      {blocked ? null : (
        <Composer
          onSend={(text) => dm.send(pk, text)}
          onFile={(file, onProgress) => uploadFile(file, { servers: kiwi.mediaServers(), sk: identity.sk, onProgress }).then((f) => dm.sendFile(pk, f))}
          placeholder={t('chat.write')}
          draft={draft}
        />
      )}
    </section>
  );
}
