// One entry with its comments: what a link to an entry opens. Comments are
// sealed with the entry's key, so whoever reads the entry reads them and may
// add one; relays see who commented on what, not what.
import { type FormEvent, useState } from 'react';
import { npub } from '../../../shared/account.js';
import { KINDS } from '../../../shared/events.js';
import { relTime, tErr } from '../../../shared/i18n.js';
import { Icon } from '../../../ui/components';
import { confirmDialog } from '../../../ui/dialogs';
import { useBlocks, useIdentity, useT } from '../../../ui/hooks';
import { toast } from '../../../ui/toast';
import { LIMITS } from '../data/feed.js';
import { useFeed, useNameOf, useOpened, useSocial } from '../state';
import { Compose } from './Compose';
import { EntryCard } from './EntryCard';
import { useEntries } from './FeedView';

const fail = (err: unknown) => toast(tErr(err), 'error');

function Comments({ entry }: { entry: any }) {
  const t = useT();
  const id = useIdentity();
  const blocks = useBlocks();
  const social = useSocial();
  const { data } = useFeed();
  const nameOf = useNameOf();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const events = social.commentEvents(entry.address, (pk: string) => Boolean(blocks?.isBlocked(pk)));
  const opened = useOpened(events, (ev) => data.openComment(entry, ev), entry.kid);
  const list = events.map((ev: any) => opened.get(ev.id)).filter((c: any) => c && !c.deleted);
  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    try {
      await data.comment(entry, text);
      setText('');
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };
  const remove = async (c: any) => {
    if (await confirmDialog({ title: t('fd.deleteCommentConfirm'), message: '', confirm: t('common.delete'), danger: true }))
      data.removeComment(entry, c).catch(fail);
  };
  return (
    <section className="comments" id="comments" aria-label={t('fd.comments', { n: list.length })}>
      <h2>{t('fd.comments', { n: list.length })}</h2>
      {list.length ? (
        <ul className="comment-list">
          {list.map((c: any) => (
            <li key={c.address} className={`comment${c.pubkey === id.pk ? ' mine' : ''}`} data-comment={c.address}>
              <div className="comment-head">
                <a href={`#/p/${c.pubkey}`} title={npub(c.pubkey)} className="comment-author">
                  {nameOf(c.pubkey, c.name)}
                </a>
                <span className="muted small">{relTime(c.at)}</span>
                {c.pubkey === id.pk ? (
                  <button type="button" className="icon-btn" data-act="comment-delete" aria-label={t('fd.deleteComment')} onClick={() => remove(c)}>
                    <Icon name="trash-2" />
                  </button>
                ) : null}
              </div>
              <p className="comment-text">{c.text}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">{t('fd.noComments')}</p>
      )}
      <form className="form comment-form" id="commentForm" onSubmit={send}>
        <textarea
          name="text"
          rows={2}
          maxLength={LIMITS.comment}
          value={text}
          placeholder={t('fd.commentPlaceholder')}
          aria-label={t('fd.commentPlaceholder')}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) (e.currentTarget.form as HTMLFormElement).requestSubmit();
          }}
        />
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !text.trim()}>
          {t('fd.commentSend')}
        </button>
      </form>
    </section>
  );
}

export function EntryPage({ pk, d, foreign }: { pk: string; d: string; foreign?: { address: string; from: string | null } | null }) {
  const t = useT();
  const [editing, setEditing] = useState<any>(null);
  const list = useEntries([{ kinds: [KINDS.FEED_ENTRY], authors: [pk], '#d': [d] }]);
  const entry = list.entries[0];
  return (
    <div className="entry-page">
      <a className="back-link" href="#/">
        <Icon name="chevron-left" />
        <span>{t('fd.back')}</span>
      </a>
      {foreign ? (
        <div className="banner foreign-space" id="foreignSpace">
          <Icon name="globe" />
          <p>
            {t('fd.foreignSpace', { space: foreign.address.split(':')[2] })}
            {foreign.from ? (
              <>
                {' '}
                <a href={`${foreign.from}${location.hash}`} rel="noopener">
                  {t('fd.openElsewhere')}
                </a>
              </>
            ) : null}
          </p>
        </div>
      ) : null}
      {entry ? (
        <>
          <EntryCard entry={entry} full onEdit={setEditing} />
          <Comments entry={entry} />
        </>
      ) : list.loading || list.opening ? (
        <p className="empty">{t('common.loading')}</p>
      ) : (
        <p className="empty" id="notForYou">
          {t('fd.notForYou')}
        </p>
      )}
      {editing ? <Compose existing={editing} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}
