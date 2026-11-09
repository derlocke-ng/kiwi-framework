// The calendar app's page; the mount it runs as is the folder it is served from.
import { mountApp } from '../../ui/mount';
import { CalendarApp } from './App';
import './calendar.css';

await mountApp(CalendarApp, { id: 'calendar' });
