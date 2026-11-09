// The feed app's page; the mount it runs as is the folder it is served from.
import { mountApp } from '../../ui/mount';
import { FeedApp } from './App';
import './feed.css';

await mountApp(FeedApp, { id: 'feed' });
