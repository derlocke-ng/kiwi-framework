// The market app's page; the mount it runs as is the folder it is served from.
import { mountApp } from '../../ui/mount';
import { MarketApp } from './App';
import './market.css';

await mountApp(MarketApp, { id: 'market' });
