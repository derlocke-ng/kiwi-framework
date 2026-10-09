// The boards app's page. One build serves every route a hub mounts it at:
// the mount it runs as is the folder it is served from.
import { mountPage } from '../../ui/mount';
import { BoardsApp } from './App';
import './boards.css';

const current =
  location.pathname
    .replace(/[^/]*$/, '')
    .split('/')
    .filter(Boolean)
    .pop() || 'boards';
await mountPage(BoardsApp, { current, base: '../', sprite: '../icons.svg', dirs: ['../locales/', 'locales/'] });
