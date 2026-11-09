// The password manager: logins, notes, cards and 2FA codes in the vault
// (shared/vault.js, ui/vault/) every device of the account opens with the
// vault's own passphrase. The list searches and filters; an entry opens in a
// panel over it with its fields to copy; an editor makes and changes entries
// with a generator beside the password; the health report points at weak,
// reused and old passwords and, when the person turned it on, at passwords in
// known breaches. A web page cannot fill in other sites' forms (that needs a
// browser extension): it copies, and opens the site.
// Routes: #/ the list, #/e/<id> an entry over it, #/e/<id>/edit and #/new/<type> the editor,
// #/generate the generator, #/health the report, #/settings.
import { useEffect } from 'react';
import { AppShell, useMount } from '../../ui/AppShell';
import { useT } from '../../ui/hooks';
import { goBack, useHash } from '../../ui/route';
import { useVault, VaultGate, VaultProvider } from '../../ui/vault/VaultProvider';
import { Panel } from '../../ui/widgets/Panel';
import { Editor } from './pages/Editor';
import { EntryView } from './pages/EntryView';
import { GeneratorPage } from './pages/Generator';
import { Health } from './pages/Health';
import { NewCa, NewSsh } from './pages/Keys';
import { List } from './pages/List';
import { VaultAppSettings } from './pages/VaultAppSettings';

export type Route =
  | { page: 'list' }
  | { page: 'entry'; id: string }
  | { page: 'edit'; id: string }
  | { page: 'new'; type: string }
  | { page: 'generate' }
  | { page: 'health' }
  | { page: 'settings' };

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  if (parts[0] === 'settings') return { page: 'settings' };
  if (parts[0] === 'generate') return { page: 'generate' };
  if (parts[0] === 'health') return { page: 'health' };
  if (parts[0] === 'new' && parts[1]) return { page: 'new', type: parts[1] };
  if (parts[0] === 'e' && parts[1]) return parts[2] === 'edit' ? { page: 'edit', id: parts[1] } : { page: 'entry', id: parts[1] };
  return { page: 'list' };
}

function Open({ route }: { route: Route }) {
  const t = useT();
  const vault = useVault();
  const close = () => goBack('#/');
  if (route.page === 'health') return <Health />;
  const item = route.page === 'entry' || route.page === 'edit' ? vault.store.get(route.id) : null;
  return (
    <>
      <List />
      {route.page === 'entry' && item ? (
        <Panel key={route.id} title={item.name || t('pw.unnamed')} onClose={close}>
          <EntryView item={item} />
        </Panel>
      ) : null}
      {route.page === 'entry' && !item ? (
        <Panel title={t('pw.unnamed')} onClose={close}>
          <p className="empty" id="entryGone">
            {t('pw.entryGone')}
          </p>
        </Panel>
      ) : null}
      {route.page === 'edit' && item ? <Editor key={route.id} item={item} /> : null}
      {route.page === 'new' && route.type === 'ssh' ? <NewSsh /> : null}
      {route.page === 'new' && route.type === 'ca' ? <NewCa /> : null}
      {route.page === 'new' && route.type !== 'ssh' && route.type !== 'ca' ? <Editor key={`new-${route.type}`} type={route.type} /> : null}
    </>
  );
}

export function VaultApp() {
  const t = useT();
  const mount = useMount();
  const hash = useHash({ scroll: false }); // an entry opens over the list, which keeps its place
  const route = parseRoute(hash);
  useEffect(() => {
    document.title = mount.name;
  }, [mount.name]);
  useEffect(() => {
    if (route.page === 'settings' || route.page === 'generate' || route.page === 'health') window.scrollTo(0, 0);
  }, [route.page]);
  return (
    <AppShell footer={t('pw.footer')} settings="#/settings">
      <VaultProvider>
        {route.page === 'settings' ? (
          <VaultAppSettings />
        ) : route.page === 'generate' ? (
          <GeneratorPage />
        ) : (
          <VaultGate>
            <Open route={route} />
          </VaultGate>
        )}
      </VaultProvider>
    </AppShell>
  );
}
