// Track A (drive and the road) shapes. docs/contract.md "Track A: Drive" is the
// source of truth; change it there first. Pure types, shared with the UI.

export type RangeMode = 'city' | 'highway';
export type RangeOverride = 'auto' | RangeMode;

export const SPEEDO_STYLES = ['digital', 'sweep', 'fifty-seven', 'ribbon', 'minimal'] as const;
export type SpeedoStyle = (typeof SPEEDO_STYLES)[number];

/** Truck-level: what the truck looks like (the tilt drawing) and what is fitted. */
export type TruckLook = {
  colors: {
    body: string;        // #rrggbb: the wrap (Toolbox Red)
    roof: string;        // partial roof wrap (Clean Slate)
    logo: string;        // SLATE logo decals (Tar Pit)
    wheelDecal: string;  // decal on the steel wheel face (Clean Slate)
    lampPlates: string;  // #rrggbb, or "synthwave" (the gradient plate)
    trim: string;        // the unwrapped polypropylene: bumpers, flares, sills
  };
  finish: 'satin' | 'gloss' | 'matte';
  roofWrap: boolean;     // false = roof in the body colour
  wheels: { inches: 17; style: 'steel' };
  accessories: { tonneau: 'none' | 'nexus-flip'; hitch: boolean; bedLights: boolean };
};

/** Truck-level drive settings. */
export type DriveSettings = {
  highwayMph: number;                     // 2-minute average at or over this = highway (default 45)
  efficiency: { cityMiPerKwh: number; highwayMiPerKwh: number; alpha: number };  // seeds + EWMA weight per learned window
  tilt: { warnDeg: number; dangerDeg: number };   // amber / red (20 / 30)
  heat: { throttleC: number; warnC: number; shutdownC: number; parkedSunF: number };
  brightness: { auto: boolean; manualPct: number; minPct: number; maxPct: number; nightMaxPct: number };
  speedLimits: boolean;                   // look limits up on OpenStreetMap (online only)
  lockoutMph: number;                     // over this, video/browser/long lists pause (default 5)
};

/** Per-driver drive prefs. */
export type DriverDrive = {
  speedo: 'auto' | SpeedoStyle;           // auto = the theme's pairing, else digital
  overLimitWarn: boolean;
  overLimitMph: number;                   // tolerance before the warning (default 5)
};

export type SinceCharge = {
  since: string;                          // when the last charge session ended
  sessionId: number;
  miles: number;
  kwh: number;                            // estimate until CAN
  kwhSource: 'soc' | 'miles';             // from the SoC drop (CAN only), or miles / per-mode efficiency
  miPerKwh: number | null;
  pctUsed: number | null;                 // SoC points since the charge (CAN), else kWh as a share of the pack
  costPerMile: number | null;             // that charge's $/kWh x kWh used / miles
};

export type WeatherIcon = 'clear' | 'few' | 'partly' | 'cloudy' | 'fog' | 'haze' | 'smoke' | 'dust' | 'wind' | 'rain' | 'showers' | 'storm' | 'snow' | 'sleet' | 'hot' | 'cold' | 'unknown';

export type WeatherAlert = {
  id: string; event: string; headline: string | null;
  severity: 'Extreme' | 'Severe' | 'Moderate' | 'Minor' | 'Unknown';
  onset: string | null; expires: string | null;
  polygon: [number, number][][] | null;   // [lat, lon] rings; null = zone-wide (no polygon)
};

export type WeatherHour = { t: string; tempF: number | null; icon: WeatherIcon; condition: string; popPct: number | null; windMph: number | null; isDay: boolean };

export type WeatherReport = {
  source: 'nws' | 'open-meteo';
  fetchedAt: string;
  lat: number; lon: number;
  place: string | null;                   // stops naming chain, else the nearest town
  current: { tempF: number | null; condition: string; icon: WeatherIcon; isDay: boolean; windMph: number | null; windDir: string | null; observedAt: string | null };
  today: { highF: number | null; lowF: number | null };
  hourly: WeatherHour[];                  // next 12 hours
  sun: { rise: string | null; set: string | null };
  alerts: WeatherAlert[];
};

/** The one-line strip on the cockpit (part of State.drive). */
export type WeatherBrief = {
  place: string | null; tempF: number | null; icon: WeatherIcon; condition: string; isDay: boolean;
  highF: number | null; lowF: number | null; windMph: number | null; windDir: string | null;
  fetchedAt: string; stale: boolean;      // stale: older than 45 min (offline or failing)
  alerts: { event: string; severity: WeatherAlert['severity']; expires: string | null }[];
};

export type SpeedLimit = { mph: number | null; raw: string | null; road: string | null; wayId: number; at: string };

export type HeatLevel = 'ok' | 'throttle' | 'warn' | 'shutdown';

export type DriveState = {
  mode: RangeMode; override: RangeOverride;
  avgMph2min: number | null;
  efficiency: { city: number; highway: number; learnedMiles: { city: number; highway: number } };
  range: { city: number | null; highway: number | null; current: number | null };
  sinceCharge: SinceCharge | null; sinceChargeWhy: string | null;
  speedLimit: SpeedLimit | null; speedLimitWhy: string | null;
  weather: WeatherBrief | null; weatherWhy: string | null;
  lockout: { locked: boolean; bigTargets: boolean };
  heat: { cpuC: number | null; source: 'thermal' | 'vcgencmd' | 'sim' | null; level: HeatLevel; parkedInSun: boolean; message: string | null };
  brightness: { pct: number | null; auto: boolean; lux: number | null; night: boolean; backend: 'ddcutil' | 'sysfs' | 'sim' | 'none'; error: string | null };
  tilt: { warnDeg: number; dangerDeg: number; level: 'ok' | 'warn' | 'danger' | null };
};
