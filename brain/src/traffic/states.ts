// State and provincial 511 traveller-information sites that share one API
// (a developer key, /api/v2/get/cameras and /api/v2/get/event, ten calls a
// minute). Pure: the settings page lists these too.
//
// `checked`: the endpoint pages were read and match Arizona's (2026-11-08).
// The rest show the same developer page (same key, same throttling) but their
// endpoint pages weren't confirmed; a mismatch shows as that state's error.

export type State511 = {
  id: string;
  name: string;
  /** Site root; the API is <base>/api/v2/get/... */
  base: string;
  /** Rough box the state covers: [south, west, north, east]. */
  bbox: [number, number, number, number];
  checked: boolean;
};

export const STATES_511: State511[] = [
  { id: 'az', name: 'Arizona (AZ511)', base: 'https://az511.com', bbox: [31.3, -114.9, 37.0, -109.0], checked: true },
  { id: 'wi', name: 'Wisconsin (511WI)', base: 'https://511wi.gov', bbox: [42.4, -92.9, 47.1, -86.2], checked: true },
  { id: 'ut', name: 'Utah (UDOT Traffic)', base: 'https://www.udottraffic.utah.gov', bbox: [36.9, -114.1, 42.0, -109.0], checked: false },
  { id: 'nv', name: 'Nevada (NVroads)', base: 'https://www.nvroads.com', bbox: [35.0, -120.0, 42.0, -114.0], checked: false },
  { id: 'id', name: 'Idaho (511)', base: 'https://511.idaho.gov', bbox: [42.0, -117.3, 49.0, -111.0], checked: false },
  { id: 'ga', name: 'Georgia (511GA)', base: 'https://511ga.org', bbox: [30.3, -85.7, 35.0, -80.8], checked: false },
  { id: 'la', name: 'Louisiana (511LA)', base: 'https://511la.org', bbox: [28.9, -94.1, 33.1, -88.8], checked: false },
  { id: 'ak', name: 'Alaska (511)', base: 'https://511.alaska.gov', bbox: [51.0, -180.0, 71.5, -129.9], checked: false },
  { id: 'on', name: 'Ontario (511ON)', base: 'https://511on.ca', bbox: [41.6, -95.2, 56.9, -74.3], checked: false },
];

export const STATE_IDS = STATES_511.map((s) => s.id);

/** Which states' boxes a point falls in. */
export function statesAt(lat: number, lon: number): State511[] {
  return STATES_511.filter((s) => lat >= s.bbox[0] && lat <= s.bbox[2] && lon >= s.bbox[1] && lon <= s.bbox[3]);
}

/** Where to get a key: register, log in, then request one on the developer page. */
export const keyUrl = (s: State511) => `${s.base}/developers/doc`;
