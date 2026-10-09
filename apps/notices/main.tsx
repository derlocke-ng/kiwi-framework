// The notices app's page; the mount it runs as is the folder it is served from.
import { mountApp } from '../../ui/mount';
import { NoticesApp } from './App';
import './notices.css';

await mountApp(NoticesApp, { id: 'notices' });
