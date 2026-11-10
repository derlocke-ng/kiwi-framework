// The search: every conversation and group on this device, by words in a
// message (as edited) or a file's name, accents set aside. Nothing leaves the
// device; a result opens its thread at that message.
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { fingerprint } from '../../../shared/events.js';
import { relTime } from '../../../shared/i18n.js';
import { BackLink } from '../../../ui/BackLink';
import { Icon } from '../../../ui/components';
import { useGroups, useIdentity, usePeople, useT } from '../../../ui/hooks';
import { useDm, useDmVersion } from '../state';
import { preview } from './Thread';

const WINDOW = 140; // characters of a long message shown around the first word found

/** The words found, marked; a long text from a little before the first of them. */
function Marked({ text, words }: { text: string; words: string[] }) {
  const lower = text.toLowerCase();
  const first = Math.min(...words.map((w) => lower.indexOf(w)).filter((i) => i >= 0));
  const start = Number.isFinite(first) && text.length > WINDOW && first > WINDOW / 3 ? first - Math.floor(WINDOW / 3) : 0;
  const shown = (start ? '…' : '') + text.slice(start, start + WINDOW) + (text.length > start + WINDOW ? '…' : '');
  const escaped = words.filter(Boolean).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!escaped.length) return <>{shown}</>;
  const re = new RegExp(`(${escaped.join('|')})`, 'gi');
  const parts: ReactNode[] = shown.split(re).map((part, i) =>
    // biome-ignore lint/suspicious/noArrayIndexKey: the parts of one text are fixed
    i % 2 ? <mark key={i}>{part}</mark> : part,
  );
  return <>{parts}</>;
}

export function Search({ q }: { q: string }) {
  const t = useT();
  const dm = useDm();
  const version = useDmVersion(dm);
  const groups = useGroups();
  const people = usePeople();
  const identity = useIdentity();
  const [query, setQuery] = useState(q);
  const [found, setFound] = useState<any[] | null>(null);
  const input = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    input.current?.focus();
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `version`: the store changed, the results may have
  useEffect(() => {
    let live = true;
    // the address keeps the words, so "back" from a result comes back to them
    history.replaceState(null, '', `#/search${query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ''}`);
    if (!query.trim()) {
      setFound(null);
      return;
    }
    const id = setTimeout(() => {
      dm.search(query).then((r: any[]) => live && setFound(r));
    }, 200);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [dm, query, version]);

  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const nameOf = (pk: string) =>
    pk === identity.pk ? t('chat.you') : people?.friends?.().find((f: any) => f.pk === pk)?.name || people?.nameOf?.(pk) || fingerprint(pk);
  const where = (m: any) => {
    if (m.group) {
      const g = groups?.entry(m.conv);
      if (!g) return null;
      const name = groups.info(m.conv)?.name || g.name || t('chat.group.title');
      return { name, href: `#/group/${m.conv}/${g.host}/${g.invite || '-'}/${encodeURIComponent(name)}?m=${m.id}`, icon: 'users' };
    }
    return { name: nameOf(m.conv), href: `#/dm/${m.conv}?m=${m.id}`, icon: 'message-circle' };
  };
  const results = (found || []).map((m) => ({ m, at: where(m) })).filter((r) => r.at);

  return (
    <section className="search page-enter">
      <div className="page-head">
        <BackLink href="#/" label={t('chat.back')} />
        <h1>{t('chat.search.title')}</h1>
      </div>
      <form className="search-box" role="search" onSubmit={(e) => e.preventDefault()}>
        <Icon name="search" />
        <input
          ref={input}
          id="searchInput"
          type="search"
          value={query}
          maxLength={200}
          placeholder={t('chat.search.placeholder')}
          aria-label={t('chat.search.title')}
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
        />
      </form>
      {found == null ? (
        <p className="muted small">{t('chat.search.hint')}</p>
      ) : results.length ? (
        <ul className="convs" id="searchResults">
          {results.map(({ m, at }) => (
            <li key={m.id}>
              <a href={at?.href} className="conv" data-result={m.id}>
                <span className="avatar" aria-hidden="true">
                  <Icon name={at?.icon || 'message-circle'} />
                </span>
                <span className="conv-main">
                  <span className="conv-name">{at?.name}</span>
                  <span className="conv-preview result-text">
                    {m.group || m.from === identity.pk ? `${nameOf(m.from)}: ` : ''}
                    <Marked text={m.file ? preview(t, m) : m.text} words={words} />
                  </span>
                </span>
                <span className="conv-meta">
                  <time>{relTime(m.at * 1000)}</time>
                </span>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty" id="searchEmpty">
          {t('chat.search.none')}
        </p>
      )}
    </section>
  );
}
