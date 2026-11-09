// Listing something, or changing a listing: what it is (title, category,
// price, description, photos), where it is and where it goes (the country, the
// places it ships to or pickup only), how to reach the seller besides the chat,
// how long it stays up, and who sees it (the space, or friends, or a circle).
import { type FormEvent, useState } from 'react';
import { countriesByName } from '../../../shared/countries.js';
import { currentLanguage, tErr } from '../../../shared/i18n.js';
import { Icon } from '../../../ui/components';
import { usePeople, useSpace, useT } from '../../../ui/hooks';
import { toast } from '../../../ui/toast';
import { ImageUpload } from '../../../ui/widgets/ImageUpload';
import { MediaImage } from '../../../ui/widgets/MediaImage';
import { Modal } from '../../../ui/widgets/Modal';
import { CATEGORIES, DURATIONS, LIMITS } from '../data/market.js';
import { useMarket, usePlaceName, usePrefs } from '../state';

export function Compose({ existing = null, onClose, onPosted }: { existing?: any; onClose: () => void; onPosted?: () => void }) {
  const t = useT();
  const { data } = useMarket();
  const prefs = usePrefs();
  const space = useSpace();
  const people = usePeople();
  const placeName = usePlaceName();
  const lang = currentLanguage();
  const countries = countriesByName(lang);
  const myCountry = String(prefs.get('country') || '');
  const [media, setMedia] = useState<any[]>(existing?.media || []);
  const [from, setFrom] = useState<string>(existing?.from || myCountry || '');
  const [ships, setShips] = useState<string[]>(existing ? existing.ships : myCountry ? [myCountry] : []);
  const [pickupOnly, setPickupOnly] = useState<boolean>(existing ? !existing.ships.length : false);
  const [adding, setAdding] = useState('');
  const [busy, setBusy] = useState(false);
  const audiences = [...(space ? ['space'] : []), 'friends', ...(people?.circles() || []).map((c: any) => `c:${c.id}`)];
  const audienceName = (a: string) =>
    a === 'space'
      ? t('mk.aud.space', { space: space?.name || '' })
      : a === 'friends'
        ? t('mk.aud.friends')
        : t('mk.aud.circle', { name: people?.circles().find((c: any) => `c:${c.id}` === a)?.name || '' });
  const addShip = (code: string) => code && setShips((cur) => (cur.includes(code) ? cur : [...cur, code].slice(0, LIMITS.ships)));
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const get = (k: string) => String(f.get(k) || '').trim();
    if (!get('title')) return toast(t('mk.error.title'), 'error');
    if (!from) return toast(t('mk.error.country'), 'error');
    if (!pickupOnly && !ships.length) return toast(t('mk.error.ships'), 'error');
    setBusy(true);
    try {
      await data.post(
        {
          title: get('title'),
          category: get('category'),
          price: get('price'),
          text: get('text'),
          from,
          ships: pickupOnly ? [] : ships,
          pickup: pickupOnly || f.get('pickup') === 'on',
          media,
          contact: get('contact'),
          status: existing?.status || 'open',
        },
        { audience: get('audience') || 'space', days: Number(get('days')) || 30, ...(existing ? { d: existing.d, at: existing.at } : {}) },
      );
      onPosted?.();
      onClose();
      toast(t(existing ? 'mk.saved' : 'mk.posted'), 'success');
    } catch (err) {
      setBusy(false);
      toast(tErr(err), 'error', 6000);
    }
  };
  return (
    <Modal open wide id="compose" title={existing ? t('mk.editTitle') : t('mk.newTitle')} onClose={onClose}>
      <form className="form compose" id="listingForm" onSubmit={submit}>
        <label className="field">
          <span>{t('mk.title')}</span>
          <input name="title" required maxLength={LIMITS.title} defaultValue={existing?.title || ''} placeholder={t('mk.titlePlaceholder')} data-autofocus />
        </label>
        <div className="row">
          <label className="field">
            <span>{t('mk.category')}</span>
            <select name="category" defaultValue={existing?.category || 'seeds'}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t(`mk.cat.${c}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t('mk.price')}</span>
            <input name="price" maxLength={LIMITS.price} defaultValue={existing?.price || ''} placeholder={t('mk.pricePlaceholder')} />
          </label>
        </div>
        <label className="field">
          <span>{t('mk.text')}</span>
          <textarea name="text" rows={4} maxLength={LIMITS.text} defaultValue={existing?.text || ''} placeholder={t('mk.textPlaceholder')} />
        </label>
        {media.length ? (
          <ul className="compose-photos" id="composePhotos">
            {media.map((m, i) => (
              <li key={m.sha256} data-photo={i}>
                <MediaImage media={m} small alt={t('photo.n', { n: i + 1 })} />
                <button
                  type="button"
                  className="icon-btn"
                  data-act="photo-remove"
                  aria-label={t('mk.removePhoto')}
                  onClick={() => setMedia(media.filter((x) => x !== m))}
                >
                  <Icon name="x" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {media.length < LIMITS.media ? (
          <ImageUpload allowPlain={false} label={t('mk.addPhoto')} disabled={busy} onUpload={(m) => setMedia((cur) => [...cur, m].slice(0, LIMITS.media))} />
        ) : null}
        <label className="field">
          <span>{t('mk.from')}</span>
          <select name="from" value={from} onChange={(e) => setFrom(e.target.value)}>
            <option value="">{t('mk.chooseCountry')}</option>
            {countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="field ships">
          <legend>{t('mk.delivery')}</legend>
          <div className="seg" role="radiogroup">
            <label>
              <input type="radio" name="delivery" value="ships" checked={!pickupOnly} onChange={() => setPickupOnly(false)} />
              <span>{t('mk.ships')}</span>
            </label>
            <label>
              <input type="radio" name="delivery" value="pickup" checked={pickupOnly} onChange={() => setPickupOnly(true)} />
              <span>{t('mk.pickupOnly')}</span>
            </label>
          </div>
          {pickupOnly ? null : (
            <>
              <ul className="dest-chips" id="shipsTo">
                {ships.map((code) => (
                  <li key={code} data-dest={code}>
                    <span>{placeName(code)}</span>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={t('mk.removeDest', { place: placeName(code) })}
                      onClick={() => setShips(ships.filter((x) => x !== code))}
                    >
                      <Icon name="x" />
                    </button>
                  </li>
                ))}
              </ul>
              <div className="dest-add">
                {from && !ships.includes(from) ? (
                  <button type="button" className="btn btn-sm" data-act="ship-home" onClick={() => addShip(from)}>
                    {placeName(from)}
                  </button>
                ) : null}
                {['EU', 'WW']
                  .filter((r) => !ships.includes(r))
                  .map((r) => (
                    <button key={r} type="button" className="btn btn-sm" data-act={`ship-${r}`} onClick={() => addShip(r)}>
                      {placeName(r)}
                    </button>
                  ))}
                <select
                  name="addCountry"
                  aria-label={t('mk.addCountry')}
                  value={adding}
                  onChange={(e) => {
                    addShip(e.target.value);
                    setAdding('');
                  }}
                >
                  <option value="">{t('mk.addCountry')}</option>
                  {countries
                    .filter((c) => !ships.includes(c.code))
                    .map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.name}
                      </option>
                    ))}
                </select>
              </div>
              <label className="check-row">
                <input type="checkbox" name="pickup" defaultChecked={Boolean(existing?.pickup && existing.ships.length)} />
                <span>{t('mk.pickupToo')}</span>
              </label>
            </>
          )}
        </fieldset>
        <label className="field">
          <span>{t('mk.contact')}</span>
          <input
            name="contact"
            maxLength={LIMITS.contact}
            defaultValue={existing?.contact ?? String(prefs.get('contact') || '')}
            placeholder={t('mk.contactPlaceholder')}
          />
        </label>
        <p className="hint">{t('mk.contactHint')}</p>
        <div className="row">
          <label className="field">
            <span>{t('mk.duration')}</span>
            <select name="days" defaultValue={String(prefs.get('days') || 30)}>
              {DURATIONS.map((n) => (
                <option key={n} value={n}>
                  {t('mk.days', { n })}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t('mk.audience')}</span>
            <select name="audience" defaultValue={existing && audiences.includes(existing.audience) ? existing.audience : audiences[0]}>
              {audiences.map((a) => (
                <option key={a} value={a}>
                  {audienceName(a)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn" data-close onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {existing ? t('mk.save.changes') : t('mk.post')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
