// One entry: who wrote it and for whom, the text (markdown), the photos (a
// tap shows one large), the hashtags, likes and comments, and the menu (copy
// link; edit and delete for the author; add as friend, report, block for
// everyone else). An entry several people reported, or one a moderator of the
// space reported, is folded away until someone asks to see it.
import { type FormEvent, useState } from 'react';
import { npub } from '../../../shared/account.js';
import { relTime, tErr } from '../../../shared/i18n.js';
import { REPORT_TYPES } from '../../../shared/moderation.js';
import { Icon } from '../../../ui/components';
import { confirmDialog, openMenu } from '../../../ui/dialogs';
import { useBlocks, useIdentity, useKiwi, usePeople, useSpace, useT } from '../../../ui/hooks';
import { spaceLinkQuery } from '../../../ui/spaces';
import { copyText, toast } from '../../../ui/toast';
import { Markdown } from '../../../ui/widgets/Markdown';
import { MediaImage } from '../../../ui/widgets/MediaImage';
import { Modal } from '../../../ui/widgets/Modal';
import { entryHash } from '../data/feed.js';
import { useAudienceLabel, useFeed, useNameOf, useSocial } from '../state';

const fail = (err: unknown) => toast(tErr(err), 'error');

function ReportDialog({ entry, onClose }: { entry: any; onClose: () => void }) {
  const t = useT();
  const { data } = useFeed();
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const type = String(f.get('type'));
    setBusy(true);
    try {
      await data.report(entry, REPORT_TYPES.includes(type) ? type : 'other', String(f.get('text') || ''));
      onClose();
      toast(t('fd.reported'), 'success');
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
            {['spam', 'illegal', 'impersonation', 'nudity', 'other'].map((x) => (
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

/** The photos of an entry: a grid of thumbnails; a tap shows one large. */
function Photos({ media, alt }: { media: any[]; alt: string }) {
  const t = useT();
  const [shown, setShown] = useState<number | null>(null);
  if (!media.length) return null;
  return (
    <>
      <div className={`entry-photos n${Math.min(media.length, 4)}`}>
        {media.map((m, i) => (
          <button key={m.sha256} type="button" className="entry-photo" data-photo={i} aria-label={t('fd.photo', { n: i + 1 })} onClick={() => setShown(i)}>
            <MediaImage media={m} small alt={alt} />
          </button>
        ))}
      </div>
      {shown !== null && media[shown] ? (
        <Modal open wide title={t('fd.photo', { n: shown + 1 })} onClose={() => setShown(null)} id="photoView">
          <MediaImage media={media[shown]} alt={alt} className="entry-photo-large" />
          {media.length > 1 ? (
            <div className="modal-actions">
              <button type="button" className="btn btn-sm" disabled={shown === 0} onClick={() => setShown(shown - 1)}>
                {t('fd.prevPhoto')}
              </button>
              <button type="button" className="btn btn-sm" disabled={shown === media.length - 1} onClick={() => setShown(shown + 1)}>
                {t('fd.nextPhoto')}
              </button>
            </div>
          ) : null}
        </Modal>
      ) : null}
    </>
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
        <a className="entry-author" href={`#/p/${entry.pubkey}`} title={npub(entry.pubkey)}>
          <span className="entry-avatar" aria-hidden="true">
            {(name.replace(/[^\p{L}\p{N}]/gu, '')[0] || '?').toUpperCase()}
          </span>
          <span className="entry-name">{name}</span>
        </a>
        <span className="entry-meta muted small">
          <a href={entryHash(entry)} className="entry-when">
            {relTime(entry.at)}
          </a>
          {' · '}
          <span className="entry-aud" data-audience={entry.audience}>
            <Icon name={entry.audience === 'space' ? 'users-round' : entry.audience === 'me' ? 'lock' : 'users'} />
            {audienceLabel(entry.audience, space?.name)}
          </span>
        </span>
        <span className="spacer" />
        <button type="button" className="icon-btn" data-act="menu" aria-label={t('fd.more')} onClick={(e) => menu(e.currentTarget)}>
          <Icon name="ellipsis" />
        </button>
      </header>
      {hidden ? (
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
          <Photos media={entry.media} alt={entry.text ? entry.text.slice(0, 80) : t('fd.photoBy', { name })} />
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
      {reporting ? <ReportDialog entry={entry} onClose={() => setReporting(false)} /> : null}
    </article>
  );
}
