import { store } from '../lib/brain.ts';

/** The Weather view is an overlay over any screen, opened from the top strip or the Drive temperature. */
export const weatherOpenStore = store(false);
export const openWeather = () => weatherOpenStore.set(true);
export const closeWeather = () => weatherOpenStore.set(false);
