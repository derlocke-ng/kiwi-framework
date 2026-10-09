// The board: search, filters (all, hiring, available, saved, friends), skill
// chips, and the live notes, best first; collapsed ones last. Posting mines
// proof of work in the shared workers and can be cancelled by closing.
import { type FormEvent, useRef, useState } from 'react';
import { npub } from '../../../shared/account.js';
import { relTime, tErr } from '../../../shared/i18n.js';
import { REPORT_TYPES } from '../../../shared/moderation.js';
import { randomId } from '../../../shared/util.js';
import { Icon } from '../../../ui/components';
import { confirmDialog, openMenu } from '../../../ui/dialogs';
import { useBlocks, useIdentity, usePeople, useT } from '../../../ui/hooks';
import { toast } from '../../../ui/toast';
import { Modal } from '../../../ui/widgets/Modal';
import { DURATIONS, LIMITS, type Notices } from '../data/notices.js';
import { defaults, usePrefs } from '../state';

type Post = any;
const fail = (err: unknown) => toast(tErr(err), 'error');
const FILTERS = ['all', 'hiring', 'available', 'saved', 'friends'] as const;

function ComposeDialog({ notices, existing, onClose }: { notices: Notices; existing: Post | null; onClose: () => void }) {
  const t = useT();
  const prefs = usePrefs();
  const dflt = defaults(prefs);
  const d = existing?.data || { type: dflt.type, title: '', text: '', tags: [], rate: '', contact: dflt.contact };
  const [busy, setBusy] = useState(false);
  const [seconds, setSeconds] = useState<number | null>(null);
  const cancel = useRef(new AbortController()); // closing the dialog stops the mining
  const close = () => {
    cancel.current.abort();
    onClose();
  };
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const get = (k: string) => String(f.get(k) || '').trim();
    const data = {
      type: get('type') === 'available' ? 'available' : 'hiring',
      title: get('title'),
      text: get('text'),
      tags: get('tags')
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean)
        .slice(0, LIMITS.tags),
      rate: get('rate'),
      contact: get('contact'),
    };
    if (!data.title) return toast(t('db.compose.titleRequired'), 'error');
    if (!data.text) return toast(t('db.compose.textRequired'), 'error');
    if (!data.contact) return toast(t('db.compose.contactRequired'), 'error');
    setBusy(true);
    setSeconds(0);
    try {
      await notices.publishPost(data, {
        d: existing ? existing.address.split(':')[2] : randomId(),
        days: Number(f.get('days')),
        signal: cancel.current.signal,
        onProgress: (s: number) => setSeconds(s),
      });
      onClose();
      toast(t('db.compose.published'), 'success');
    } catch (err: any) {
      if (err?.code === 'pow.cancelled') return;
      setBusy(false);
      setSeconds(null);
      toast(tErr(err), 'error', 6000);
    }
  };
  return (
    <Modal open wide title={existing ? t('db.compose.editTitle') : t('db.compose.title')} onClose={close}>
      <form className="form compose" id="compose" onSubmit={submit}>
        <div className="seg" role="radiogroup" aria-label={t('db.compose.iam')}>
          {(['hiring', 'available'] as const).map((type) => (
            <label key={type}>
              <input type="radio" name="type" value={type} defaultChecked={d.type === type} />
              <span>{t(`db.compose.${type}`)}</span>
            </label>
          ))}
        </div>
        <label className="field">
          {t('db.compose.titleLabel')}
          <input name="title" required maxLength={LIMITS.title} defaultValue={d.title} placeholder={t('db.compose.titlePlaceholder')} data-autofocus />
        </label>
        <label className="field">
          {t('db.compose.text')}
          <textarea name="text" rows={3} maxLength={LIMITS.text} defaultValue={d.text} placeholder={t('db.compose.textPlaceholder')} />
        </label>
        <label className="field">
          {t('db.compose.tags')}
          <input name="tags" maxLength={200} defaultValue={d.tags.join(', ')} placeholder={t('db.compose.tagsPlaceholder')} />
        </label>
        <div className="row">
          <label className="field">
            {t('db.compose.rate')}
            <input name="rate" maxLength={LIMITS.rate} defaultValue={d.rate} placeholder={t('db.compose.ratePlaceholder')} />
          </label>
          <label className="field">
            {t('db.compose.duration')}
            <select name="days" defaultValue={String(dflt.days)}>
              {DURATIONS.map((n) => (
                <option key={n} value={n}>
                  {t(`db.duration.${n}`)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="field">
          {t('db.compose.contact')}
          <input name="contact" required maxLength={LIMITS.contact} defaultValue={d.contact} placeholder={t('db.compose.contactPlaceholder')} />
        </label>
        <p className="hint">{t('db.compose.contactHint')}</p>
        {seconds !== null ? (
          <p className="pow" id="pow">
            <span className="spinner" />
            <span id="powText">{t('db.compose.pow', { s: seconds })}</span>
          </p>
        ) : null}
        <div className="modal-actions">
          <button type="button" className="btn" data-close onClick={close}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {existing ? t('db.compose.save') : t('db.compose.submit')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ContactDialog({ post, onClose }: { post: Post; onClose: () => void }) {
  const t = useT();
  const copy = () =>
    navigator.clipboard
      .writeText(post.data.contact)
      .then(() => toast(t('common.copied', { what: t('db.contact') }), 'success'))
      .catch(() => toast(t('common.copyFailed'), 'error'));
  return (
    <Modal open title={t('db.contactTitle', { title: post.data.title })} onClose={onClose}>
      <div className="contact">{post.data.contact}</div>
      <p className="modal-text">{t('db.contactNote')}</p>
      <div className="modal-actions">
        <button type="button" className="btn" data-act="copy" onClick={copy}>
          <Icon name="copy" />
          <span>{t('common.copy')}</span>
        </button>
        <button type="button" className="btn btn-primary" data-close onClick={onClose}>
          {t('common.close')}
        </button>
      </div>
    </Modal>
  );
}

function ReportDialog({ notices, post, onClose }: { notices: Notices; post: Post; onClose: () => void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const type = String(f.get('type'));
    setBusy(true);
    try {
      await notices.report(post, REPORT_TYPES.includes(type) ? type : 'other', String(f.get('text') || ''));
      onClose();
      toast(t('db.reported'), 'success');
    } catch (err) {
      setBusy(false);
      fail(err);
    }
  };
  return (
    <Modal open title={t('db.reportTitle')} onClose={onClose}>
      <form className="form" id="reportForm" onSubmit={submit}>
        <p className="modal-text">{t('db.reportText')}</p>
        <label className="field">
          {t('db.reportReason')}
          <select name="type">
            {['spam', 'illegal', 'impersonation', 'other'].map((x) => (
              <option key={x} value={x}>
                {t(`db.reason.${x}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          {t('db.reportNote')}
          <textarea name="text" rows={2} maxLength={500} />
        </label>
        <div className="modal-actions">
          <button type="button" className="btn" data-close onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn-danger" disabled={busy}>
            {t('db.reportSend')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function NoteCard({
  notices,
  post,
  revealed,
  onReveal,
  onMenu,
  onContact,
}: {
  notices: Notices;
  post: Post;
  revealed: boolean;
  onReveal: () => void;
  onMenu: (el: HTMLElement) => void;
  onContact: () => void;
}) {
  const t = useT();
  const id = useIdentity();
  const people = usePeople();
  const prefs = usePrefs();
  const mine = post.pubkey === id.pk;
  const my = notices.myVote(post.address);
  const saved = new Set(prefs.get('saved', []) || []).has(post.address);
  const collapsed = post.collapsed && !revealed && !defaults(prefs).showCollapsed;
  const reason = ({ cap: 'db.collapsedCap', reports: 'db.collapsedReports', score: 'db.collapsedScore' } as Record<string, string>)[post.collapsed];
  const vote = (v: number) => notices.vote(post, v).catch(fail);
  const toggleSave = () => {
    const list = new Set<string>(prefs.get('saved', []) || []);
    if (list.has(post.address)) list.delete(post.address);
    else list.add(post.address);
    prefs.set({ saved: [...list] }).catch(fail);
  };
  return (
    <article className={`note ${post.data.type}${mine ? ' mine' : ''}${collapsed ? ' collapsed' : ''}`} data-a={post.address}>
      {post.collapsed ? (
        <div className="note-collapsed">
          <Icon name="eye" />
          <span>{t(reason)}</span>
          {collapsed ? (
            <button type="button" className="link-btn" data-act="reveal" onClick={onReveal}>
              {t('db.showAnyway')}
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="note-head">
        <span className="note-type">{t(`db.type.${post.data.type}`)}</span>
        <span className="spacer" />
        {post.data.rate ? <span className="muted small">{post.data.rate}</span> : null}
        <button type="button" className="icon-btn" data-act="menu" aria-label={t('db.more')} onClick={(e) => onMenu(e.currentTarget)}>
          <Icon name="ellipsis" />
        </button>
      </div>
      <h3>{post.data.title}</h3>
      {post.data.text ? <p>{post.data.text}</p> : null}
      {post.data.tags.length ? (
        <div className="note-tags">
          {post.data.tags.map((x: string) => (
            <button key={x} type="button" className="chip" data-tag={x.toLowerCase()}>
              {x}
            </button>
          ))}
        </div>
      ) : null}
      <div className="note-meta">
        <span>{t('db.posted', { when: relTime(post.created_at * 1000) })}</span>
        <span>{t('db.expires', { when: relTime(post.expires * 1000) })}</span>
        <span>
          {t('db.by')} <code title={npub(post.pubkey)}>{mine ? t('db.you') : people?.nameOf(post.pubkey)}</code>
        </span>
        {!mine && people?.isFriend(post.pubkey) ? (
          <span className="friend-tag">
            <Icon name="user-check" />
            {t('people.friend')}
          </span>
        ) : null}
      </div>
      <div className="note-foot">
        <span className="votes">
          <button
            type="button"
            data-act="up"
            className={my > 0 ? 'on' : ''}
            disabled={mine}
            title={mine ? t('db.ownVote') : undefined}
            aria-label={mine ? undefined : t('db.up')}
            onClick={() => vote(1)}
          >
            ▲
          </button>
          <span className="score">
            {post.score > 0 ? '+' : ''}
            {post.score}
          </span>
          <button
            type="button"
            data-act="down"
            className={my < 0 ? 'on' : ''}
            disabled={mine}
            aria-label={mine ? undefined : t('db.down')}
            onClick={() => vote(-1)}
          >
            ▼
          </button>
        </span>
        <button type="button" className={`btn btn-sm ${saved ? 'btn-primary' : 'btn-ghost'}`} data-act="save" onClick={toggleSave}>
          <Icon name={saved ? 'pin' : 'pin-off'} />
          <span>{saved ? t('db.unsave') : t('db.save')}</span>
        </button>
        <span className="spacer" />
        <button type="button" className="btn btn-sm" data-act="contact" onClick={onContact}>
          <Icon name="user" />
          <span>{t('db.contact')}</span>
        </button>
      </div>
    </article>
  );
}

export function BoardView({ notices }: { notices: Notices }) {
  const t = useT();
  const id = useIdentity();
  const blocks = useBlocks();
  const people = usePeople();
  const prefs = usePrefs();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('all');
  const [query, setQuery] = useState('');
  const [tags, setTags] = useState<Set<string>>(new Set());
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [compose, setCompose] = useState<{ existing: Post | null } | null>(null);
  const [contact, setContact] = useState<Post | null>(null);
  const [reporting, setReporting] = useState<Post | null>(null);

  const isBlocked = (pk: string) => Boolean(blocks?.isBlocked(pk));
  const all = notices.visible(isBlocked);
  const saved = new Set(prefs.get('saved', []) || []);
  const q = query.trim().toLowerCase();
  const items = all
    .filter((p: Post) => {
      if (filter === 'saved') return saved.has(p.address);
      if (filter === 'friends') return Boolean(people?.isFriend(p.pubkey));
      if (filter !== 'all' && p.data.type !== filter) return false;
      if (q && !`${p.data.title} ${p.data.text} ${p.data.tags.join(' ')} ${p.data.rate}`.toLowerCase().includes(q)) return false;
      for (const tf of tags) if (!p.data.tags.some((x: string) => x.toLowerCase() === tf)) return false;
      return true;
    })
    .sort((a: Post, b: Post) => (a.collapsed ? 1 : 0) - (b.collapsed ? 1 : 0) || b.score - a.score || b.created_at - a.created_at);
  const tagCounts = new Map<string, number>();
  for (const p of all) for (const x of p.data.tags) tagCounts.set(x.toLowerCase(), (tagCounts.get(x.toLowerCase()) || 0) + 1);
  const topTags = [...tagCounts].sort((a, b) => b[1] - a[1]).slice(0, 14);
  const mineCount = all.filter((p: Post) => p.pubkey === id.pk).length;

  const toggleTag = (tag: string) =>
    setTags((cur) => {
      const next = new Set(cur);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  const post = () => {
    if (mineCount >= LIMITS.perKey) return toast(t('db.limit'), 'error', 5000);
    setCompose({ existing: null });
  };
  const menu = (el: HTMLElement, p: Post) => {
    const mine = p.pubkey === id.pk;
    openMenu(
      el,
      mine
        ? [
            { label: t('db.edit'), icon: 'pencil', run: () => setCompose({ existing: p }) },
            {
              label: t('db.delete'),
              icon: 'trash-2',
              danger: true,
              run: async () => {
                if (await confirmDialog({ title: t('db.deleteConfirm'), message: '', confirm: t('common.delete'), danger: true }))
                  notices.deletePost(p).catch(fail);
              },
            },
          ]
        : [
            ...(people?.isFriend(p.pubkey)
              ? []
              : [
                  {
                    label: t('people.add'),
                    icon: 'user-plus',
                    run: () =>
                      people
                        .request(p.pubkey)
                        .then((r: string) => toast(t(r === 'friends' ? 'people.friend' : 'people.requested'), 'success'))
                        .catch(fail),
                  },
                ]),
            { label: t('db.report'), icon: 'shield', run: () => setReporting(p) },
            { label: t('db.block'), icon: 'x', danger: true, run: () => blocks.block(p.pubkey).then(() => toast(t('db.blocked'), 'success'), fail) },
          ],
    );
  };

  return (
    <div
      onClick={(e) => {
        const chip = (e.target as HTMLElement).closest<HTMLElement>('[data-tag]');
        if (chip?.dataset.tag) toggleTag(chip.dataset.tag);
      }}
    >
      <div className="toolbar">
        <input
          className="search"
          id="search"
          type="search"
          placeholder={t('db.search')}
          aria-label={t('db.search')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="seg" role="radiogroup">
          {FILTERS.map((f) => (
            <label key={f}>
              <input type="radio" name="filter" value={f} checked={filter === f} onChange={() => setFilter(f)} />
              <span>{t(`db.filter.${f}`)}</span>
            </label>
          ))}
        </div>
        <button type="button" className="btn btn-primary" id="postBtn" onClick={post}>
          <Icon name="plus" />
          <span>{t('db.post')}</span>
        </button>
      </div>
      <div className="tagbar" id="tagbar">
        {topTags.map(([tag, n]) => (
          <button key={tag} type="button" className={`chip${tags.has(tag) ? ' on' : ''}`} data-tag={tag}>
            {tag} <span className="muted">{n}</span>
          </button>
        ))}
      </div>
      <p className="stats" id="stats">
        {`${t('db.stats', { n: all.length })} · ${t('db.statsMatching', { n: items.length })}${mineCount ? ` · ${t('db.myNotes')}: ${mineCount}` : ''}`}
      </p>
      <div className="board" id="board">
        {items.length ? (
          items.map((p: Post) => (
            <NoteCard
              key={p.address}
              notices={notices}
              post={p}
              revealed={revealed.has(p.address)}
              onReveal={() => setRevealed((r) => new Set(r).add(p.address))}
              onMenu={(el) => menu(el, p)}
              onContact={() => setContact(p)}
            />
          ))
        ) : (
          <p className="empty">{all.length ? t('db.emptyFilter') : t('db.empty')}</p>
        )}
      </div>
      {compose ? <ComposeDialog notices={notices} existing={compose.existing} onClose={() => setCompose(null)} /> : null}
      {contact ? <ContactDialog post={contact} onClose={() => setContact(null)} /> : null}
      {reporting ? <ReportDialog notices={notices} post={reporting} onClose={() => setReporting(null)} /> : null}
    </div>
  );
}
