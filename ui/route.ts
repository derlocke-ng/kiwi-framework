// An app's routes live after '#' ('#/', '#/settings', '#/b/<id>'), so one
// build serves every mount and a reload keeps the page.
import { useEffect, useState } from 'react';
import { closeMenus } from './dialogs';

/** The address after '#'; a new one closes menus and goes to the top of the page. */
export function useHash(): string {
  const [hash, setHash] = useState(() => location.hash);
  useEffect(() => {
    const follow = () => {
      closeMenus();
      setHash(location.hash);
      window.scrollTo(0, 0);
    };
    addEventListener('hashchange', follow);
    return () => removeEventListener('hashchange', follow);
  }, []);
  return hash;
}
