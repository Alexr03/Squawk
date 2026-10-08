// Shared contracts: airport packs, day packs, commands and radio messages.
// Positions are metres in a local east (x) / north (y) frame centred on the airport ARP.
// Altitudes are feet, speeds knots, headings degrees (true unless named otherwise).

export type Seat = 'DEL' | 'GND' | 'TWR' | 'DIR' | 'LON';
export const SEATS: Seat[] = ['DEL', 'GND', 'TWR', 'DIR', 'LON'];
export type Wake = 'L' | 'M' | 'H' | 'J';
export interface XY { x: number; y: number }
export interface LatLon { lat: number; lon: number }
export interface Wind { dir: number; kt: number; gust?: number }

// ---------------------------------------------------------------- airport pack

export interface AirportPack {
  icao: string;
  name: string;               // "London Heathrow"
  rtName: string;             // radio prefix: "Heathrow" -> "Heathrow Tower"
  airac: string;              // AIRAC cycle the hand corrections were checked against, e.g. "2610"
  sources: string[];          // attribution lines shown in game (OSM ODbL etc.)
  arp: LatLon;                // origin of the local frame
  elevationFt: number;
  transitionAltFt: number;
  magVar: number;             // degrees, east positive; magnetic = true - magVar
  frequencies: Frequency[];
  runways: RunwayPack[];
  taxi: { nodes: TaxiNode[]; edges: TaxiEdge[] };
  stands: Stand[];
  surfaces: { kind: 'apron' | 'taxiway' | 'runway'; poly: XY[] }[];
  buildings: { kind: 'terminal' | 'hangar' | 'tower' | 'building'; poly: XY[]; heightM: number; name?: string }[];
  airlineTerminals: Record<string, string>; // airline ICAO -> terminal ("BAW" -> "5")
  airspace: Airspace;
  /** Runway configurations the airport uses, most common first. */
  configs: RunwayConfig[];
  fireStation?: XY;
}

export interface Frequency { seat: Seat; sector?: string; callsign: string; freq: string }

export interface RunwayEnd {
  name: string;               // "27R"
  thr: XY;                    // landing threshold (after any displacement)
  end: XY;                    // physical start of this direction's take-off run
  hdgTrue: number;
  elevationFt: number;
  ils?: { freq: string; gsDeg: number };
}
export interface RunwayPack {
  name: string;               // "09L/27R"
  ends: [RunwayEnd, RunwayEnd];
  widthM: number;
  lengthM: number;
}

export interface TaxiNode {
  id: number;
  x: number; y: number;
  hold?: string;              // holding point ref ("A1", "N3")
  holdRunway?: string;        // the runway end this hold protects ("27L")
  stand?: string;             // stand ref when this node is a stand
}
export interface TaxiEdge {
  a: number; b: number;       // node ids
  name: string;               // taxiway ref ("A", "B2"); "" for unnamed apron lanes
  runway?: string;            // runway pair name if the segment lies on a runway
  lengthM: number;
}
export interface Stand {
  ref: string;                // "512"
  node: number;               // taxi node at the stand
  pushNode: number;           // taxilane node the aircraft is pushed back onto
  terminal: string;           // "5", "3", "Cargo"
  x: number; y: number;
  hdg: number;                // nose-in heading (true)
  maxWake: Wake;
}

export interface Fix extends LatLon, XY { name: string; spoken?: string }
export interface Airspace {
  fixes: Record<string, Fix>;
  stacks: { name: string; fix: string; inboundTrack: number; turn: 'L' | 'R'; minAltFt: number; sector: string }[];
  /** Standard departures by runway end. */
  sids: { name: string; designator: string; runway: string; fixes: string[]; initialAltFt: number }[];
  /** Arrival routes from the edge of the map into a stack. */
  stars: { name: string; stack: string; fixes: string[]; entryAltFt: number }[];
  ctr: XY[];                  // control zone polygon
  tmaRadiusNm: number;        // radius the Director scope works
  areaRadiusNm: number;       // radius London Control works
  /** Map underlay lines for the radar view (coastline, rivers, motorways), local metres. */
  map: { kind: 'coast' | 'river' | 'motorway' | 'border'; pts: XY[] }[];
}

export interface RunwayConfig {
  name: string;               // "Westerly A"
  arrivals: string[];         // runway ends used for landing
  departures: string[];       // runway ends used for departure
  /** Direction the config suits: landings into a wind from roughly this heading. */
  windDir: number;
}

// ---------------------------------------------------------------- day pack

export interface DayPack {
  id: string;                 // "EGLL-2025-09-19"
  airport: string;            // "EGLL"
  date: string;               // "2025-09-19"
  label: string;              // "Fri 19 Sep 2025 — summer Friday peak"
  tags: string[];             // "summer", "easterly", "fog", "night"
  sources: string[];
  metars: Metar[];
  flights: Flight[];
  substitutions: string[];    // pipeline log of unknown types mapped to families
}
export interface Metar {
  time: number;               // unix seconds
  raw: string;
  wind: Wind;
  visM: number;
  ceilingFt: number | null;
  qnh: number;
  tempC: number;
  wx: string[];               // METAR weather groups: "RA", "+TSRA", "FG"...
}
export interface Flight {
  cs: string;                 // ICAO callsign "BAW12A"
  icao24?: string;
  type: string;               // ICAO type designator, already mapped to a known family
  operator: string;           // airline ICAO
  kind: 'arr' | 'dep';
  time: number;               // unix seconds: actual landing (arr) or take-off (dep)
  other: string;              // origin (arr) or destination (dep) ICAO
  stand?: string;
}

// ---------------------------------------------------------------- commands

/** What a controller can say. Sim fills the optional display fields (wind, qnh, freq...) when issuing. */
export type Command =
  | { cs: string; verb: 'clearance'; dest?: string; sid: string; alt: number; squawk: string }
  | { cs: string; verb: 'push'; face?: 'N' | 'S' | 'E' | 'W' }
  | { cs: string; verb: 'taxi'; to: string; via: string[]; holdShort?: string; nodes?: number[] }
  | { cs: string; verb: 'greens'; to: string; nodes?: number[] }
  | { cs: string; verb: 'holdshort'; at: string }
  | { cs: string; verb: 'continue' }
  | { cs: string; verb: 'giveway'; other: string }
  | { cs: string; verb: 'cross'; runway: string }
  | { cs: string; verb: 'luw'; runway: string }
  | { cs: string; verb: 'cto'; runway: string; wind?: Wind }
  | { cs: string; verb: 'land'; runway: string; wind?: Wind }
  | { cs: string; verb: 'goaround' }
  | { cs: string; verb: 'heading'; hdg: number; turn?: 'L' | 'R' }
  | { cs: string; verb: 'alt'; alt: number; qnh?: number; climb?: boolean }
  | { cs: string; verb: 'speed'; kt: number | null }
  | { cs: string; verb: 'direct'; fix: string }
  | { cs: string; verb: 'hold'; fix: string }
  | { cs: string; verb: 'ils'; runway: string }
  | { cs: string; verb: 'contact'; seat: Seat; unit?: string; freq?: string }
  | { cs: string; verb: 'negative' }   // "negative, I say again ..." — repeats the last instruction to fix a wrong readback
  | { cs: string; verb: 'sayagain' }   // ask the pilot to repeat their last call
  | { cs: string; verb: 'unable' }     // decline the pilot's request
  | { cs: string; verb: 'resume' };    // resume own navigation (SID / STAR)
export type Verb = Command['verb'];

// ---------------------------------------------------------------- radio

export type Nature = 'engine' | 'medical' | 'fuel' | 'birdstrike' | 'tyre' | 'pressurisation';
export type PilotCall =
  | { k: 'clearance'; stand: string; type: string; atis: string; dest: string }
  | { k: 'push'; stand: string }
  | { k: 'taxi'; stand?: string }
  | { k: 'ready'; hold: string; runway: string }
  | { k: 'checkin'; alt: number; cleared?: number; hdg?: number; route?: string; atis?: string; nm?: number; runway?: string }
  | { k: 'vacated'; runway: string; stand?: string }
  | { k: 'goingaround' }
  | { k: 'request'; what: 'direct'; fix: string }
  | { k: 'request'; what: 'climb' | 'descend'; alt: number }
  | { k: 'request'; what: 'runway'; runway: string }
  | { k: 'mayday' | 'panpan'; nature: Nature; souls: number; intent: string }
  | { k: 'holding'; fix: string }
  | { k: 'established'; runway: string }
  | { k: 'sayagain' }
  | { k: 'unable'; why: string };

export type Msg =
  | { t: 'atc'; cmds: Command[] }
  | { t: 'readback'; cmds: Command[] }      // may contain a wrong value (readback error)
  | { t: 'call'; call: PilotCall };

export interface Radio {
  id: number;
  tick: number;
  airport: string;
  seat: Seat;                 // frequency it went out on
  cs: string;
  from: 'atc' | 'pilot';
  msg: Msg;
  auto?: boolean;             // sent by an AI controller
  light?: boolean;            // radio failure: shown as a light signal / wing rock
}

// ---------------------------------------------------------------- render views

/** What the renderer needs per aircraft each frame. Positions in the primary airport's local frame. */
export interface AircraftView {
  cs: string;
  type: string;               // key into TYPES (aircraft.ts)
  operator: string;           // key into AIRLINES (airlines.ts)
  wake: Wake;
  x: number; y: number;       // metres
  alt: number;                // ft above mean sea level
  hdg: number;                // degrees true, nose direction
  gs: number;                 // kt
  vs: number;                 // ft/min
  onGround: boolean;
  lights: { beacon: boolean; nav: boolean; strobe: boolean; landing: boolean; taxi: boolean };
  tug: boolean;               // pushback tug attached
  mine: boolean;              // on one of the player's frequencies (radar colour)
  alert: 'none' | 'caution' | 'conflict' | 'emergency';
  squawk: string;
  clearedAlt: number | null;
  trail: XY[];                // recent positions, newest last (radar history dots)
  tag: string[];              // radar data block lines, prepared upstream
}
export interface VehicleView { id: string; kind: 'fire' | 'followme' | 'tug'; x: number; y: number; hdg: number; lights: boolean }
