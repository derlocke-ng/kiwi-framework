// The password manager's page; the mount it runs as is the folder it is served from.
import { mountApp } from '../../ui/mount';
import { VaultApp } from './App';
import './vault.css';

await mountApp(VaultApp, { id: 'vault' });
