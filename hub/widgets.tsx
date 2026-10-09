// The widget gallery: every widget with sample data, for working on them
// (npm run dev, then /widgets.html) and for the browser tests. Built only
// in development and tests, never into a deployed site.
import { mountPage } from '../ui/mount';
import { Widgets } from './pages/Widgets';
import './hub.css';

await mountPage(Widgets, { current: 'widgets' });
