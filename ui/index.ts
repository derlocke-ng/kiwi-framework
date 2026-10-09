// The framework's React layer: what an app imports. Everything an app needs
// from the runtime comes through here, never from shared/ directly.

export { confirmDialog } from '../shared/ui.js';
export type { Brand } from './components';
export { AccountLink, Icon, RelayList, SiteMark, StatusPill, Toasts, TopBar } from './components';
export { KiwiContext, useBlocks, useIdentity, useKiwi, useKiwiTick, useNetTick, useOutboxWaiting, usePeople, useRelayInfos, useT, useUnsynced } from './hooks';
export type { Identity, KiwiOptions, Net } from './kiwi';
export { bootKiwi, Kiwi } from './kiwi';
export { mountPage } from './mount';
export { usePeopleNotices } from './notices';
export { copyText, dismiss, download, toast } from './toast';
export type { Events, EventsOptions, Filter, NostrEvent } from './useEvents';
export { useEvents } from './useEvents';
export * from './widgets';
