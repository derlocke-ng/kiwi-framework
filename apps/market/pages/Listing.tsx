// A listing as a card in the grid, and in full in a panel over it: photos,
// title and price, where it is and where it goes, the description, the
// seller; "Message seller" opens the chat with a message about it drafted, the
// contact the seller wrote shows on request. The seller marks it reserved or
// sold, changes or deletes it; anyone else saves, reports or blocks.
import { type FormEvent, useState } from 'react';
import { npub } from '../../../shared/account.js';
import { relTime, tErr } from '../../../shared/i18n.js';
import { REPORT_TYPES } from '../../../shared/moderation.js';
import { Icon } from '../../../ui/components';
import { confirmDialog, openMenu } from '../../../ui/dialogs';
import { useBlocks, useIdentity, useKiwi, usePeople, useT } from '../../../ui/hooks';
import { chatMount } from '../../../ui/notify';
import { spaceLinkQuery } from '../../../ui/spaces';
import { copyText, toast } from '../../../ui/toast';
import { Markdown } from '../../../ui/widgets/Markdown';
import { MediaImage } from '../../../ui/widgets/MediaImage';
import { Modal } from '../../../ui/widgets/Modal';
import { PhotoGrid } from '../../../ui/widgets/PhotoGrid';
import { listingHash } from '../data/market.js';
import { useMarket, useNameOf, usePlaceName, usePrefs, useSellers, useSocial } from '../state';

const fail = (err: unknown) => toast(tErr(err), 'error');

/** A listing in the grid: its first photo, title, price, where it is; reserved or sold on it. */
export function ListingCard({ listing }: { listing: any }) {
  const t = useT();
  const placeName = usePlaceName();
  const social = useSocial();
  const blocks = useBlocks();
  const folded = social.collapsed(listing, (pk: string) => Boolean(blocks?.isBlocked(pk)));
  // shown only to its seller and the moderators while the seller may not sell here
  const sellers = useSellers();
  const pending = sellers.ruled && sellers.status(listing.pubkey).ok !== true;
  return (
    <a
      className={`listing-card status-${listing.status}${folded ? ' folded' : ''}${pending ? ' pending' : ''}`}
      href={listingHash(listing)}
      data-address={listing.address}
    >
      <span className="listing-thumb">
        {listing.media[0] && !folded ? <MediaImage media={listing.media[0]} small alt={listing.title} /> : <Icon name={folded ? 'eye' : 'package'} />}
        {listing.status !== 'open' ? <span className={`listing-status ${listing.status}`}>{t(`mk.status.${listing.status}`)}</span> : null}
      </span>
      <span className="listing-info">
        <span className="listing-title">{folded ? t('mk.folded') : listing.title}</span>
        {listing.price && !folded ? <span className="listing-price">{listing.price}</span> : null}
        <span className="listing-where muted small">
          {t(`mk.cat.${listing.category}`)} · {placeName(listing.from)}
          {listing.audience !== 'space' ? (
            <>
              {' · '}
              <Icon name="users" />
            </>
          ) : null}
          {listing.expired ? ` · ${t('mk.expired')}` : ''}
        </span>
        {pending ? <span className="listing-pending">{t('mk.seller.pending')}</span> : null}
      </span>
    </a>
  );
}

function ReportDialog({ listing, onClose }: { listing: any; onClose: () => void }) {
  const t = useT();
  const { data } = useMarket();
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const type = String(f.get('type'));
    setBusy(true);
    try {
      await data.report(listing, REPORT_TYPES.includes(type) ? type : 'other', String(f.get('text') || ''));
      onClose();
      toast(t('mk.reported'), 'success');
    } catch (err) {
      setBusy(false);
      fail(err);
    }
  };
  return (
    <Modal open title={t('mk.reportTitle')} onClose={onClose}>
      <form className="form" id="reportForm" onSubmit={submit}>
        <p className="modal-text">{t('mk.reportText')}</p>
        <label className="field">
          {t('mk.reportReason')}
          <select name="type">
            {['spam', 'illegal', 'impersonation', 'other'].map((x) => (
              <option key={x} value={x}>
                {t(`mk.reason.${x}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          {t('mk.reportNote')}
          <textarea name="text" rows={2} maxLength={500} />
        </label>
        <div className="modal-actions">
          <button type="button" className="btn" data-close onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn-danger" disabled={busy}>
            {t('mk.reportSend')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** A listing in full, for its panel. */
export function ListingView({ listing, onEdit }: { listing: any; onEdit: (listing: any) => void }) {
  const t = useT();
  const kiwi = useKiwi();
  const id = useIdentity();
  const people = usePeople();
  const blocks = useBlocks();
  const social = useSocial();
  const prefs = usePrefs();
  const { data } = useMarket();
  const nameOf = useNameOf();
  const placeName = usePlaceName();
  const [contact, setContact] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [open, setOpen] = useState(false);
  const mine = listing.pubkey === id.pk;
  const folded = social.collapsed(listing, (pk: string) => Boolean(blocks?.isBlocked(pk)));
  const name = nameOf(listing.pubkey, listing.name);
  const saved: string[] = prefs.get('saved', []) || [];
  const isSaved = saved.includes(listing.address);
  const link = () => `${location.href.split('#')[0]}${listingHash(listing, spaceLinkQuery(kiwi))}`;
  const chat = chatMount();
  const message = chat
    ? `${kiwi.base}${chat.id}/#/dm/${listing.pubkey}?text=${encodeURIComponent(t('mk.draft', { title: listing.title, link: link() }))}`
    : null;
  const toggleSave = () =>
    prefs
      .set({ saved: isSaved ? saved.filter((a) => a !== listing.address) : [...saved, listing.address].slice(-200) })
      .then(() => toast(t(isSaved ? 'mk.unsaved' : 'mk.savedListing'), 'success'))
      .catch(fail);
  const setStatus = (status: string) => data.setStatus(listing, status).then(() => toast(t(`mk.status.${status}`), 'success'), fail);
  const menu = (el: HTMLElement) =>
    openMenu(el, [
      { label: t('mk.copyLink'), icon: 'link', run: () => copyText(link(), t('mk.link')) },
      ...(mine
        ? [
            { label: t('mk.edit'), icon: 'pencil', run: () => onEdit(listing) },
            ...['open', 'reserved', 'sold']
              .filter((s) => s !== listing.status)
              .map((s) => ({ label: t(`mk.mark.${s}`), icon: s === 'open' ? 'refresh-cw' : 'check', run: () => setStatus(s) })),
            {
              label: t('mk.delete'),
              icon: 'trash-2',
              danger: true,
              run: async () => {
                if (await confirmDialog({ title: t('mk.deleteConfirm'), message: '', confirm: t('common.delete'), danger: true }))
                  data.remove(listing).then(() => toast(t('mk.deleted'), 'success'), fail);
              },
            },
          ]
        : [
            ...(people?.isFriend(listing.pubkey)
              ? []
              : [
                  {
                    label: t('people.add'),
                    icon: 'user-plus',
                    run: () =>
                      people
                        .request(listing.pubkey)
                        .then((r: string) => toast(t(r === 'friends' ? 'people.friend' : 'people.requested'), 'success'))
                        .catch(fail),
                  },
                ]),
            ...(social.reportedByMe(listing.address) ? [] : [{ label: t('mk.report'), icon: 'shield', run: () => setReporting(true) }]),
            { label: t('mk.block'), icon: 'x', danger: true, run: () => blocks.block(listing.pubkey).then(() => toast(t('mk.blocked'), 'success'), fail) },
          ]),
    ]);
  if (folded && !open) {
    return (
      <div className="listing-folded" id="listingFolded">
        <Icon name="eye" />
        <span>{t(folded === 'moderator' ? 'mk.foldedModerator' : 'mk.foldedReports')}</span>
        <button type="button" className="link-btn" data-act="reveal" onClick={() => setOpen(true)}>
          {t('mk.showAnyway')}
        </button>
      </div>
    );
  }
  return (
    <article className={`listing status-${listing.status}`} data-address={listing.address}>
      <PhotoGrid media={listing.media} alt={listing.title} lead />
      <header className="listing-head">
        <div>
          <h2 className="listing-title">{listing.title}</h2>
          {listing.price ? <p className="listing-price">{listing.price}</p> : null}
        </div>
        <button type="button" className="icon-btn" data-act="menu" aria-label={t('mk.more')} onClick={(e) => menu(e.currentTarget)}>
          <Icon name="ellipsis" />
        </button>
      </header>
      <p className="listing-badges">
        <span className="badge">{t(`mk.cat.${listing.category}`)}</span>
        {listing.status !== 'open' ? <span className={`badge listing-status ${listing.status}`}>{t(`mk.status.${listing.status}`)}</span> : null}
        {listing.audience !== 'space' ? <span className="badge">{t('mk.notPublic')}</span> : null}
      </p>
      <dl className="listing-facts">
        <dt>{t('mk.from')}</dt>
        <dd data-fact="from">{placeName(listing.from)}</dd>
        <dt>{t('mk.delivery')}</dt>
        <dd data-fact="ships">
          {listing.ships.length ? listing.ships.map(placeName).join(', ') : t('mk.pickupOnly')}
          {listing.ships.length && listing.pickup ? ` · ${t('mk.pickupToo')}` : ''}
        </dd>
        <dt>{t('mk.until')}</dt>
        <dd data-fact="expires">{listing.expired ? t('mk.expired') : relTime(listing.expires * 1000)}</dd>
      </dl>
      {listing.text ? <Markdown source={listing.text} className="md listing-text" /> : null}
      <a className="listing-seller" href={`#/s/${listing.pubkey}`} title={npub(listing.pubkey)}>
        <span className="entry-avatar" aria-hidden="true">
          {(name.replace(/[^\p{L}\p{N}]/gu, '')[0] || '?').toUpperCase()}
        </span>
        <span>
          <b>{name}</b>
          <span className="muted small"> · {people?.isFriend(listing.pubkey) ? t('people.friend') : t('mk.seller')}</span>
        </span>
      </a>
      <div className="listing-actions">
        {mine ? (
          <button type="button" className="btn btn-primary" data-act="edit" onClick={() => onEdit(listing)}>
            <Icon name="pencil" />
            <span>{listing.expired ? t('mk.renew') : t('mk.edit')}</span>
          </button>
        ) : (
          <>
            {message ? (
              <a className="btn btn-primary" data-act="message" href={message}>
                <Icon name="message-circle" />
                <span>{t('mk.message')}</span>
              </a>
            ) : null}
            {listing.contact ? (
              <button type="button" className="btn" data-act="contact" onClick={() => setContact(true)}>
                <Icon name="user" />
                <span>{t('mk.contactShow')}</span>
              </button>
            ) : null}
            <button type="button" className={`btn ${isSaved ? 'btn-primary' : 'btn-ghost'}`} data-act="save" aria-pressed={isSaved} onClick={toggleSave}>
              <Icon name={isSaved ? 'pin' : 'pin-off'} />
              <span>{isSaved ? t('mk.savedListing') : t('mk.save')}</span>
            </button>
          </>
        )}
      </div>
      {contact ? (
        <Modal open title={t('mk.contactTitle', { title: listing.title })} onClose={() => setContact(false)}>
          <div className="contact" id="contactValue">
            {listing.contact}
          </div>
          <p className="modal-text">{t('mk.contactNote')}</p>
          <div className="modal-actions">
            <button type="button" className="btn" onClick={() => copyText(listing.contact, t('mk.contact'))}>
              <Icon name="copy" />
              <span>{t('common.copy')}</span>
            </button>
            <button type="button" className="btn btn-primary" data-close onClick={() => setContact(false)}>
              {t('common.close')}
            </button>
          </div>
        </Modal>
      ) : null}
      {reporting ? <ReportDialog listing={listing} onClose={() => setReporting(false)} /> : null}
    </article>
  );
}
