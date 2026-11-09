// Traffic shapes shared by the brain and the screen. Pure types.

export type TrafficCamera = {
  key: string;            // "<state>:<id>"
  state: string;
  roadway: string | null;
  direction: string | null;
  location: string | null;
  lat: number; lon: number;
  views: { url: string; description: string | null }[];
};

export type TrafficEvent = {
  key: string;
  state: string;
  type: 'crash' | 'closure' | 'roadwork' | 'other';
  subType: string | null;
  roadway: string | null;
  direction: string | null;
  description: string | null;
  lat: number; lon: number;
  fullClosure: boolean;
  lanes: string | null;
  startsAt: string | null;
  endsAt: string | null;
  updatedAt: string | null;
};

export type EnforcementCam = { key: string; kind: 'speed' | 'red-light' | 'other'; lat: number; lon: number; maxspeed: string | null; name: string | null };

export type Ahead<T> = T & { distMi: number; onRoute: boolean };

export type TrafficStateStatus = { id: string; name: string; keyed: boolean; checked: boolean; error: string | null; cameras: number; events: number; camerasAt: string | null; eventsAt: string | null };

export type TrafficView = {
  cameras: Ahead<TrafficCamera>[];
  events: Ahead<TrafficEvent>[];
  enforcement: Ahead<EnforcementCam>[];
  states: TrafficStateStatus[];
  /** Why there's nothing (no key for this state, offline...). */
  message: string | null;
  following: 'route' | 'heading' | 'nearby';
};

export type TrafficBrief = { kind: 'crash' | 'closure' | 'camera'; text: string } | null;
