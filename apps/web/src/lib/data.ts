// Baked data packs (served as static assets by Vite, fetched on demand).
import type { AirportPack, DayPack } from '@squawk/sim/types';
import { decodeScenery, type SceneryFile } from '@squawk/render';
import dayIndex from '../../../../data/days/index.json';
import { madeUpDay } from './madeup.ts';

const airportUrls = import.meta.glob('../../../../data/airports/*/airport.json', { query: '?url', import: 'default', eager: true }) as Record<string, string>;
const sceneryUrls = import.meta.glob('../../../../data/airports/*/scenery.json', { query: '?url', import: 'default', eager: true }) as Record<string, string>;
const dayUrls = import.meta.glob('../../../../data/days/*-*.json', { query: '?url', import: 'default', eager: true }) as Record<string, string>;

const ORDER = ['EGLL', 'EGKK', 'EGSS', 'EGGW', 'EGLC']; // busiest first
const AIRPORT_NAMES: Record<string, string> = { EGLL: 'London Heathrow', EGKK: 'London Gatwick', EGSS: 'London Stansted', EGGW: 'London Luton', EGLC: 'London City' };

export interface DayInfo { id: string; airport: string; date: string; label: string; tags: string[]; flights: number }
const REAL_DAYS = dayIndex as DayInfo[];
/** The real day a made-up day borrows its traffic mix (and date) from: the busiest one. */
const templateFor = (icao: string) => REAL_DAYS.filter(d => d.airport === icao).sort((a, b) => +b.tags.includes('peak') - +a.tags.includes('peak') || b.flights - a.flights)[0];
const MADE_UP: DayInfo[] = [...new Set(REAL_DAYS.map(d => d.airport))].map(icao => {
  const t = templateFor(icao);
  return { id: `${icao}-madeup`, airport: icao, date: t.date, label: 'Made-up day — new traffic every shift', tags: ['made up', 'summer'], flights: t.flights };
});
export const DAYS: DayInfo[] = [...MADE_UP, ...REAL_DAYS];
export const isMadeUp = (id: string | null | undefined) => !!id?.endsWith('-madeup');

export const AIRPORTS: { icao: string; name: string }[] = Object.keys(airportUrls)
  .map(p => p.match(/airports\/(\w{4})\//)![1])
  .map(icao => ({ icao, name: AIRPORT_NAMES[icao] ?? icao }))
  .sort((a, b) => (ORDER.indexOf(a.icao) + 1 || 99) - (ORDER.indexOf(b.icao) + 1 || 99));

const cache = new Map<string, Promise<unknown>>();
function load<T>(url: string): Promise<T> {
  // A failed load isn't kept: trying again from the menu fetches it again.
  if (!cache.has(url)) cache.set(url, fetch(url).then(r => { if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.json(); }).catch(e => { cache.delete(url); throw e; }));
  return cache.get(url) as Promise<T>;
}

export function loadAirport(icao: string): Promise<AirportPack> {
  const key = Object.keys(airportUrls).find(k => k.includes(`/airports/${icao}/`));
  if (!key) return Promise.reject(new Error(`No airport pack for ${icao}`));
  // Scenery (surroundings + extra airside pavement) is optional and only used by the renderer.
  const sk = Object.keys(sceneryUrls).find(k => k.includes(`/airports/${icao}/`));
  const scenery = sk ? load<SceneryFile>(sceneryUrls[sk]).then(decodeScenery, () => undefined) : Promise.resolve(undefined);
  return Promise.all([load<AirportPack>(airportUrls[key]), scenery]).then(([p, s]) => (s ? { ...p, scenery: s } : p));
}
export async function loadDay(id: string, seed = 1): Promise<DayPack> {
  if (isMadeUp(id)) return madeUpDay(await loadDay(templateFor(id.slice(0, 4)).id), seed);
  const key = Object.keys(dayUrls).find(k => k.endsWith(`/${id}.json`));
  if (!key) return Promise.reject(new Error(`No day pack ${id}`));
  return load<DayPack>(dayUrls[key]);
}

export const daysFor = (icao: string) => DAYS.filter(d => d.airport === icao);
