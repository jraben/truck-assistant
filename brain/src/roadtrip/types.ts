// Road-trip shapes shared by the brain and the UI. Pure types: no Node APIs.
import type { CurvePoint, RateSample } from './curve.ts';
import type { PlanResult } from './planner.ts';
import type { Coach } from './coach.ts';

export type { Coach, CoachState } from './coach.ts';
export type { Backup, PlanResult, PlanStop } from './planner.ts';
export type { CurvePoint } from './curve.ts';

export type LatLon = { lat: number; lon: number };

/** How long a stop lasts unless you say (minutes): a meal, a visit, a night. */
export const STAY_BY_KIND: Record<string, number> = { restaurant: 60, friend: 180, hotel: 600, home: 600, work: 60, other: 30 };

/** A stop along the way: a restaurant, a friend's house, a hotel. Charging there while you stay counts. */
export type TripWaypoint = { name: string; lat: number; lon: number; placeId: number | null; kind: string | null; stayMin: number; chargeKw: number | null };
/** The same stop in a plan: when you get there and leave, and the charge in and out. */
export type PlannedWaypoint = TripWaypoint & { routeMi: number; arriveAt: string; departAt: string; arriveSoc: number; departSoc: number };

export type Destination = { name: string; lat: number; lon: number; placeId?: number; kind?: string | null; chargeKw?: number | null;
  /** From a synced address book: the contact, their numbers and address. */
  contactId?: number; phones?: { number: string; label: string }[]; address?: string | null };

export type TripPreset = { name: string; from: LatLon & { name: string }; to: LatLon & { name: string }; startSoc: number };

/** One charging-rate reading (charge_samples). */
export type SampleRow = RateSample & { at: string; lat: number | null; lon: number | null; sessionId: number | null; simulated: boolean };

export type TripPlan = {
  id: string;
  createdAt: string;
  from: LatLon & { name: string | null };
  to: LatLon & { name: string };
  startSoc: number;
  routeMiles: number;
  routeMinutes: number;
  routeSource: 'osrm' | 'straight';
  elevation: boolean;
  candidates: number;
  warnings: string[];
  /** Stops along the way, in order (empty for a straight trip). */
  via: PlannedWaypoint[];
  result: PlanResult;
  /** The same trip in the driver's gas comparison vehicle (the payoff tracker's), at today's gas price; null when unknown. */
  gas: { label: string; mpg: number; pricePerGallon: number; gallons: number; cost: number } | null;
};

export type TripAlert = { id: number; at: string; kind: 'switched' | 'replanned' | 'full' | 'info'; message: string };
export type TripProgress = { routeMi: number; milesLeft: number; offRouteMi: number; onRoute: boolean; nextStop: number | null; atStop: boolean; nextArriveSoc: number | null };

export type RoadTripView = {
  draft: TripPlan | null;
  active: TripPlan | null;
  progress: TripProgress | null;
  coach: Coach | null;
  alerts: TripAlert[];
  /** Saved places (and the demo's towns), with what they are and any charging there: destinations and stops. */
  destinations: Destination[];
  presets: TripPreset[];
  curve: { learnedBins: number; samples: number; points: CurvePoint[] };
};

/** The bit of the trip the top banner needs, in State. */
export type RoadTripBrief = {
  to: string;
  nextStop: { name: string; arriveSoc: number; departSoc: number; arriveAt: string } | null;
  alert: TripAlert | null;
  coach: { state: Coach['state']; message: string } | null;
} | null;
