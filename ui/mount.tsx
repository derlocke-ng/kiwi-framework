// One way to start a page: boot the runtime, then render the page inside it,
// with the host for dialogs and menus opened from code (ui/dialogs.tsx).
// If the runtime cannot start (storage blocked, a broken install), the page
// says so instead of staying blank.
import { type ComponentType, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Overlays } from './dialogs';
import { KiwiContext } from './hooks';
import { bootKiwi, type KiwiOptions } from './kiwi';

export async function mountPage(Page: ComponentType, options: KiwiOptions = {}): Promise<void> {
  const el = document.getElementById('root');
  if (!el) throw new Error('the page needs a <div id="root">');
  const root = createRoot(el);
  try {
    const kiwi = await bootKiwi(options);
    root.render(
      <StrictMode>
        <KiwiContext.Provider value={kiwi}>
          <Page />
          <Overlays />
        </KiwiContext.Provider>
      </StrictMode>,
    );
  } catch (err) {
    console.error(err);
    document.documentElement.classList.add('i18n');
    root.render(
      <main>
        <p className="empty" role="alert">
          {`This page could not start: ${err instanceof Error ? err.message : String(err)}. Reload, or check that this browser allows storage for the site.`}
        </p>
      </main>,
    );
  }
}

export interface AppOptions {
  /** the app's id, for a page served from no folder of its own */
  id: string;
  /** false: the app has no strings of its own (locales/ beside the page) */
  strings?: boolean;
}

/**
 * An app's page, one folder below the hub: the mount it runs as is the folder
 * it is served from (so one build serves every mount), the hub's strings,
 * sprite and worker are one level up, the app's own strings beside it.
 *
 *   await mountApp(App, { id: 'outpost' });
 */
export function mountApp(Page: ComponentType, { id, strings = true }: AppOptions): Promise<void> {
  const current =
    location.pathname
      .replace(/[^/]*$/, '')
      .split('/')
      .filter(Boolean)
      .pop() || id;
  return mountPage(Page, { current, base: '../', sprite: '../icons.svg', dirs: ['../locales/', ...(strings ? ['locales/'] : [])] });
}
