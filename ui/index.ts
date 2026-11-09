// The framework's React layer: what an app imports. Everything an app needs
// from the runtime comes through here, never from shared/ directly.

export { pendingReturn, RequireAccount, rememberReturn, takeReturn } from './AccountGate';
export type { AppSettingsProps, AppShellProps } from './AppShell';
export { AppSettings, AppShell, LanguageBanner, useMount } from './AppShell';
export type { Brand } from './components';
export { AccountLink, Icon, RelayList, SiteMark, StatusPill, Toasts, TopBar } from './components';
export type { ConfirmOptions, MenuItem, PickOptions } from './dialogs';
export { closeMenus, confirmDialog, Overlays, openMenu, pickPeople } from './dialogs';
export {
  KiwiContext,
  useAppSettings,
  useAudiences,
  useBlocks,
  useGroups,
  useIdentity,
  useKiwi,
  useKiwiTick,
  useMessages,
  useNetTick,
  useOutboxWaiting,
  usePeople,
  useRelayInfos,
  useSpace,
  useT,
  useTick,
  useUnsynced,
} from './hooks';
export type { Identity, KiwiOptions, Net } from './kiwi';
export { bootKiwi, Kiwi } from './kiwi';
export type { AppOptions } from './mount';
export { mountApp, mountPage } from './mount';
export { usePeopleNotices } from './notices';
export type { Unread } from './notify';
export { chatMount, notificationsSupported, notifyBrowser, notifyEnabled, setNotify, useUnread } from './notify';
export { goBack, useHash } from './route';
export { sendAsMessage } from './share';
export { resolveSpaceLink, spaceLinkQuery } from './spaces';
export { copyText, dismiss, download, toast, toastError } from './toast';
export type { Events, EventsOptions, Filter, NostrEvent } from './useEvents';
export { useEvents } from './useEvents';
export { useOpened } from './useOpened';
export * from './widgets';
