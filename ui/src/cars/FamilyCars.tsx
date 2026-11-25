// The Family cars screen: every family car on one map, with a card each (where, battery,
// fuel, check-engine codes in plain English). Data: /api/cars (brain/src/cars/familyCars.ts),
// read from the Traccar server. docs/plans/plan-family-cars.md.
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef, useState } from 'preact/hooks';
import { api } from '../lib/brain.ts';
import type { WP } from '../components/drive.tsx';
import type { FamilyCar, FamilyCarsReport } from '../../../brain/src/cars/familyCars.ts';
import { cleanLayer } from '../lib/basemap.ts';
import { isLight } from '../lib/theme.ts';
import { explainCode } from '../gauges/logic.ts';
import { ago } from './views.ts';
import './cars.css';

const cssVar = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

function useCars(): [FamilyCarsReport | null, () => void] {
  const [r, setR] = useState<FamilyCarsReport | null>(null);
  const load = (refresh = false) => void api<FamilyCarsReport>(`/api/cars${refresh ? '?refresh=1' : ''}`).then(setR, (e: Error) => setR({ configured: true, cars: [], error: e.message, fetchedAt: null }));
  useEffect(() => { load(); const t = setInterval(() => load(), 30_000); return () => clearInterval(t); }, []);
  return [r, () => load(true)];
}

function CarsMap({ cars, focus }: { cars: FamilyCar[]; focus: number | null }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  useEffect(() => {
    const m = L.map(el.current!, { zoomControl: true, attributionControl: true, center: [33.45, -112.07], zoom: 10 });
    cleanLayer(!isLight(cssVar('--bg') || '#000000')).addTo(m);
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    const ro = new ResizeObserver(() => m.invalidateSize()); ro.observe(el.current!);
    return () => { ro.disconnect(); m.remove(); };
  }, []);
  const placed = cars.filter((c) => c.lat !== null && c.lon !== null);
  const key = placed.map((c) => `${c.id}:${c.lat}:${c.lon}:${c.warnings.length}`).join('|');
  useEffect(() => {
    const m = map.current, g = layer.current;
    if (!m || !g) return;
    g.clearLayers();
    for (const c of placed) {
      const tone = c.warnings.length ? 'bad' : c.moving ? 'go' : 'ok';
      const icon = L.divIcon({ className: '', html: `<div class="fc-pin ${tone}"><span>${c.name.replace(/[<>&"]/g, '').slice(0, 18)}</span></div>`, iconSize: [0, 0] });
      L.marker([c.lat!, c.lon!], { icon, keyboard: false }).addTo(g);
    }
    if (placed.length) m.fitBounds(L.latLngBounds(placed.map((c) => [c.lat!, c.lon!] as [number, number])).pad(0.25), { maxZoom: 14 });
  }, [key]);
  useEffect(() => { const c = cars.find((x) => x.id === focus); if (c?.lat != null && c.lon != null) map.current?.setView([c.lat, c.lon], 15, { animate: true }); }, [focus]);
  return <div class="fc-map" ref={el} />;
}

function CarCard({ c, onFocus }: { c: FamilyCar; onFocus: () => void }) {
  const state = c.moving ? `Driving${c.speedMph !== null ? ` · ${c.speedMph} mph` : ''}` : c.ignition ? 'On, parked' : 'Parked';
  const battTone = c.batteryV === null ? '' : c.batteryV < 11.9 ? 'bad' : c.batteryV < 12.2 ? 'warn' : 'ok';
  return (
    <div class={`fc-card ${c.warnings.length ? 'has-warn' : ''}`}>
      <div class="fc-head">
        <b>{c.name}</b>
        <span class={`fc-dot ${c.status}`} title={`Traccar: ${c.status}`} />
        <span class="dimtxt fc-seen">{ago(c.lastSeen)}</span>
      </div>
      <div class="fc-state">{state}</div>
      <div class="fc-stats">
        <span><small>BATTERY</small><b class={`num ${battTone}`}>{c.batteryV === null ? '—' : `${c.batteryV.toFixed(1)} V`}</b></span>
        <span><small>FUEL</small><b class="num">{c.fuelPct === null ? '—' : `${c.fuelPct}%`}</b></span>
        <span><small>ODOMETER</small><b class="num">{c.odometerMi === null ? '—' : `${c.odometerMi.toLocaleString()} mi`}</b></span>
      </div>
      {c.warnings.length > 0 && <ul class="fc-warn">{c.warnings.map((w) => <li>{w}</li>)}</ul>}
      {c.codes.length > 0 && (
        <div class="fc-codes">
          {c.codes.map((k) => { const m = explainCode(k.code); return (
            <div class="fc-code"><b class="num">{k.code}</b>{k.pending && <span class="tag dim">PENDING</span>}<span>{m.meaning}</span><small class="dimtxt">{m.area}</small></div>
          ); })}
        </div>
      )}
      <div class="fc-actions">
        {c.lat !== null && c.lon !== null && <button type="button" class="btn sm" onClick={onFocus}>Show on map</button>}
        {c.lat !== null && c.lon !== null && <a class="btn sm" href={`https://maps.google.com/?q=${c.lat},${c.lon}`} target="_blank" rel="noreferrer">Directions</a>}
      </div>
    </div>
  );
}

export function FamilyCarsView(_: WP) {
  const [r, refresh] = useCars();
  const [focus, setFocus] = useState<number | null>(null);
  if (!r) return <div class="family"><div class="card">Loading the family's cars…</div></div>;
  if (!r.configured) return (
    <div class="family"><div class="card fc-setup">
      <h2 class="sect">Family cars</h2>
      <p>Every family car's tracker reports to the Traccar server on the NAS. Connect it once and they all show here: where each car is, its battery, fuel and any check-engine codes in plain English.</p>
      <a class="btn primary" href="/settings#family-cars">Connect Traccar in Settings</a>
    </div></div>
  );
  return (
    <div class="family">
      <CarsMap cars={r.cars} focus={focus} />
      <div class="fc-list">
        <div class="fc-top"><b>{r.cars.length} {r.cars.length === 1 ? 'car' : 'cars'}</b><span class="dimtxt">{r.fetchedAt ? `updated ${ago(r.fetchedAt)}` : ''}</span><button type="button" class="btn sm" onClick={refresh}>Refresh</button></div>
        {r.error && <div class="fc-err">{r.error}</div>}
        {r.cars.length === 0 && !r.error && <p class="dimtxt">Traccar has no cars yet. Add each tracker as a device in Traccar (its id is the tracker's long random id).</p>}
        {r.cars.map((c) => <CarCard c={c} onFocus={() => setFocus(c.id === focus ? null : c.id)} />)}
      </div>
    </div>
  );
}

export const FAMILY_WIDGETS = { familyCars: FamilyCarsView };
