// Notices: a public noticeboard on nostr, mounted by Armory as DevBoard.
// Routes: #/ the board, #/n/<author>/<d> one note (a link into the board's
// space, ui/spaces.ts), #/settings the app's settings.
import { useCallback, useEffect, useState } from 'react';
import { tErr } from '../../shared/i18n.js';
import { AccountSettings } from '../../shared/settings.js';
import { AppShell, useMount } from '../../ui/AppShell';
import { useIdentity, useKiwi, useT, useTick } from '../../ui/hooks';
import { useHash } from '../../ui/route';
import { resolveSpaceLink } from '../../ui/spaces';
import { toast } from '../../ui/toast';
import { NAMESPACE, Notices, parseNoteHash } from './data/notices.js';
import { BoardView } from './pages/BoardView';
import { NoticesSettings } from './pages/NoticesSettings';
import { PrefsContext } from './state';

export function NoticesApp() {
  const t = useT();
  const kiwi = useKiwi();
  const identity = useIdentity();
  const mount = useMount();
  const hash = useHash();
  const route = hash.startsWith('#/settings') ? 'settings' : 'board';
  const note = parseNoteHash(hash);
  // a link into another space: this hub's mount for it, or a word that it is not served here
  const link = note ? resolveSpaceLink(kiwi, note.params, hash) : null;
  useEffect(() => {
    if (link?.redirect) location.replace(link.redirect);
  }, [link?.redirect]);
  const [state, setState] = useState<{ notices: Notices; prefs: any } | null>(null);

  // The board and the app's settings belong to the identity. The board is on the mount's space and its
  // network; the settings, like everything of the account's, on the hub's own.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key is the identity
  useEffect(() => {
    const notices = new Notices(kiwi.net, identity, { space: kiwi.mountSpace });
    const prefs = new AccountSettings(identity, kiwi.hubNet, NAMESPACE);
    let live = true;
    Promise.all([notices.start(), prefs.start()])
      .then(() => live && setState({ notices, prefs }))
      .catch((err) => toast(tErr(err), 'error'));
    return () => {
      live = false;
      notices.stop();
      prefs.stop();
      setState(null);
    };
  }, [identity.pk, kiwi]);

  const notices = state?.notices;
  useTick(useCallback((fn: () => void) => (notices ? notices.onChange(fn) : () => {}), [notices]));
  // "expires in …" moves on, and expired notes leave
  const [, setMinute] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setMinute((m) => m + 1), 60_000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    document.title = mount.name;
  }, [mount.name]);

  return (
    <AppShell footer={t('db.footer')} settings="#/settings">
      {state ? (
        <PrefsContext.Provider value={state.prefs}>
          {route === 'settings' ? <NoticesSettings /> : <BoardView notices={state.notices} focus={note?.address || null} foreign={link?.foreign || null} />}
        </PrefsContext.Provider>
      ) : (
        <p className="empty">{t('common.loading')}</p>
      )}
    </AppShell>
  );
}
