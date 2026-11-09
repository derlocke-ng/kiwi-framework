// Photos of a post (an entry, a listing): a grid of thumbnails, one large when
// there is one; a tap shows a photo full size, with previous and next. Each
// photo is fetched, checked against its hash and decrypted (MediaImage).
//
//   <PhotoGrid media={entry.media} alt={entry.text.slice(0, 80)} />
import { useState } from 'react';
import { useT } from '../hooks';
import { type Media, MediaImage } from './MediaImage';
import { Modal } from './Modal';
import '../../shared/widgets.css';

export interface PhotoGridProps {
  media: Media[];
  /** what the photos show, for people who cannot see them */
  alt: string;
  /** the first photo large and the rest small beside it (a listing's gallery) rather than a grid */
  lead?: boolean;
}

export function PhotoGrid({ media, alt, lead = false }: PhotoGridProps) {
  const t = useT();
  const [shown, setShown] = useState<number | null>(null);
  if (!media.length) return null;
  return (
    <>
      <div className={`photo-grid n${Math.min(media.length, 4)}${lead ? ' lead' : ''}`}>
        {media.map((m, i) => (
          <button key={m.sha256} type="button" className="photo-grid-item" data-photo={i} aria-label={t('photo.n', { n: i + 1 })} onClick={() => setShown(i)}>
            <MediaImage media={m} small={!(lead && i === 0)} alt={alt} />
          </button>
        ))}
      </div>
      {shown !== null && media[shown] ? (
        <Modal open wide title={t('photo.n', { n: shown + 1 })} onClose={() => setShown(null)} id="photoView">
          <MediaImage media={media[shown]} alt={alt} className="photo-large" />
          {media.length > 1 ? (
            <div className="modal-actions">
              <button type="button" className="btn btn-sm" data-act="photo-prev" disabled={shown === 0} onClick={() => setShown(shown - 1)}>
                {t('photo.prev')}
              </button>
              <button type="button" className="btn btn-sm" data-act="photo-next" disabled={shown === media.length - 1} onClick={() => setShown(shown + 1)}>
                {t('photo.next')}
              </button>
            </div>
          ) : null}
        </Modal>
      ) : null}
    </>
  );
}
