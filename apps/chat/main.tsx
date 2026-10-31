// The chat's page; the mount it runs as is the folder it is served from.
import { mountApp } from '../../ui/mount';
import { ChatApp } from './App';
import './chat.css';

await mountApp(ChatApp, { id: 'chat' });
