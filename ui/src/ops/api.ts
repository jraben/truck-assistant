// Track D client helpers. Shapes come from the brain's pure ops/types.ts.
import { api } from '../lib/brain.ts';
export type { BackupStatus, BackupTarget, MaintEntry, MileageRate, MileageRow, MileageTotals, OpsConfig, PlaceTag, Purpose, Reminder, ReminderStatus, Release, TpmsPoint, UpdateStatus } from '../../../brain/src/ops/types.ts';
import type { MileageRow, MileageTotals, OpsConfig, MaintEntry, ReminderStatus } from '../../../brain/src/ops/types.ts';

export const PURPOSE_LIST = ['business', 'personal', 'commute', 'other'] as const;
export const PLACE_TAG_LIST = ['business', 'client', 'personal', 'commute'] as const;

export type MileageResp = { rows: MileageRow[]; totals: MileageTotals; period: string; config: OpsConfig['mileage']; odometerNow: number | null };
export type MaintResp = { log: MaintEntry[]; reminders: ReminderStatus[]; odometer: number | null; notifyService: string | null };
export type SetupResp = { done: boolean; steps: Record<string, 'done' | 'skipped'>; stepsList: string[]; passwordSet: boolean; apInitialPassword: string | null };
export type AuthStatus = { passwordSet: boolean; authed: boolean; local: boolean; trustLocal: boolean };

export const put = <T>(url: string, body: unknown) => api<T>(url, { method: 'PUT', body: JSON.stringify(body) });
export const post = <T>(url: string, body: unknown = {}) => api<T>(url, { method: 'POST', body: JSON.stringify(body) });

export function qs(o: Record<string, string | number | null | undefined>): string {
  const p = Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`);
  return p.length ? `?${p.join('&')}` : '';
}

/** Raw upload (receipt photo, backup file): the file itself as the body. */
export async function upload<T>(url: string, file: File | Blob, type?: string): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': type || (file as File).type || 'application/octet-stream' }, body: file });
  if (!res.ok) { let m = `${res.status}`; try { const b = await res.json(); if (b?.error) m = b.error; } catch { /* not json */ } throw new Error(m); }
  return (await res.json()) as T;
}

export const errText = (e: unknown) => (e as Error)?.message ?? String(e);
