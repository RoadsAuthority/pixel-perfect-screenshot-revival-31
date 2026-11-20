export type LatLng = { lat: number; lng: number };
export type Coords = LatLng & { accuracy: number };

export function distanceKm(a: LatLng, b: LatLng): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

/**
 * Demo-only simulated positions, so a presenter standing at the venue can show a
 * patient reporting an emergency from somewhere else and moving. Always labelled
 * as a simulation in the UI and flagged `simulated` to the server.
 */
export type Simulation = { id: string; label: string; start: LatLng; heading: LatLng };
export const SIMULATIONS: Simulation[] = [
  { id: 'cbd', label: 'Windhoek CBD (Post Street Mall), walking', start: { lat: -22.5701, lng: 17.0838 }, heading: { lat: 0.00035, lng: -0.00022 } },
  { id: 'katutura', label: 'Katutura (Soweto Market), in a taxi', start: { lat: -22.5262, lng: 17.0592 }, heading: { lat: -0.0011, lng: 0.0006 } },
];

/** Position after `step` updates: a steady drift with a little jitter, like a real phone. */
export function simulatedPosition(sim: Simulation, step: number): Coords {
  const jitter = (n: number) => (Math.sin(step * 1.7 + n) * 0.00008);
  return {
    lat: sim.start.lat + sim.heading.lat * step + jitter(1),
    lng: sim.start.lng + sim.heading.lng * step + jitter(2),
    accuracy: 15,
  };
}
