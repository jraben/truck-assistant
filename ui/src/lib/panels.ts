// Panels other screens open: the mileage & maintenance logs (Trips header,
// the Drive screen's "due" card) and the Map screen's tab (Traffic alerts).
import { store } from './brain.ts';

export type LogsTab = 'mileage' | 'maintenance';
export const logsStore = store<LogsTab | null>(null);
export const mapTabStore = store<'map' | 'traffic'>('map');
