// One entry: who wrote it and for whom, the text (markdown), the photos (a
// tap shows one large), the hashtags, likes and comments, and the menu (copy
// link; edit and delete for the author; add as friend, report, block for
// everyone else). An entry several people reported, or one a moderator of the
// space reported, is folded away until someone asks to see it. An entry marked
// 18+ or as an ad (by its writer, by two reports, or by a moderator) is shown
// to people with an account only; a moderator marks entries from the menu.
import { type FormEvent, useState } from 'react';
import { npub } from '../../../shared/account.js';
import { relTime, tErr } from '../../../shared/i18n.js';
import { REPORT_TYPES } from '../../../shared/moderation.js';
import { MARKS } from '../../../shared/social.js';
import { isModerator } from '../../../shared/spaces.js';
import { rememberReturn } from '../../../ui/AccountGate';
import { Icon } from '../../../ui/components';
import { confirmDialog, openMenu } from '../../../ui/dialogs';
import { useBlocks, useIdentity, useKiwi, usePeople, useSpace, useT } from '../../../ui/hooks';
import { spaceLinkQuery } from '../../../ui/spaces';
import { copyText, toast } from '../../../ui/toast';
import { Markdown } from '../../../ui/widgets/Markdown';
import { Modal } from '../../../ui/widgets/Modal';
import { PhotoGrid } from '../../../ui/widgets/PhotoGrid';
import { entryHash } from '../data/feed.js';
import { useAudienceLabel, useFeed, useNameOf, useSocial } from '../state';

const fail = (err: unknown) => toast(tErr(err), 'error');

function ReportDialog({ entry, label, onClose }: { entry: any; label: string; onClose: () => void }) {
  const t = useT();
  const { data } = useFeed();
  const [busy, setBusy] = useState(false);
  // asking for a mark comes first: the commonest report in a space where 18+ and ads are allowed, marked
  const reasons = [...MARKS.filter((m) => m !== label), 'spam', 'illegal', 'impersonation', 'nudity', 'other'];
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const type = String(f.get('type'));
    setBusy(true);
    try {
      await data.report(entry, REPORT_TYPES.includes(type) || MARKS.includes(type) ? type : 'other', String(f.get('text') || ''));
      onClose();
      toast(t(MARKS.includes(type) ? 'fd.reportedMark' : 'fd.reported'), 'success');
    } catch (err) {
      setBusy(false);
      fail(err);
    }
  };
  return (
    <Modal open title={t('fd.reportTitle')} onClose={onClose}>
      <form className="form" id="reportForm" onSubmit={submit}>
        <p className="modal-text">{t('fd.reportText')}</p>
        <label className="field">
          {t('fd.reportReason')}
          <select name="type">
            {reasons.map((x) => (
              <option key={x} value={x}>
                {t(`fd.reason.${x}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          {t('fd.reportNote')}
          <textarea name="text" rows={2} maxLength={500} />
        </label>
        <div className="modal-actions">
          <button type="button" className="btn" data-close onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn-danger" disabled={busy}>
            {t('fd.reportSend')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function EntryCard({
  entry,
  onEdit,
  full = false,
  onTag,
}: {
  entry: any;
  onEdit?: (entry: any) => void;
  full?: boolean;
  onTag?: (tag: string) => void;
}) {
  const t = useT();
  const kiwi = useKiwi();
  const id = useIdentity();
  const people = usePeople();
  const blocks = useBlocks();
  const space = useSpace();
  const social = useSocial();
  const { data } = useFeed();
  const nameOf = useNameOf();
  const audienceLabel = useAudienceLabel();
  const [open, setOpen] = useState(false);
  const [reporting, setReporting] = useState(false);
  const isBlocked = (pk: string) => Boolean(blocks?.isBlocked(pk));
  const mine = entry.pubkey === id.pk;
  const folded = social.collapsed(entry, isBlocked);
  const hidden = folded && !open;
  // marked for adults or as an ad, by the writer (inside the seal), by reports or by a moderator
  const marked: { mark: string; by: string } | null = entry.label ? { mark: entry.label, by: 'author' } : social.marked(entry.address, isBlocked);
  const label = marked?.mark || '';
  // such an entry is for people with an account on this hub
  const locked = Boolean(label) && !mine && !id.accountPk;
  const moderator = isModerator(space, id.pk) && !mine;
  const waiting = moderator ? social.pending(entry.address) : 0;
  const setMark = (mark: string) => data.mark(entry, mark, social.lastAt(entry.address)).then(() => toast(t(`fd.mod.done.${mark}`), 'success'), fail);
  // a moderator marks what its writer did not; the writer's own mark stands
  const modItems =
    moderator && !entry.label
      ? [
          ...MARKS.filter((m) => m !== label).map((m) => ({ label: t(`fd.mod.${m}`), icon: 'tag', run: () => setMark(m) })),
          ...(marked || waiting || folded === 'reports' ? [{ label: t('fd.mod.none'), icon: 'check', run: () => setMark('none') }] : []),
        ]
      : [];
  const signIn = () => {
    rememberReturn(location.href, document.title);
    location.href = `${kiwi.base}settings.html#account`;
  };
  const likes = social.likeCount(entry.address, isBlocked);
  const liked = social.liked(entry.address);
  const comments = social.commentEvents(entry.address, isBlocked).length;
  const name = nameOf(entry.pubkey, entry.name);
  const link = () => `${location.href.split('#')[0]}${entryHash(entry, spaceLinkQuery(kiwi))}`;
  const menu = (el: HTMLElement) =>
    openMenu(el, [
      { label: t('fd.copyLink'), icon: 'link', run: () => copyText(link(), t('fd.link')) },
      ...(mine
        ? [
            { label: t('fd.edit'), icon: 'pencil', run: () => onEdit?.(entry) },
            {
              label: t('fd.delete'),
              icon: 'trash-2',
              danger: true,
              run: async () => {
                if (await confirmDialog({ title: t('fd.deleteConfirm'), message: t('fd.deleteText'), confirm: t('common.delete'), danger: true }))
                  data.remove(entry).then(() => toast(t('fd.deleted'), 'success'), fail);
              },
            },
          ]
        : [
            ...(people?.isFriend(entry.pubkey)
              ? []
              : [
                  {
                    label: t('people.add'),
                    icon: 'user-plus',
                    run: () =>
                      people
                        .request(entry.pubkey)
                        .then((r: string) => toast(t(r === 'friends' ? 'people.friend' : 'people.requested'), 'success'))
                        .catch(fail),
                  },
                ]),
            ...modItems,
            ...(social.reportedByMe(entry.address) ? [] : [{ label: t('fd.report'), icon: 'shield', run: () => setReporting(true) }]),
            { label: t('fd.block'), icon: 'x', danger: true, run: () => blocks.block(entry.pubkey).then(() => toast(t('fd.blocked'), 'success'), fail) },
          ]),
    ]);
  return (
    <article
      className={`entry${mine ? ' mine' : ''}${hidden ? ' folded' : ''}${full ? ' full' : ''}`}
      data-address={entry.address}
      data-audience={entry.audience}
    >
      <header className="entry-head">
        <span className="entry-avatar" aria-hidden="true">
          {(name.replace(/[^\p{L}\p{N}]/gu, '')[0] || '?').toUpperCase()}
        </span>
        <span className="entry-who">
          <a className="entry-author" href={`#/p/${entry.pubkey}`} title={npub(entry.pubkey)}>
            <span className="entry-name">{name}</span>
          </a>
          <span className="entry-meta muted small">
            <a href={entryHash(entry)} className="entry-when">
              {relTime(entry.at)}
            </a>
            {' · '}
            {label ? (
              <>
                <span
                  className={`badge label-${label}`}
                  data-label={label}
                  data-by={marked?.by}
                  title={marked?.by === 'author' ? undefined : t(`fd.markedBy.${marked?.by}`)}
                >
                  {t(`fd.label.${label}`)}
                </span>{' '}
              </>
            ) : null}
            <span className="entry-aud" data-audience={entry.audience}>
              <Icon name={entry.audience === 'space' ? 'users-round' : entry.audience === 'me' ? 'lock' : 'users'} />
              {audienceLabel(entry.audience, space?.name)}
            </span>
          </span>
        </span>
        <button type="button" className="icon-btn" data-act="menu" aria-label={t('fd.more')} onClick={(e) => menu(e.currentTarget)}>
          <Icon name="ellipsis" />
        </button>
      </header>
      {waiting ? (
        <p className="entry-review" data-pending={waiting}>
          <Icon name="shield" />
          <span>{t('fd.review.pending', { n: waiting })}</span>
        </p>
      ) : null}
      {locked ? (
        <div className="entry-folded entry-locked" data-label={label}>
          <Icon name="lock" />
          <span>{t(`fd.locked.${label}`)}</span>
          <button type="button" className="link-btn" data-act="sign-in" onClick={signIn}>
            {t('gate.account.go')}
          </button>
        </div>
      ) : hidden ? (
        <div className="entry-folded">
          <Icon name="eye" />
          <span>{t(folded === 'moderator' ? 'fd.foldedModerator' : 'fd.foldedReports')}</span>
          <button type="button" className="link-btn" data-act="reveal" onClick={() => setOpen(true)}>
            {t('fd.showAnyway')}
          </button>
        </div>
      ) : (
        <>
          {entry.text ? <Markdown source={entry.text} className="md entry-text" /> : null}
          <PhotoGrid media={entry.media} alt={entry.text ? entry.text.slice(0, 80) : t('fd.photoBy', { name })} />
          {entry.tags.length ? (
            <div className="entry-tags">
              {entry.tags.map((tag: string) => (
                <button key={tag} type="button" className="chip" data-tag={tag} onClick={() => onTag?.(tag)}>
                  #{tag}
                </button>
              ))}
            </div>
          ) : null}
        </>
      )}
      <footer className="entry-foot">
        <button
          type="button"
          className={`btn btn-sm btn-ghost like${liked ? ' on' : ''}`}
          data-act="like"
          aria-pressed={liked}
          aria-label={liked ? t('fd.unlike') : t('fd.like')}
          onClick={() => data.like(entry, !liked).catch(fail)}
        >
          <Icon name="heart" />
          <span className="like-count">{likes}</span>
        </button>
        {full ? (
          <span className="btn btn-sm btn-ghost comment-count" title={t('fd.comments', { n: comments })}>
            <Icon name="message-square" />
            <span>{comments}</span>
          </span>
        ) : (
          <a className="btn btn-sm btn-ghost comment-count" data-act="comments" href={entryHash(entry)} aria-label={t('fd.comments', { n: comments })}>
            <Icon name="message-square" />
            <span>{comments}</span>
          </a>
        )}
      </footer>
      {reporting ? <ReportDialog entry={entry} label={label} onClose={() => setReporting(false)} /> : null}
    </article>
  );
}
