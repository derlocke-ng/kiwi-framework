// The parts every page shares, as components: the icon, the top bar with the
// app switcher, the connection pill, the account button, the toasts and the
// relay list. Same markup and classes as the vanilla versions in shared/,
// which the apps not yet ported still use.
import { type ReactNode, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { relTime } from '../shared/i18n.js';
import { savedRelays } from '../shared/relays.js';
import { useIdentity, useKiwi, useKiwiTick, useNetTick, useOutboxWaiting, useRelayInfos, useT, useUnsynced } from './hooks';
import { dismiss, toastStore } from './toast';
import '../shared/topbar.css';
import '../shared/switcher.css';

export function Icon({ name, className = '' }: { name: string; className?: string }) {
  const { sprite } = useKiwi();
  return (
    <svg className={`icon ${className}`.trim()} aria-hidden="true">
      <use href={`${sprite}#${name}`} />
    </svg>
  );
}

/** The site's own mark, used when a page brings none. */
export const SiteMark = () => (
  <svg className="wjs-mark" viewBox="0 0 32 32" aria-hidden="true">
    <circle cx="16" cy="16" r="10" />
    <path d="M16 2v8M16 22v8M2 16h8M22 16h8" />
    <circle className="wjs-mark-dot" cx="16" cy="16" r="2.5" />
  </svg>
);

export interface Brand {
  href: string;
  name?: string;
  /** trusted markup for the name (the distribution's brandHtml) */
  html?: string;
  label?: string;
  mark?: ReactNode;
}

/** The sheet with the apps, the start page and the settings. Slides up on phones; the back button closes it. */
function Switcher({ open, onClose }: { open: boolean; onClose: (viaHistory?: boolean) => void }) {
  const kiwi = useKiwi();
  const t = useT();
  useKiwiTick();
  const [shown, setShown] = useState(false);
  const [visible, setVisible] = useState(false);
  const first = useRef<HTMLAnchorElement | null>(null);
  useEffect(() => {
    if (open) {
      setVisible(true);
      const id = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(id);
    }
    setShown(false);
    const id = setTimeout(() => setVisible(false), 220);
    return () => clearTimeout(id);
  }, [open]);
  useEffect(() => {
    if (open) first.current?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const onPop = () => onClose(true);
    document.addEventListener('keydown', onKey);
    window.addEventListener('popstate', onPop);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('popstate', onPop);
    };
  }, [open, onClose]);
  if (!visible) return null;
  const skip = new Set(kiwi.hiddenApps());
  const apps = kiwi.orderedApps().filter((a) => !skip.has(a.id));
  const { base, current } = kiwi;
  const item = (href: string, cls: boolean, icon: string, label: ReactNode, ref?: React.Ref<HTMLAnchorElement>) => (
    <li>
      <a href={href} className={cls ? 'current' : ''} aria-current={cls ? 'page' : undefined} ref={ref} onClick={() => onClose(true)}>
        <Icon name={icon} />
        <span>{label}</span>
      </a>
    </li>
  );
  return createPortal(
    <div className={`switcher${shown ? ' open' : ''}`}>
      <div className="switcher-backdrop" data-close onClick={() => onClose()} />
      <nav className="switcher-sheet" role="dialog" aria-modal="true" aria-label={t('switcher.title')}>
        <div className="switcher-grip" aria-hidden="true" />
        <div className="switcher-head">
          <h2>{t('switcher.title')}</h2>
          <button type="button" className="switcher-close" data-close aria-label={t('common.close')} onClick={() => onClose()}>
            <Icon name="x" />
          </button>
        </div>
        <ul className="switcher-apps">
          {item(base, current === 'hub', 'radio-tower', t('switcher.home'), current === 'hub' ? first : undefined)}
          {apps.map((a) => (
            <li key={a.id}>
              <a
                href={`${base}${a.id}/`}
                className={current === a.id ? 'current' : ''}
                aria-current={current === a.id ? 'page' : undefined}
                ref={current === a.id ? first : undefined}
                onClick={() => onClose(true)}
              >
                <Icon name={a.icon} />
                <span>
                  {a.name}
                  {a.legacy ? (
                    <>
                      {' '}
                      <small>{t('hub.legacy')}</small>
                    </>
                  ) : null}
                </span>
              </a>
            </li>
          ))}
          {item(`${base}settings.html`, current === 'settings', 'settings', t('hub.settings'), current === 'settings' ? first : undefined)}
        </ul>
      </nav>
    </div>,
    document.body,
  );
}

/** The bar every page shares: switcher button, brand, and a slot on the right. Renders the page's <header id="top">. */
export function TopBar({ brand, right }: { brand: Brand; right?: ReactNode }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const isOpen = useRef(false);
  const openSwitcher = () => {
    if (isOpen.current) return;
    isOpen.current = true;
    setOpen(true);
    history.pushState({ switcher: true }, '');
  };
  const close = useCallback((viaHistory = false) => {
    if (!isOpen.current) return;
    isOpen.current = false;
    setOpen(false);
    if (!viaHistory && history.state?.switcher) history.back();
  }, []);
  return (
    <header id="top" className="wjs-top">
      <button
        type="button"
        className="wjs-icon-btn wjs-switcher"
        id="switcher"
        title={t('switcher.open')}
        aria-label={t('switcher.open')}
        aria-haspopup="dialog"
        onClick={openSwitcher}
      >
        <Icon name="layout-grid" />
      </button>
      <a className="wjs-brand" href={brand.href} aria-label={brand.label || brand.name}>
        {brand.mark ?? <SiteMark />}
        {brand.html ? (
          <span className="wjs-brand-name" dangerouslySetInnerHTML={{ __html: brand.html }} />
        ) : (
          <span className="wjs-brand-name">{brand.name}</span>
        )}
      </a>
      <span className="wjs-spacer" />
      <div className="wjs-right">{right}</div>
      <Switcher open={open} onClose={close} />
    </header>
  );
}

/** How many relays are connected and how many changes no relay has yet. Links to the relay settings. */
export function StatusPill({ href = 'settings.html#relays', id = 'sync' }: { href?: string; id?: string }) {
  const { net } = useKiwi();
  const t = useT();
  useNetTick();
  const pending = useUnsynced();
  const s = net.pool.status();
  const text = s.connected
    ? `${s.connected}/${s.total}${pending ? ` · ${t('sync.toSync', { n: pending })}` : ''}`
    : pending
      ? `${t('sync.offline')} · ${t('sync.toSync', { n: pending })}`
      : t('sync.offline');
  const title = s.connected ? t('sync.titleOn', { connected: s.connected, relays: s.total }) : t('sync.titleOff');
  return (
    <a className="wjs-status" id={id} href={href} title={title} data-state={s.connected ? 'on' : 'off'}>
      <span className="wjs-status-dot" />
      <span className="wjs-status-text">{text}</span>
    </a>
  );
}

/** The account button: the alias's first letter in a circle when signed in, a user icon otherwise. */
export function AccountLink({ href, label = null, id = 'accountLink' }: { href: string; label?: string | null; id?: string }) {
  const t = useT();
  const identity = useIdentity();
  const alias = identity.alias;
  const title = alias ? t('app.signedInAs', { alias }) : label || t('app.deviceKeyBadge');
  return (
    <a className="icon-btn" href={href} id={id} title={title} aria-label={title}>
      {alias ? (
        <span className="wjs-avatar" aria-hidden="true">
          {alias[0].toUpperCase()}
        </span>
      ) : (
        <Icon name="user" />
      )}
    </a>
  );
}

export function Toasts() {
  const items = useSyncExternalStore(toastStore.subscribe, toastStore.get, toastStore.get);
  return (
    <div id="toasts" className="toasts" aria-live="polite">
      {items.map((x) => (
        <div key={x.id} className={`toast toast-${x.kind}${x.leaving ? ' leaving' : ''}`} role={x.kind === 'error' ? 'alert' : 'status'}>
          <span>{x.message}</span>
          {x.action ? (
            x.action.href ? (
              <a
                className="toast-action"
                href={x.action.href}
                onClick={() => {
                  x.action?.onClick?.();
                  dismiss(x.id);
                }}
              >
                {x.action.label}
              </a>
            ) : (
              <button
                type="button"
                className="toast-action"
                onClick={() => {
                  x.action?.onClick?.();
                  dismiss(x.id);
                }}
              >
                {x.action.label}
              </button>
            )
          ) : null}
        </div>
      ))}
    </div>
  );
}

/** The saved relays with their state; `detailed` adds what waits for each and the last rejection. */
export function RelayList({ detailed = false }: { detailed?: boolean }) {
  const { net } = useKiwi();
  const t = useT();
  useNetTick();
  const infos = useRelayInfos();
  const waiting = useOutboxWaiting();
  const status: any[] = net.pool.status().relays;
  return (
    <ul id="relayList" className="relay-list">
      {savedRelays().map((url: string) => {
        const r = status.find((x) => x.url === url);
        const info = infos.get(url);
        const state = r?.open ? (r.latency != null ? t('relay.latency', { n: r.latency }) : t('relay.connected')) : t('relay.notConnected');
        const detail = [info?.countries?.join(', '), info?.name].filter(Boolean).join(' · ');
        const problems = detailed
          ? [
              waiting[url] ? t('relay.waiting', { n: waiting[url] }) : '',
              r?.publishError ? t('relay.rejected', { error: r.publishError, when: relTime(r.publishErrorAt) }) : '',
            ]
              .filter(Boolean)
              .join(' · ')
          : r?.publishError
            ? t('relay.rejected', { error: r.publishError, when: '' }).trim()
            : '';
        return (
          <li key={url} className={r?.open ? 'up' : 'down'}>
            <span className="dot" />
            <span className="relay-name">
              {url.replace(/^wss?:\/\//, '')}
              {detail ? (
                <>
                  {' '}
                  <span className="relay-detail">{detail}</span>
                </>
              ) : null}
            </span>
            <span className="relay-state">{state}</span>
            {problems ? <span className="relay-problem small">{problems}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}
