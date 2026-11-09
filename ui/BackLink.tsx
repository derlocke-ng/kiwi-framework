// The back arrow of a page one step in (a board, a conversation): it goes back
// in the history, as a phone's back does, so the list is where it was and the
// history does not grow with every visit; a page opened from a link (no
// history in this app) goes to `href` instead. A click with a modifier keeps
// the link's ordinary meaning (a new tab).
import { Icon } from './components';
import { goBack } from './route';

export function BackLink({ href, label, id }: { href: string; label: string; id?: string }) {
  return (
    <a
      className="icon-btn back"
      id={id}
      href={href}
      aria-label={label}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        goBack(href);
      }}
    >
      <Icon name="chevron-left" />
    </a>
  );
}
