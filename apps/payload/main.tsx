// Payload's page; the mount it runs as is the folder it is served from.
// gun is loaded as a plain script before this one (index.html).
import { mountPage } from '../../ui/mount';
import { PayloadApp } from './App';
import './payload.css';

const current =
  location.pathname
    .replace(/[^/]*$/, '')
    .split('/')
    .filter(Boolean)
    .pop() || 'payload';
await mountPage(PayloadApp, { current, base: '../', sprite: '../icons.svg', dirs: ['../locales/'] });
