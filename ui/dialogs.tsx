// Questions and menus any code can open from a handler, without a state of
// its own: confirmDialog() asks yes or no, pickPeople() chooses friends and
// circles to send to, openMenu() drops a menu from a button. Each puts an
// entry in a small store and the <Overlays/> host draws it; mountPage()
// renders the host on every page.
//
//   if (await confirmDialog({ title, message, confirm: t('common.delete'), danger: true })) …
//   const pks = await pickPeople(people, { base: kiwi.base });
//   openMenu(button, [{ label: t('db.edit'), icon: 'pencil', run: edit }, '-', { label, icon, danger: true, run }]);
import { type FormEvent, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { fingerprint } from '../shared/events.js';
import { Icon } from './components';
import { useT } from './hooks';
import { Modal } from './widgets/Modal';

export type MenuItem = { label: string; icon?: string; danger?: boolean; run: () => unknown } | '-';

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirm?: string;
  danger?: boolean;
}

export interface PickOptions {
  title?: string;
  action?: string;
  /** path to the site root, for the link to the settings when there are no friends yet */
  base?: string;
}

type Overlay =
  | { id: number; kind: 'confirm'; options: ConfirmOptions; resolve: (ok: boolean) => void }
  | { id: number; kind: 'pick'; people: any; options: PickOptions; resolve: (pks: string[]) => void }
  | { id: number; kind: 'menu'; anchor: HTMLElement; items: MenuItem[] };

let open: Overlay[] = [];
let next = 1;
const listeners = new Set<() => void>();
const set = (list: Overlay[]) => {
  open = list;
  for (const fn of listeners) fn();
};
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
const remove = (id: number) => set(open.filter((o) => o.id !== id));

/** Ask yes or no; resolves true when confirmed, false when cancelled or closed. */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => set([...open, { id: next++, kind: 'confirm', options, resolve }]));
}

/** Pick friends and circles to send to; resolves with pubkeys (empty when cancelled). */
export function pickPeople(people: any, options: PickOptions = {}): Promise<string[]> {
  return new Promise((resolve) => set([...open, { id: next++, kind: 'pick', people, options, resolve }]));
}

/** A menu under `anchor`, closed by a choice, a tap outside or Escape; one at a time. */
export function openMenu(anchor: HTMLElement, items: MenuItem[]): void {
  set([...open.filter((o) => o.kind !== 'menu'), { id: next++, kind: 'menu', anchor, items }]);
}

export function closeMenus(): void {
  if (open.some((o) => o.kind === 'menu')) set(open.filter((o) => o.kind !== 'menu'));
}

function Confirm({ options, done }: { options: ConfirmOptions; done: (ok: boolean) => void }) {
  const t = useT();
  return (
    <Modal open title={options.title} onClose={() => done(false)}>
      {options.message ? <p className="modal-text">{options.message}</p> : null}
      <div className="modal-actions">
        <button type="button" className="btn" data-close onClick={() => done(false)}>
          {t('common.cancel')}
        </button>
        <button type="button" className={`btn ${options.danger ? 'btn-danger' : 'btn-primary'}`} data-ok data-autofocus onClick={() => done(true)}>
          {options.confirm || t('common.ok')}
        </button>
      </div>
    </Modal>
  );
}

function Pick({ people, options, done }: { people: any; options: PickOptions; done: (pks: string[]) => void }) {
  const t = useT();
  const friends: any[] = people.friends();
  const circles: any[] = people.circles().filter((c: any) => c.members.length);
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const pks = new Set(form.getAll('pk').map(String));
    for (const id of form.getAll('circle')) for (const pk of people.membersOf(String(id))) pks.add(pk);
    done([...pks]);
  };
  const row = (name: string, value: string, label: string, extra: string | null = null) => (
    <li key={value}>
      <label className="check-row">
        <input type="checkbox" name={name} value={value} />
        <span>
          {label}
          {extra ? <span className="muted small"> {extra}</span> : null}
        </span>
      </label>
    </li>
  );
  return (
    <Modal open title={options.title || t('people.pick.title')} onClose={() => done([])}>
      {friends.length ? (
        <form className="form" id="pickPeople" onSubmit={submit}>
          {circles.length ? (
            <>
              <p className="small muted">{t('people.pick.circles')}</p>
              <ul className="pick-list">{circles.map((c) => row('circle', c.id, c.name, String(c.members.length)))}</ul>
            </>
          ) : null}
          <p className="small muted">{t('people.pick.friends')}</p>
          <ul className="pick-list">{friends.map((f) => row('pk', f.pk, f.name || fingerprint(f.pk)))}</ul>
          <div className="modal-actions">
            <button type="button" className="btn" data-close onClick={() => done([])}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn btn-primary">
              {options.action || t('people.pick.send')}
            </button>
          </div>
        </form>
      ) : (
        <>
          <p className="modal-text">{t('people.pick.none')}</p>
          <div className="modal-actions">
            <a className="btn btn-primary" href={`${options.base ?? '../'}settings.html#people`}>
              {t('hub.settings')}
            </a>
          </div>
        </>
      )}
    </Modal>
  );
}

function Menu({ anchor, items, close }: { anchor: HTMLElement; items: MenuItem[]; close: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  // Under the button, right-aligned to it, kept on the screen.
  useLayoutEffect(() => {
    const menu = ref.current;
    if (!menu) return;
    const r = anchor.getBoundingClientRect();
    const width = menu.offsetWidth;
    setPos({
      top: r.bottom + window.scrollY + 6,
      left: Math.max(8, Math.min(r.right + window.scrollX - width, window.scrollX + document.documentElement.clientWidth - width - 8)),
    });
    menu.querySelector<HTMLButtonElement>('button')?.focus();
  }, [anchor]);
  useEffect(() => {
    const outside = (e: Event) => !ref.current?.contains(e.target as Node) && close();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    // after the click that opened the menu
    const timer = setTimeout(() => {
      document.addEventListener('pointerdown', outside, true);
      document.addEventListener('keydown', onKey, true);
    });
    return () => {
      clearTimeout(timer);
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [close]);
  return createPortal(
    <div className="menu" role="menu" ref={ref} style={pos ? { top: pos.top, left: pos.left } : { visibility: 'hidden', top: 0, left: 0 }}>
      {items.map((it, i) =>
        it === '-' ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: separators have nothing else to tell them apart
          <hr key={`hr${i}`} />
        ) : (
          <button
            // biome-ignore lint/suspicious/noArrayIndexKey: a menu's items are fixed while it is open
            key={i}
            type="button"
            role="menuitem"
            data-i={i}
            className={it.danger ? 'danger' : ''}
            onClick={() => {
              close();
              it.run();
            }}
          >
            {it.icon ? <Icon name={it.icon} /> : null}
            <span>{it.label}</span>
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}

/** Draws what confirmDialog(), pickPeople() and openMenu() opened. */
export function Overlays() {
  const list = useSyncExternalStore(subscribe, () => open);
  return (
    <>
      {list.map((o) => {
        if (o.kind === 'confirm')
          return (
            <Confirm
              key={o.id}
              options={o.options}
              done={(ok) => {
                remove(o.id);
                o.resolve(ok);
              }}
            />
          );
        if (o.kind === 'pick')
          return (
            <Pick
              key={o.id}
              people={o.people}
              options={o.options}
              done={(pks) => {
                remove(o.id);
                o.resolve(pks);
              }}
            />
          );
        return <Menu key={o.id} anchor={o.anchor} items={o.items} close={closeMenus} />;
      })}
    </>
  );
}
