// One way to start a page: boot the runtime, then render the page inside it.
// If the runtime cannot start (storage blocked, a broken install), the page
// says so instead of staying blank.
import { type ComponentType, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
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
