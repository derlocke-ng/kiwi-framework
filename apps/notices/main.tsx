// The notices app's page; the mount it runs as is the folder it is served from.
import { mountPage } from '../../ui/mount';
import { NoticesApp } from './App';
import './notices.css';

const current =
  location.pathname
    .replace(/[^/]*$/, '')
    .split('/')
    .filter(Boolean)
    .pop() || 'notices';
await mountPage(NoticesApp, { current, base: '../', sprite: '../icons.svg', dirs: ['../locales/', 'locales/'] });
