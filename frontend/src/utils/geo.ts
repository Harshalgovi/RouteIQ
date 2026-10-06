/** Small geo/format helpers shared by the map components. */

import type { LatLng } from '../types';

/** Convert GeoJSON `[lng, lat]` pairs (as returned by the routing provider) to `[lat, lng]`. */
export function fromGeoJson(coordinates: [number, number][]): LatLng[] {
  return coordinates
    .filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat))
    .map(([lng, lat]) => [lat, lng] as LatLng);
}

export function formatDistanceKm(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(meters < 10000 ? 2 : 1)} km`;
}

export function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** True when a coordinate pair is a usable [lat, lng] inside valid bounds. */
export function isValidLatLng(value: unknown): value is LatLng {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1]) &&
    Math.abs(value[0] as number) <= 90 &&
    Math.abs(value[1] as number) <= 180
  );
}

/** Approximate centre of a set of points, or null when there are none. */
export function centroid(points: LatLng[]): LatLng | null {
  if (points.length === 0) return null;
  const sum = points.reduce((acc, [lat, lng]) => [acc[0] + lat, acc[1] + lng], [0, 0]);
  return [sum[0] / points.length, sum[1] / points.length];
}
