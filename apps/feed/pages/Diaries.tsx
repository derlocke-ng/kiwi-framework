// Diaries (0.32): a diary is a series of entries, a grow from seed to harvest.
// What this file holds: the index of the diaries this device can read (every
// screen asks it for a diary's title), a diary's card, the Diaries tab (a
// collection: the diaries you follow pinned to its top, your own choice,
// kept in the app's settings), the form that begins or edits a diary, and the
// diary's page: its cover, what it is about, its entries in the order they
// were written, and for its writer the way to add the next one, finish it,
// pin it to their profile, delete it. Everyone else reports a diary or blocks
// its writer, and a moderator of the space marks it, as with an entry; a
// diary reported enough is folded away like one.
import { createContext, type FormEvent, type ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { npub } from '../../../shared/account.js';
import { KINDS } from '../../../shared/events.js';
import { relTime, tErr } from '../../../shared/i18n.js';
import { MARKS } from '../../../shared/social.js';
import { isModerator } from '../../../shared/spaces.js';
import { Icon } from '../../../ui/components';
import { confirmDialog, openMenu } from '../../../ui/dialogs';
import { useBlocks, useIdentity, useKiwi, useSpace, useT } from '../../../ui/hooks';
import { goBack } from '../../../ui/route';
import { spaceLinkQuery } from '../../../ui/spaces';
import { copyText, toast } from '../../../ui/toast';
import { useEvents } from '../../../ui/useEvents';
import { Collection } from '../../../ui/widgets/Collection';
import { ImageUpload } from '../../../ui/widgets/ImageUpload';
import { Markdown } from '../../../ui/widgets/Markdown';
import { MediaImage } from '../../../ui/widgets/MediaImage';
import { Modal } from '../../../ui/widgets/Modal';
import { diaryEntries, diaryHash, LABELS, LIMITS } from '../data/feed.js';
import { useAudienceChoices, useAudienceLabel, useFeed, useNameOf, useOpened, usePrefs, useSocial } from '../state';
import { Compose, defaultAudience } from './Compose';
import { EntryCard, ReportDialog } from './EntryCard';
import { useEntries } from './FeedView';

const fail = (err: unknown) => toast(tErr(err), 'error');
/** The app's settings key for the diaries this person follows, pinned to the top of the Diaries tab. */
const FOLLOWED = 'pinnedDiaries';

interface DiaryIndex {
  list: any[];
  /** A diary by its writer and d, when this device can read it. */
  get: (pubkey: string, d: string) => any | null;
  loading: boolean;
}

const DiaryContext = createContext<DiaryIndex>({ list: [], get: () => null, loading: true });

/** Every diary of this feed that this device can read, newest added to first; their marks followed. */
export function DiaryProvider({ children }: { children: ReactNode }) {
  const { data, social } = useFeed();
  const space = useSpace();
  const filters = useMemo(() => [{ kinds: [KINDS.FEED_DIARY], ...(space ? { '#a': [space.address] } : {}) }], [space]);
  const feed = useEvents({ filters, pageSize: 200, accept: (ev) => data.inSpace(ev) });
  const opened = useOpened(feed.events, (ev) => data.openEntry(ev));
  const value = useMemo(() => {
    const list = feed.events
      .map((ev) => opened.get(ev.id))
      .filter((x: any) => x && !x.deleted)
      .sort((a: any, b: any) => b.last - a.last);
    const byKey = new Map(list.map((x: any) => [`${x.pubkey}:${x.d}`, x]));
    return { list, get: (pubkey: string, d: string) => byKey.get(`${pubkey}:${d}`) || null, loading: feed.loading };
  }, [feed.events, opened, feed.loading]);
  useEffect(() => {
    social.watch(value.list.map((x: any) => x.address));
  }, [value.list, social]);
  return <DiaryContext.Provider value={value}>{children}</DiaryContext.Provider>;
}

export const useDiaries = () => useContext(DiaryContext);

/**
 * Whether a diary shows to this person: one marked 18+ or as an ad is for people with an account; one reported by a
 * moderator or by several people is folded away (`folded`: why), as an entry is.
 */
function useShown(item: any) {
  const id = useIdentity();
  const social = useSocial();
  const blocks = useBlocks();
  const isBlocked = (pk: string) => Boolean(blocks?.isBlocked(pk));
  const mine = item.pubkey === id.pk;
  const marked = item.label ? { mark: item.label, by: 'author' } : social.marked(item.address, isBlocked);
  const label: string = marked?.mark || '';
  const locked = Boolean(label) && !mine && !id.accountPk;
  const unread = !item.label && !mine && !id.accountPk && !social.isRead(item.address); // its marks not known yet
  const folded: string | null = social.collapsed(item, isBlocked);
  return { label, marked, locked, unread, folded };
}

const foldedText = (folded: string | null) => (folded === 'moderator' ? 'fd.foldedModerator' : 'fd.foldedReports');

/** A diary as a card: its cover, title, writer, for whom, how far along. */
export function DiaryCard({ diary }: { diary: any }) {
  const t = useT();
  const nameOf = useNameOf();
  const audienceLabel = useAudienceLabel();
  const space = useSpace();
  const { label, locked, unread, folded } = useShown(diary);
  const hidden = locked || unread || Boolean(folded);
  return (
    <a
      className={`diary-card${diary.done ? ' done' : ''}${folded ? ' folded' : ''}`}
      href={diaryHash(diary)}
      data-diary={diary.address}
      data-title={diary.title}
      data-label={label || undefined}
    >
      <span className="diary-cover">
        {diary.cover && !hidden ? <MediaImage media={diary.cover} small alt="" /> : <Icon name={hidden ? 'lock' : 'notebook'} />}
      </span>
      <span className="diary-main">
        <b className="diary-title">{hidden ? t(locked ? `fd.locked.${label}` : unread ? 'common.loading' : foldedText(folded)) : diary.title}</b>
        <span className="muted small">
          {nameOf(diary.pubkey, diary.name)} · {audienceLabel(diary.audience, space?.name)}
        </span>
        <span className="muted small">
          {diary.done ? (
            <span className="badge" data-done>
              {t('fd.diary.finished')}
            </span>
          ) : null}{' '}
          {label && !hidden ? <span className={`badge label-${label}`}>{t(`fd.label.${label}`)}</span> : null}{' '}
          {t('fd.diary.updated', { when: relTime(diary.last) })}
        </span>
      </span>
    </a>
  );
}

/** The Diaries tab: every diary this device can read; the ones this person follows pinned to the top. */
export function DiaryList({ query = '' }: { query?: string }) {
  const t = useT();
  const prefs = usePrefs();
  const { list, loading } = useDiaries();
  const followed: string[] = prefs.get(FOLLOWED, []) || [];
  const q = query.trim().toLowerCase();
  const items = q ? list.filter((x: any) => `${x.title} ${x.about} ${x.name}`.toLowerCase().includes(q)) : list;
  return (
    <div className="diary-list" id="diaryList">
      <Collection
        items={items}
        keyOf={(x: any) => x.address}
        renderItem={(x: any) => <DiaryCard diary={x} />}
        isPinned={(x: any) => followed.includes(x.address)}
        onPin={(x: any, on: boolean) =>
          prefs
            .set({ [FOLLOWED]: on ? [x.address, ...followed.filter((a) => a !== x.address)].slice(0, 100) : followed.filter((a) => a !== x.address) })
            .catch(fail)
        }
        compare={(a: any, b: any) => b.last - a.last}
        empty={<p className="empty">{loading ? t('common.loading') : q ? t('fd.diaries.noMatch') : t('fd.diaries.empty')}</p>}
      />
    </div>
  );
}

/** Begin a diary, or edit one: its title, what it is about, a cover, whom it is for (only when it begins), a label. */
export function DiaryForm({ existing = null, onClose, onSaved }: { existing?: any; onClose: () => void; onSaved?: (d: string) => void }) {
  const t = useT();
  const { data } = useFeed();
  const prefs = usePrefs();
  const space = useSpace();
  const choices = useAudienceChoices(Boolean(space));
  const audienceLabel = useAudienceLabel();
  const [title, setTitle] = useState<string>(existing?.title || '');
  const [about, setAbout] = useState<string>(existing?.about || '');
  const [cover, setCover] = useState<any>(existing?.cover || null);
  const [audience, setAudience] = useState<string>(existing?.audience || defaultAudience(prefs, choices));
  const [label, setLabel] = useState<string>(existing?.label || '');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!title.trim()) return toast(t('fd.error.noTitle'), 'error');
    setBusy(true);
    try {
      const ev = await data.saveDiary({ ...(existing || {}), title, about, cover, audience, label });
      onSaved?.(ev.tags.find((x: string[]) => x[0] === 'd')?.[1] || '');
      onClose();
      toast(t(existing ? 'fd.diary.saved' : 'fd.diary.created'), 'success');
    } catch (err) {
      setBusy(false);
      fail(err);
    }
  };
  return (
    <Modal open wide id="diaryForm" title={existing ? t('fd.diary.editTitle') : t('fd.diary.newTitle')} onClose={onClose}>
      <form className="form" id="diaryFormBody" onSubmit={submit}>
        <label className="field">
          <span>{t('fd.diary.title')}</span>
          <input
            name="title"
            maxLength={LIMITS.title}
            value={title}
            placeholder={t('fd.diary.titlePlaceholder')}
            data-autofocus
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="field">
          <span>{t('fd.diary.about')}</span>
          <textarea
            name="about"
            rows={3}
            maxLength={LIMITS.about}
            value={about}
            placeholder={t('fd.diary.aboutPlaceholder')}
            onChange={(e) => setAbout(e.target.value)}
          />
        </label>
        <div className="field">
          <span>{t('fd.diary.cover')}</span>
          {cover ? (
            <div className="diary-cover-edit" id="diaryCover">
              <MediaImage media={cover} small alt={t('fd.diary.cover')} />
              <button type="button" className="icon-btn" data-act="cover-remove" aria-label={t('fd.diary.removeCover')} onClick={() => setCover(null)}>
                <Icon name="x" />
              </button>
            </div>
          ) : (
            <ImageUpload allowPlain={false} label={t('fd.diary.addCover')} disabled={busy} onUpload={(m) => setCover(m)} />
          )}
        </div>
        {existing ? (
          <p className="hint" id="diaryAudience">
            <Icon name="lock" /> {t('fd.diary.audienceFixed', { audience: audienceLabel(existing.audience, space?.name) })}
          </p>
        ) : (
          <label className="field">
            <span>{t('fd.audience')}</span>
            <select name="audience" value={audience} onChange={(e) => setAudience(e.target.value)}>
              {choices.map((c) => (
                <option key={c} value={c}>
                  {audienceLabel(c, space?.name)}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="field">
          <span>{t('fd.label')}</span>
          <select name="label" value={label} onChange={(e) => setLabel(e.target.value)}>
            <option value="">{t('fd.label.none')}</option>
            {LABELS.map((l) => (
              <option key={l} value={l}>
                {t(`fd.label.${l}`)}
              </option>
            ))}
          </select>
        </label>
        <div className="modal-actions">
          <button type="button" className="btn" data-close onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {existing ? t('fd.diary.save') : t('fd.diary.create')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** One diary: its cover and what it is about, then its entries from the first; its writer adds, finishes, pins, deletes. */
export function DiaryPage({ pk, d }: { pk: string; d: string }) {
  const t = useT();
  const kiwi = useKiwi();
  const id = useIdentity();
  const space = useSpace();
  const { data } = useFeed();
  const social = useSocial();
  const blocks = useBlocks();
  const nameOf = useNameOf();
  const audienceLabel = useAudienceLabel();
  const { get, loading } = useDiaries();
  const diary = get(pk, d);
  const [editing, setEditing] = useState(false);
  const [composing, setComposing] = useState<{ existing: any } | null>(null);
  const [reporting, setReporting] = useState(false);
  const [open, setOpen] = useState(false);
  const list = useEntries([{ kinds: [KINDS.FEED_ENTRY], authors: [pk], ...(space ? { '#a': [space.address] } : {}) }]);
  // a diary is read from its beginning: every page of its writer's entries is asked for, not only the newest
  useEffect(() => {
    if (list.hasMore && !list.loading) list.loadMore();
  }, [list.hasMore, list.loading, list.loadMore]);
  const shown = useShown(diary || { pubkey: pk, address: `${KINDS.FEED_DIARY}:${pk}:${d}` });
  if (!diary)
    return (
      <p className="empty" id="notForYou">
        {loading ? t('common.loading') : t('fd.notForYou')}
      </p>
    );
  const mine = diary.pubkey === id.pk;
  const entries = diaryEntries(diary, list.entries);
  const folded = Boolean(shown.folded) && !open;
  const hidden = shown.locked || shown.unread || folded;
  // a moderator of the space marks what its writer did not, or finds it fine, as on an entry
  const moderator = isModerator(space, id.pk) && !mine;
  const setMark = (mark: string) => data.mark(diary, mark, social.lastAt(diary.address)).then(() => toast(t(`fd.mod.done.${mark}`), 'success'), fail);
  const modItems =
    moderator && !diary.label
      ? [
          ...MARKS.filter((m) => m !== shown.label).map((m) => ({ label: t(`fd.mod.${m}`), icon: 'tag', act: `mark-${m}`, run: () => setMark(m) })),
          ...(shown.marked || social.pending(diary.address) || shown.folded === 'reports'
            ? [{ label: t('fd.mod.none'), icon: 'check', act: 'mark-none', run: () => setMark('none') }]
            : []),
        ]
      : [];
  const link = () => `${location.href.split('#')[0]}${diaryHash(diary, spaceLinkQuery(kiwi))}`;
  const menu = (el: HTMLElement) =>
    openMenu(el, [
      { label: t('fd.copyLink'), icon: 'link', act: 'copy-link', run: () => copyText(link(), t('fd.link')) },
      ...(mine
        ? [
            { label: t('fd.diary.edit'), icon: 'pencil', act: 'edit-diary', run: () => setEditing(true) },
            {
              label: diary.done ? t('fd.diary.reopen') : t('fd.diary.finish'),
              icon: diary.done ? 'repeat' : 'check',
              act: diary.done ? 'reopen' : 'finish',
              run: () => data.saveDiary({ ...diary, done: !diary.done }).catch(fail),
            },
            {
              label: diary.pinned ? t('fd.unpinProfile') : t('fd.pinProfile'),
              icon: diary.pinned ? 'pin-off' : 'pin',
              act: diary.pinned ? 'unpin-profile' : 'pin-profile',
              run: () => data.pin(diary, !diary.pinned).then(() => toast(t(diary.pinned ? 'fd.unpinnedDone' : 'fd.pinnedDone'), 'success'), fail),
            },
            '-' as const,
            {
              label: t('fd.diary.delete'),
              icon: 'trash-2',
              danger: true,
              act: 'delete-diary',
              run: async () => {
                if (await confirmDialog({ title: t('fd.diary.deleteConfirm'), message: t('fd.diary.deleteText'), confirm: t('common.delete'), danger: true }))
                  data.remove(diary).then(() => {
                    toast(t('fd.diary.deleted'), 'success');
                    goBack('#/');
                  }, fail);
              },
            },
          ]
        : [
            ...modItems,
            ...(social.reportedByMe(diary.address) ? [] : [{ label: t('fd.report'), icon: 'shield', act: 'report', run: () => setReporting(true) }]),
            {
              label: t('fd.block'),
              icon: 'x',
              danger: true,
              act: 'block',
              run: () =>
                blocks.block(diary.pubkey).then(() => {
                  toast(t('fd.blocked'), 'success');
                  goBack('#/');
                }, fail),
            },
          ]),
    ]);
  return (
    <div className="diary-page" id="diary" data-diary={diary.address}>
      <section className={`diary-head card${diary.done ? ' done' : ''}`}>
        {diary.cover && !hidden ? <MediaImage media={diary.cover} alt={diary.title} className="diary-hero" /> : null}
        <div className="diary-title-row">
          <h2 id="diaryTitle">
            {hidden ? (shown.locked ? t(`fd.locked.${shown.label}`) : shown.unread ? t('common.loading') : t('fd.diary.panel')) : diary.title}
          </h2>
          <button type="button" className="icon-btn" data-act="diary-menu" aria-label={t('common.more')} onClick={(e) => menu(e.currentTarget)}>
            <Icon name="ellipsis" />
          </button>
        </div>
        <p className="muted small">
          <a href={`#/p/${diary.pubkey}`} title={npub(diary.pubkey)}>
            {nameOf(diary.pubkey, diary.name)}
          </a>
          {' · '}
          {audienceLabel(diary.audience, space?.name)}
          {' · '}
          {t('fd.diary.entries', { n: entries.length })}
          {diary.done ? (
            <>
              {' · '}
              <span className="badge" data-done>
                {t('fd.diary.finished')}
              </span>
            </>
          ) : null}
        </p>
        {folded && !shown.locked && !shown.unread ? (
          <div className="entry-folded">
            <Icon name="eye" />
            <span>{t(foldedText(shown.folded))}</span>
            <button type="button" className="link-btn" data-act="reveal" onClick={() => setOpen(true)}>
              {t('fd.showAnyway')}
            </button>
          </div>
        ) : null}
        {shown.label && !hidden ? (
          <p>
            <span className={`badge label-${shown.label}`} data-by={shown.marked?.by}>
              {t(`fd.label.${shown.label}`)}
            </span>
          </p>
        ) : null}
        {diary.about && !hidden ? <Markdown source={diary.about} className="md diary-about" /> : null}
        {mine && !diary.done ? (
          <div className="form-actions">
            <button type="button" className="btn btn-primary btn-sm" id="addToDiary" onClick={() => setComposing({ existing: null })}>
              <Icon name="plus" />
              <span>{t('fd.diary.addEntry')}</span>
            </button>
          </div>
        ) : null}
      </section>
      {hidden ? null : entries.length ? (
        <ol className="diary-entries" id="diaryEntries">
          {entries.map((e: any) => (
            <li key={e.address}>
              <EntryCard entry={e} inDiary onEdit={(entry) => setComposing({ existing: entry })} />
            </li>
          ))}
        </ol>
      ) : (
        <p className="empty">{list.loading || list.opening ? t('common.loading') : t('fd.diary.empty')}</p>
      )}
      {editing ? <DiaryForm existing={diary} onClose={() => setEditing(false)} /> : null}
      {composing ? <Compose existing={composing.existing} diary={diary} onClose={() => setComposing(null)} /> : null}
      {reporting ? <ReportDialog entry={diary} label={shown.label} onClose={() => setReporting(false)} /> : null}
    </div>
  );
}
