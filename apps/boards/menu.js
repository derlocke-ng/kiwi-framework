// A file name for a download.

/** A file name from a title: letters, digits, dashes. */
export function safeFilename(name, ext) {
  const base = String(name || 'board').replace(/[^\p{L}\p{N} _.-]+/gu, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'board';
  return `${base}.${ext}`;
}
