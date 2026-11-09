// Payload's page; the mount it runs as is the folder it is served from.
import { mountApp } from '../../ui/mount';
import { PayloadApp } from './App';
import './payload.css';

await mountApp(PayloadApp, { id: 'payload' });
