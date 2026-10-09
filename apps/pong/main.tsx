// pong's page; the mount it runs as is the folder it is served from.
// gun is loaded as a plain script before this one (index.html).
import { mountPage } from '../../ui/mount';
import { PongApp } from './App';
import './style.css';

const current =
  location.pathname
    .replace(/[^/]*$/, '')
    .split('/')
    .filter(Boolean)
    .pop() || 'pong';
await mountPage(PongApp, { current, base: '../', sprite: '../icons.svg', dirs: ['../locales/'] });
