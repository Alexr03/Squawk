// Weather from the day's real METARs (or overrides), ATIS letter, low-visibility procedures, runway configuration choice.
import { NM } from './geo.ts';
import { DT, rand, ticks, type ShiftConfig, type State, type Weather } from './state.ts';
import type { Metar } from './types.ts';
import type { Apt, World } from './world.ts';

export function metarAt(metars: Metar[], unix: number): Metar | null {
  let best: Metar | null = null;
  for (const m of metars) { if (m.time <= unix) best = m; else break; }
  return best ?? metars[0] ?? null;
}

export function initialWeather(cfg: ShiftConfig, st: State): Weather {
  const day = cfg.days[0];
  const m = day ? metarAt(day.metars, cfg.start) : null;
  const w: Weather = {
    wind: cfg.weather?.wind ?? m?.wind ?? { dir: 240 + Math.round(rand(st) * 4) * 10, kt: 6 + Math.floor(rand(st) * 10) },
    visM: cfg.weather?.visM ?? m?.visM ?? 10000,
    ceilingFt: cfg.weather?.ceilingFt !== undefined ? cfg.weather.ceilingFt : m?.ceilingFt ?? null,
    qnh: m?.qnh ?? 1013, tempC: m?.tempC ?? 12,
    wx: cfg.weather?.wx ?? m?.wx ?? [],
    atis: String.fromCharCode(65 + Math.floor(rand(st) * 20)),
    cells: [], lvp: false,
  };
  w.lvp = w.visM < 600 || (w.ceilingFt !== null && w.ceilingFt < 200);
  return w;
}

/** Re-read the METAR every 10 minutes; new observation -> new ATIS letter. */
export function updateWeather(world: World, cfg: { days: ShiftConfig['days']; weather?: ShiftConfig['weather'] }, st: State) {
  if (st.tick % ticks(60) !== 0) return;
  const day = cfg.days[0];
  if (day && !cfg.weather) {
    const m = metarAt(day.metars, st.start + st.tick * DT);
    if (m && (m.wind.dir !== st.weather.wind.dir || m.wind.kt !== st.weather.wind.kt || m.visM !== st.weather.visM)) {
      const wasLvp = st.weather.lvp;
      Object.assign(st.weather, { wind: m.wind, visM: m.visM, ceilingFt: m.ceilingFt, qnh: m.qnh, tempC: m.tempC, wx: m.wx });
      st.weather.lvp = m.visM < 600 || (m.ceilingFt !== null && m.ceilingFt < 200);
      st.weather.atis = String.fromCharCode(65 + ((st.weather.atis.charCodeAt(0) - 64) % 26));
      if (st.weather.lvp !== wasLvp) st.alerts.push({ tick: st.tick, level: 'info', text: st.weather.lvp ? 'Low visibility procedures in force' : 'Low visibility procedures cancelled' });
      st.alerts.push({ tick: st.tick, level: 'info', text: `Information ${st.weather.atis}: wind ${String(m.wind.dir).padStart(3, '0')}/${m.wind.kt}, visibility ${m.visM >= 9999 ? '10 km' : m.visM + ' m'}, QNH ${m.qnh}` });
    }
  }
  // Thunderstorm cells drift with the wind.
  const thunder = st.weather.wx.some(x => x.includes('TS') || x.includes('CB'));
  if (thunder && st.weather.cells.length < 4 && rand(st) < 0.3) {
    const a = rand(st) * Math.PI * 2, r = (15 + rand(st) * 25) * NM;
    const to = (st.weather.wind.dir + 180) * Math.PI / 180, v = st.weather.wind.kt * 1.2 * NM / 3600;
    st.weather.cells.push({ x: world.primary.offset.x + Math.sin(a) * r, y: world.primary.offset.y + Math.cos(a) * r, r: (2 + rand(st) * 3) * NM, intensity: 0.5 + rand(st) * 0.5, vx: Math.sin(to) * v, vy: Math.cos(to) * v });
  }
  for (const c of st.weather.cells) { c.x += c.vx * 60; c.y += c.vy * 60; c.intensity -= 0.01; }
  st.weather.cells = st.weather.cells.filter(c => c.intensity > 0.15);
}

/** Pick the runway configuration that keeps landings into wind (westerly preferred when calm, as at Heathrow). */
export function chooseConfig(apt: Apt, wind: { dir: number; kt: number }, unix: number): number {
  const cfgs = apt.pack.configs;
  const tail = (c: { windDir: number }) => -wind.kt * Math.cos((wind.dir - c.windDir) * Math.PI / 180);
  let best = 0;
  for (let i = 0; i < cfgs.length; i++) if (tail(cfgs[i]) < tail(cfgs[best]) - 5) best = i;
  // Westerly preference: up to 5 kt tailwind is accepted on the westerly runways.
  const west = cfgs.findIndex(c => c.windDir > 180);
  if (west >= 0 && tail(cfgs[west]) <= 5) best = west;
  // Heathrow runway alternation: the westerly pair swaps landing/departure roles at 15:00 local.
  const alt = cfgs.findIndex((c, i) => i !== best && c.windDir === cfgs[best].windDir);
  if (alt >= 0 && localHour(unix) >= 15) best = alt;
  return best;
}
export function localHour(unix: number) {
  const d = new Date(unix * 1000);
  // UK: BST from last Sunday of March to last Sunday of October.
  const y = d.getUTCFullYear();
  const lastSun = (m: number) => { const t = new Date(Date.UTC(y, m + 1, 0)); return t.getUTCDate() - t.getUTCDay(); };
  const bst = d >= new Date(Date.UTC(y, 2, lastSun(2), 1)) && d < new Date(Date.UTC(y, 9, lastSun(9), 1));
  return (d.getUTCHours() + (bst ? 1 : 0)) % 24 + d.getUTCMinutes() / 60;
}
