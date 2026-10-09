// Payload's page; the mount it runs as is the folder it is served from.
// gun is loaded as a plain script before this one (index.html).
import { mountApp } from '../../ui/mount';
import { PayloadApp } from './App';
import './payload.css';

await mountApp(PayloadApp, { id: 'payload', strings: false });
