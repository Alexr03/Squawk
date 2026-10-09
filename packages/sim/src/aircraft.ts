// Aircraft type families: simplified performance plus the dimensions used to generate meshes.
import type { Wake } from './types.ts';

export interface AircraftType {
  name: string;               // "Airbus A320neo"
  wake: Wake;                 // ICAO category (J = A380 "Super")
  recat: 'A' | 'B' | 'C' | 'D' | 'E' | 'F'; // RECAT-EU category
  lengthM: number; spanM: number; heightM: number;
  engines: 2 | 3 | 4; engineMount: 'wing' | 'tail';
  tail: 'low' | 't';          // tailplane on the fuselage or on top of the fin
  vapp: number;               // final approach speed, kt
  vr: number;                 // rotation speed, kt
  accel: number;              // take-off roll, kt/s
  decel: number;              // landing rollout, kt/s
  climb: number;              // ft/min initial
  descent: number;            // ft/min typical
  cruise: number;             // kt TAS used for en-route legs
  taxi: number;               // kt
}

const t = (name: string, wake: Wake, recat: AircraftType['recat'], lengthM: number, spanM: number, heightM: number,
  engines: 2 | 3 | 4, vapp: number, vr: number, accel: number, decel: number, climb: number, cruise: number,
  extra: Partial<AircraftType> = {}): AircraftType => ({
  name, wake, recat, lengthM, spanM, heightM, engines, engineMount: 'wing', tail: 'low', vapp, vr, accel, decel,
  climb, descent: 2000, cruise, taxi: 18, ...extra,
});

// ponytail: rounded public figures per family; good enough for a sim, not for flight planning.
export const TYPES: Record<string, AircraftType> = {
  A319: t('Airbus A319', 'M', 'E', 33.8, 35.8, 11.8, 2, 132, 140, 4.6, 2.8, 2800, 450),
  A320: t('Airbus A320', 'M', 'E', 37.6, 35.8, 11.8, 2, 137, 145, 4.4, 2.7, 2600, 450),
  A20N: t('Airbus A320neo', 'M', 'E', 37.6, 35.8, 11.8, 2, 136, 145, 4.5, 2.7, 2700, 450),
  A321: t('Airbus A321', 'M', 'E', 44.5, 35.8, 11.8, 2, 142, 155, 4.0, 2.6, 2400, 450),
  A21N: t('Airbus A321neo', 'M', 'E', 44.5, 35.8, 11.8, 2, 141, 155, 4.1, 2.6, 2500, 450),
  BCS3: t('Airbus A220-300', 'M', 'E', 38.7, 35.1, 11.5, 2, 130, 135, 4.7, 2.9, 2900, 450),
  B738: t('Boeing 737-800', 'M', 'D', 39.5, 35.8, 12.5, 2, 145, 150, 4.2, 2.6, 2500, 450),
  B38M: t('Boeing 737 MAX 8', 'M', 'D', 39.5, 35.9, 12.3, 2, 144, 150, 4.3, 2.6, 2600, 450),
  E190: t('Embraer 190', 'M', 'E', 36.2, 28.7, 10.6, 2, 130, 135, 4.6, 2.9, 2800, 440),
  E195: t('Embraer 195', 'M', 'E', 38.7, 28.7, 10.6, 2, 132, 138, 4.4, 2.9, 2700, 440),
  AT76: t('ATR 72-600', 'M', 'F', 27.2, 27.1, 7.7, 2, 115, 110, 3.6, 2.8, 1800, 270, { tail: 't' }),
  DH8D: t('Dash 8-400', 'M', 'E', 32.8, 28.4, 8.3, 2, 125, 120, 3.8, 2.8, 2200, 340, { tail: 't' }),
  B752: t('Boeing 757-200', 'M', 'D', 47.3, 38.1, 13.6, 2, 135, 145, 4.6, 2.6, 3000, 460),
  B763: t('Boeing 767-300', 'H', 'C', 54.9, 47.6, 15.9, 2, 140, 155, 3.6, 2.4, 2400, 470),
  A332: t('Airbus A330-200', 'H', 'B', 58.8, 60.3, 17.4, 2, 138, 150, 3.5, 2.4, 2300, 470),
  A333: t('Airbus A330-300', 'H', 'B', 63.7, 60.3, 16.8, 2, 140, 155, 3.4, 2.4, 2200, 470),
  A339: t('Airbus A330-900', 'H', 'B', 63.7, 64.0, 16.8, 2, 140, 155, 3.5, 2.4, 2300, 470),
  A359: t('Airbus A350-900', 'H', 'B', 66.8, 64.8, 17.1, 2, 140, 155, 3.6, 2.4, 2400, 485),
  A35K: t('Airbus A350-1000', 'H', 'B', 73.8, 64.8, 17.1, 2, 145, 165, 3.3, 2.3, 2200, 485),
  B772: t('Boeing 777-200', 'H', 'B', 63.7, 60.9, 18.5, 2, 140, 160, 3.2, 2.3, 2000, 480),
  B77W: t('Boeing 777-300ER', 'H', 'B', 73.9, 64.8, 18.5, 2, 149, 170, 3.2, 2.3, 2000, 485),
  B788: t('Boeing 787-8', 'H', 'B', 56.7, 60.1, 17.0, 2, 140, 150, 3.7, 2.4, 2500, 485),
  B789: t('Boeing 787-9', 'H', 'B', 62.8, 60.1, 17.0, 2, 145, 160, 3.5, 2.4, 2400, 485),
  B78X: t('Boeing 787-10', 'H', 'B', 68.3, 60.1, 17.0, 2, 148, 165, 3.3, 2.3, 2200, 485),
  B744: t('Boeing 747-400', 'H', 'B', 70.7, 64.4, 19.4, 4, 155, 170, 3.0, 2.2, 1800, 490),
  B748: t('Boeing 747-8', 'H', 'A', 76.3, 68.4, 19.4, 4, 155, 170, 3.0, 2.2, 1800, 490),
  A388: t('Airbus A380-800', 'J', 'A', 72.7, 79.8, 24.1, 4, 145, 155, 2.8, 2.1, 1600, 490),
};

export const KNOWN_TYPES = Object.keys(TYPES);

const SIZE: Record<string, number> = { L: 0, M: 1, H: 2, J: 3 };
/** Can a stand built for aircraft up to `maxWake` take one of this wake category? */
export const standFits = (maxWake: string, wake: string | undefined) => (SIZE[wake ?? 'M'] ?? 1) <= (SIZE[maxWake] ?? 3);
