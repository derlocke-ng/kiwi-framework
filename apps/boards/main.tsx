// The boards app's page. One build serves every route a hub mounts it at:
// the mount it runs as is the folder it is served from.
import { mountApp } from '../../ui/mount';
import { BoardsApp } from './App';
import './boards.css';

await mountApp(BoardsApp, { id: 'boards' });
