// Decoder for data/airports/<ICAO>/scenery.json (written by tools/pipeline/scenery.ts).
import type { Scenery, SceneryAreaKind, SceneryRoadKind, XY } from '@squawk/sim/types';

export interface SceneryFile {
  v: 1;
  areas: [SceneryAreaKind, number[]][];
  roads: [SceneryRoadKind, number, number[]][];
  buildings: [number, number[]][];
}

/** Flat delta-encoded integers -> points. */
function pts(f: number[]): XY[] {
  const out: XY[] = [];
  let x = 0, y = 0;
  for (let i = 0; i < f.length; i += 2) { x += f[i]; y += f[i + 1]; out.push({ x, y }); }
  return out;
}

export function decodeScenery(raw: SceneryFile): Scenery {
  return {
    areas: raw.areas.map(([kind, f]) => ({ kind, poly: pts(f) })),
    roads: raw.roads.map(([kind, width, f]) => ({ kind, width, pts: pts(f) })),
    buildings: raw.buildings.map(([heightM, f]) => ({ kind: 'building' as const, heightM, poly: pts(f) })),
  };
}
