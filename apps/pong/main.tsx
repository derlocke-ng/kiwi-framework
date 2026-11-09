// pong's page; the mount it runs as is the folder it is served from.
import { mountApp } from '../../ui/mount';
import { PongApp } from './App';
import './style.css';

await mountApp(PongApp, { id: 'pong', strings: false });
