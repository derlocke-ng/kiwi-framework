// The start page: the apps, your account, the relays.
import { mountPage } from '../ui/mount';
import { Start } from './pages/Start';
import './hub.css';

await mountPage(Start, { current: 'hub' });
