// One person in this feed: their name and key, whether we are friends (and the
// way to become friends or to write to them), and their entries this device
// can read: the space's, and those of their audiences I am in.
import { useState } from 'react';
import { npub } from '../../../shared/account.js';
import { fingerprint, KINDS } from '../../../shared/events.js';
import { tErr } from '../../../shared/i18n.js';
import { Icon } from '../../../ui/components';
import { useAudiences, useIdentity, useKiwi, usePeople, useSpace, useT } from '../../../ui/hooks';
import { chatMount } from '../../../ui/notify';
import { toast } from '../../../ui/toast';
import { Feed } from '../../../ui/widgets/Feed';
import { useNameOf } from '../state';
import { Compose } from './Compose';
import { EntryCard } from './EntryCard';
import { useEntries } from './FeedView';

export function PersonPage({ pk }: { pk: string }) {
  const t = useT();
  const kiwi = useKiwi();
  const id = useIdentity();
  const people = usePeople();
  const audiences = useAudiences();
  const space = useSpace();
  const nameOf = useNameOf();
  const [editing, setEditing] = useState<any>(null);
  const list = useEntries([{ kinds: [KINDS.FEED_ENTRY], authors: [pk], ...(space ? { '#a': [space.address] } : {}) }]);
  const written = list.entries.find((e: any) => e.name)?.name || '';
  const me = pk === id.pk;
  const friend = Boolean(people?.isFriend(pk));
  const asked = Boolean(people?.outgoing().some((r: any) => r.pk === pk));
  const chat = chatMount();
  return (
    <div className="person-page">
      <section className="person-head card" id="person" data-pk={pk}>
        <h2>
          <span className="entry-avatar" aria-hidden="true">
            {(nameOf(pk, written).replace(/[^\p{L}\p{N}]/gu, '')[0] || '?').toUpperCase()}
          </span>
          <span className="person-name">{nameOf(pk, written)}</span>
        </h2>
        <p className="muted small">
          <code title={npub(pk)}>{fingerprint(pk)}</code>
          {' · '}
          <span id="personStatus">
            {me ? t('fd.thisIsYou') : friend ? t('people.friend') : audiences?.hasKeysFrom(pk) ? t('fd.inTheirAudience') : t('fd.notFriends')}
          </span>
        </p>
        {me ? null : (
          <div className="form-actions">
            {friend ? (
              chat ? (
                <a className="btn btn-sm" data-act="message" href={`${kiwi.base}${chat.id}/#/dm/${pk}`}>
                  <Icon name="message-circle" />
                  <span>{t('settings.message')}</span>
                </a>
              ) : null
            ) : (
              <button
                type="button"
                className="btn btn-sm btn-primary"
                data-act="befriend"
                disabled={asked}
                onClick={() =>
                  people
                    .request(pk)
                    .then((r: string) => toast(t(r === 'friends' ? 'people.friend' : 'people.requested'), 'success'))
                    .catch((err: unknown) => toast(tErr(err), 'error'))
                }
              >
                <Icon name="user-plus" />
                <span>{asked ? t('people.requested') : t('people.add')}</span>
              </button>
            )}
          </div>
        )}
      </section>
      <Feed
        items={list.entries}
        keyOf={(e: any) => e.address}
        renderItem={(e: any) => <EntryCard entry={e} onEdit={setEditing} />}
        hasMore={list.hasMore}
        loading={list.loading || list.opening}
        onLoadMore={list.loadMore}
        empty={<p className="empty">{t(me ? 'fd.emptyMine' : 'fd.emptyPerson')}</p>}
      />
      {editing ? <Compose existing={editing} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}
