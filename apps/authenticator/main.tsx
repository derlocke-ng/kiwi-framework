// The authenticator's page; the mount it runs as is the folder it is served from.
import { mountApp } from '../../ui/mount';
import { AuthenticatorApp } from './App';
import './authenticator.css';

await mountApp(AuthenticatorApp, { id: 'authenticator' });
