// Baked data packs (served as static assets by Vite, fetched on demand).
import type { AirportPack, DayPack } from '@squawk/sim/types';
import dayIndex from '../../../../data/days/index.json';

const airportUrls = import.meta.glob('../../../../data/airports/*/airport.json', { query: '?url', import: 'default', eager: true }) as Record<string, string>;
const dayUrls = import.meta.glob('../../../../data/days/*-*.json', { query: '?url', import: 'default', eager: true }) as Record<string, string>;

const AIRPORT_NAMES: Record<string, string> = { EGLL: 'London Heathrow', EGKK: 'London Gatwick', EGSS: 'London Stansted', EGGW: 'London Luton', EGLC: 'London City' };

export interface DayInfo { id: string; airport: string; date: string; label: string; tags: string[]; flights: number }
export const DAYS: DayInfo[] = dayIndex as DayInfo[];

export const AIRPORTS: { icao: string; name: string }[] = Object.keys(airportUrls)
  .map(p => p.match(/airports\/(\w{4})\//)![1])
  .map(icao => ({ icao, name: AIRPORT_NAMES[icao] ?? icao }));

const cache = new Map<string, Promise<unknown>>();
function load<T>(url: string): Promise<T> {
  if (!cache.has(url)) cache.set(url, fetch(url).then(r => { if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.json(); }));
  return cache.get(url) as Promise<T>;
}

export function loadAirport(icao: string): Promise<AirportPack> {
  const key = Object.keys(airportUrls).find(k => k.includes(`/airports/${icao}/`));
  if (!key) return Promise.reject(new Error(`No airport pack for ${icao}`));
  return load<AirportPack>(airportUrls[key]);
}
export function loadDay(id: string): Promise<DayPack> {
  const key = Object.keys(dayUrls).find(k => k.endsWith(`/${id}.json`));
  if (!key) return Promise.reject(new Error(`No day pack ${id}`));
  return load<DayPack>(dayUrls[key]);
}

export const daysFor = (icao: string) => DAYS.filter(d => d.airport === icao);
