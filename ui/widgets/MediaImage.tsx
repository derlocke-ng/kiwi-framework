// A photo from a media (Blossom) server: fetched from its URL or any of the
// person's servers, checked against its hash, decrypted when it is
// encrypted, and shown from memory. Servers never see who looks at it in
// clear: an encrypted photo is random bytes to them.
//
//   <MediaImage media={item.photo} small alt={item.t} />
import { type ImgHTMLAttributes, useEffect, useState } from 'react';
import { openMedia } from '../../shared/blossom.js';
import { Icon } from '../components';
import { useKiwi, useT } from '../hooks';

/** One file on a server: where it is and the hash that proves it. */
export interface MediaFile {
  url: string;
  sha256: string;
  width?: number;
  height?: number;
}

/** What uploadMedia() returns and an app keeps in its (encrypted) event. `key` only when encrypted. */
export interface Media extends MediaFile {
  size: number;
  mime: string;
  key?: string;
  thumb?: MediaFile;
}

const KEEP = 60;
const cache = new Map<string, Promise<Blob>>();

/** The file as a Blob, fetched and decrypted once per page; the last few dozen stay in memory. */
export function loadMedia(media: Media, servers: string[], small = false): Promise<Blob> {
  const which = small && media.thumb ? media.thumb : media;
  const id = `${which.sha256}:${media.key || ''}`;
  const known = cache.get(id);
  if (known) {
    cache.delete(id);
    cache.set(id, known);
    return known;
  }
  const loading = openMedia(media, { servers, small }).then((bytes: Uint8Array) => new Blob([bytes as BlobPart], { type: media.mime }));
  loading.catch(() => cache.delete(id));
  cache.set(id, loading);
  while (cache.size > KEEP) cache.delete(cache.keys().next().value as string);
  return loading;
}

export interface MediaImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'width' | 'height'> {
  media: Media;
  /** the thumbnail, when there is one (lists, grids) */
  small?: boolean;
  alt: string;
}

export function MediaImage({ media, small = false, alt, className = '', ...img }: MediaImageProps) {
  const kiwi = useKiwi();
  const t = useT();
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const which = small && media.thumb ? media.thumb : media;
  const aspect = which.width && which.height ? { aspectRatio: `${which.width} / ${which.height}` } : undefined;

  // biome-ignore lint/correctness/useExhaustiveDependencies: the hash and key are the file; the object around them may be new on every render
  useEffect(() => {
    let live = true;
    let url: string | null = null;
    setSrc(null);
    setFailed(false);
    loadMedia(media, kiwi.mediaServers(), small).then(
      (blob) => {
        if (!live) return;
        url = URL.createObjectURL(blob);
        setSrc(url);
      },
      () => live && setFailed(true),
    );
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [which.sha256, media.key, small]);

  if (failed) {
    return (
      <span className={`wjs-media failed ${className}`.trim()} role="img" aria-label={alt} style={aspect}>
        <Icon name="image" />
        <span>{t('media.error.notFound')}</span>
      </span>
    );
  }
  if (!src) return <span className={`wjs-media loading ${className}`.trim()} role="img" aria-label={alt} aria-busy="true" style={aspect} />;
  return <img {...img} className={`wjs-media ${className}`.trim()} src={src} alt={alt} width={which.width} height={which.height} data-sha256={which.sha256} />;
}
