// Road-trip shapes shared by the brain and the UI. Pure types: no Node APIs.
import type { CurvePoint, RateSample } from './curve.ts';
import type { PlanResult } from './planner.ts';
import type { Coach } from './coach.ts';

export type { Coach, CoachState } from './coach.ts';
export type { Backup, PlanResult, PlanStop } from './planner.ts';
export type { CurvePoint } from './curve.ts';

export type LatLon = { lat: number; lon: number };

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
  destinations: { name: string; lat: number; lon: number }[];
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
