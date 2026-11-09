// An app's routes live after '#' ('#/', '#/settings', '#/b/<id>'), so one
// build serves every mount and a reload keeps the page.
import { useEffect, useState } from 'react';
import { closeMenus } from './dialogs';

// Has this page moved from one route to another? Then "back" stays in the app; a page opened straight at a
// route (a shared link) has nothing behind it to go back to.
let moved = false;
if (typeof addEventListener === 'function') addEventListener('hashchange', () => (moved = true));

/**
 * The address after '#'; a new one closes menus and, unless `scroll` is false, goes to the top of the page.
 * An app whose routes open panels over a list (ui/widgets/Panel.tsx) keeps the list where it was.
 */
export function useHash({ scroll = true }: { scroll?: boolean } = {}): string {
  const [hash, setHash] = useState(() => location.hash);
  useEffect(() => {
    const follow = () => {
      closeMenus();
      setHash(location.hash);
      if (scroll) window.scrollTo(0, 0);
    };
    addEventListener('hashchange', follow);
    return () => removeEventListener('hashchange', follow);
  }, [scroll]);
  return hash;
}

/** Back where the person came from in this app, or to `fallback` when the page was opened straight at this route. */
export function goBack(fallback = '#/'): void {
  if (moved && history.length > 1) history.back();
  else location.hash = fallback;
}
