// pong's page; the mount it runs as is the folder it is served from.
// gun is loaded as a plain script before this one (index.html).
import { mountApp } from '../../ui/mount';
import { PongApp } from './App';
import './style.css';

await mountApp(PongApp, { id: 'pong', strings: false });
