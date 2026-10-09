// Notices: a public noticeboard on nostr, mounted by Armory as DevBoard.
// Routes: #/ the board, #/settings the app's settings.
import { useCallback, useEffect, useState } from 'react';
import { tErr } from '../../shared/i18n.js';
import { AccountSettings } from '../../shared/settings.js';
import { AppShell, useMount } from '../../ui/AppShell';
import { useIdentity, useKiwi, useT, useTick } from '../../ui/hooks';
import { closeMenus } from '../../ui/menu';
import { toast } from '../../ui/toast';
import { NAMESPACE, Notices } from './data/notices.js';
import { BoardView } from './pages/BoardView';
import { NoticesSettings } from './pages/NoticesSettings';
import { PrefsContext } from './state';

function useRoute() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const follow = () => {
      closeMenus();
      setHash(location.hash);
      window.scrollTo(0, 0);
    };
    addEventListener('hashchange', follow);
    return () => removeEventListener('hashchange', follow);
  }, []);
  return hash.startsWith('#/settings') ? 'settings' : 'board';
}

export function NoticesApp() {
  const t = useT();
  const kiwi = useKiwi();
  const identity = useIdentity();
  const mount = useMount();
  const route = useRoute();
  const [state, setState] = useState<{ notices: Notices; prefs: any } | null>(null);

  // The board and the app's settings belong to the identity.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key is the identity
  useEffect(() => {
    const notices = new Notices(kiwi.net, identity);
    const prefs = new AccountSettings(identity, kiwi.net, NAMESPACE);
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
        <PrefsContext.Provider value={state.prefs}>{route === 'settings' ? <NoticesSettings /> : <BoardView notices={state.notices} />}</PrefsContext.Provider>
      ) : (
        <p className="empty">{t('common.loading')}</p>
      )}
    </AppShell>
  );
}
