// The site's settings: account, language and appearance, proof of work,
// apps, people, circles, relays, backup, blocked people, this device.
import { mountPage } from '../ui/mount';
import { Settings } from './pages/Settings';
import './hub.css';

await mountPage(Settings, { current: 'settings' });
