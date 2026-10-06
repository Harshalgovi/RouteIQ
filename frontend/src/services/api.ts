/**
 * RouteIQ REST API Client
 *
 * All communication with the FastAPI backend goes through this module.
 * Handles loading, error, network-failure states — never fakes a success.
 */

import type {
  HealthStatus,
  Vehicle,
  VehicleStatus,
  Delivery,
  DeliveryPriority,
  DeliveryStatus,
  MapProviderInfo,
  GeocodingProviderInfo,
  RoutingProviderInfo,
  GeocodeResult,
  RoutePreview,
  ReverseGeocodeResult,
  LatLng,
  OptimizationRequest,
  OptimizationResult,
  OptimizationCapabilities,
} from '../types';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api/v1';

// ─── Generic fetch wrapper ────────────────────────────────────────────────────

interface ApiError {
  detail?: string;
  message?: string;
}

class ApiRequestError extends Error {
  status: number;
  /**
   * Parsed error body, kept because optimization reports "no feasible plan" as a
   * 409 that still carries the full result (summary, unassigned, violations).
   * Without this the UI could only show a bare message for those outcomes.
   */
  body: unknown;
  constructor(message: string, status: number, body: unknown = null) {
    super(message);
    this.status = status;
    this.body = body;
    this.name = 'ApiRequestError';
  }
}

async function apiRequest<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE_URL}${path}`;
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...options.headers,
    },
    ...options,
  });

  if (!response.ok) {
    let errorMessage = `HTTP ${response.status}`;
    let parsed: ApiError | null = null;
    try {
      parsed = (await response.json()) as ApiError;
      errorMessage = parsed.detail || parsed.message || errorMessage;
    } catch {
      // ignore JSON parse failure
    }
    throw new ApiRequestError(errorMessage, response.status, parsed);
  }

  // 204 No Content — return null
  if (response.status === 204) {
    return null as unknown as T;
  }

  return response.json() as Promise<T>;
}

// ─── API Response Types (backend shape) ──────────────────────────────────────

export interface ApiVehicle {
  id: number;
  vehicle_number: string;
  name: string;
  license_plate: string;
  vehicle_type: string;
  capacity_kg: number;
  capacity_volume_m3: number;
  status: string;
  tracking_enabled: boolean;
  current_latitude: number | null;
  current_longitude: number | null;
  driver_id: number | null;
  driver: { id: number; name: string; phone: string | null; status: string } | null;
  created_at: string;
  updated_at: string;
}

export interface ApiDelivery {
  id: number;
  tracking_number: string;
  customer_name: string;
  phone: string | null;
  address: string;
  latitude: number | null;
  longitude: number | null;
  package_weight: number;
  volume_m3: number;
  time_window_start: string | null;
  time_window_end: string | null;
  priority: string;
  status: string;
  notes: string | null;
  assigned_vehicle_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface TrackingState {
  vehicle_id: number;
  vehicle_number: string;
  tracking_enabled: boolean;
  status: string;
  current_latitude: number | null;
  current_longitude: number | null;
}

// ─── Mapping: Backend → Frontend types ───────────────────────────────────────

/**
 * Map an API vehicle to the frontend Vehicle type.
 *
 * Coordinates are passed through exactly as stored by the backend — a vehicle
 * that has never reported a position stays `null` and is not drawn on the map.
 *
 * Nothing is invented here. The backend does not store an ETA, a speed, a battery
 * level, a route assignment or a completion percentage for a vehicle, so those
 * fields are simply absent from the type rather than filled with plausible
 * placeholders that would read as real telemetry.
 */
export function mapApiVehicle(v: ApiVehicle): Vehicle {
  const status = normalizeVehicleStatus(v.status);

  const hasPosition =
    typeof v.current_latitude === 'number' && typeof v.current_longitude === 'number';
  const coordinates: LatLng | null = hasPosition
    ? [v.current_latitude as number, v.current_longitude as number]
    : null;

  return {
    id: v.vehicle_number,
    name: v.name,
    licensePlate: v.license_plate,
    type: normalizeVehicleType(v.vehicle_type),
    capacityKg: v.capacity_kg,
    capacityVolumeM3: v.capacity_volume_m3,
    status,
    rawStatus: v.status,
    driver: v.driver?.name ?? null,
    driverPhone: v.driver?.phone ?? null,
    driverId: v.driver?.id ?? v.driver_id ?? null,
    coordinates,
    isTracked: v.tracking_enabled,
    createdAt: v.created_at,
    updatedAt: v.updated_at,
    _backendId: v.id,
  };
}

/**
 * Normalize the backend status string.
 *
 * Unknown values are preserved as `unknown` rather than being coerced into a
 * dispatchable-looking status: the optimizer rejects anything outside
 * available/active, so pretending an unknown status is fine would make the UI
 * promise a plan the solver will refuse.
 */
export function normalizeVehicleStatus(raw: string): VehicleStatus {
  const value = (raw ?? '').trim().toLowerCase();
  const known: VehicleStatus[] = [
    'available',
    'active',
    'in_transit',
    'delivering',
    'delayed',
    'offline',
    'maintenance',
  ];
  return (known as string[]).includes(value) ? (value as VehicleStatus) : 'unknown';
}

function normalizeVehicleType(raw: string): Vehicle['type'] {
  const value = (raw ?? '').trim().toLowerCase();
  const known: Vehicle['type'][] = ['van', 'truck', 'bike', 'refrigerated'];
  return (known as string[]).includes(value) ? (value as Vehicle['type']) : 'van';
}

export function mapApiDelivery(d: ApiDelivery): Delivery {
  const hasPosition =
    typeof d.latitude === 'number' && typeof d.longitude === 'number';
  const coordinates: LatLng | null = hasPosition
    ? [d.latitude as number, d.longitude as number]
    : null;

  return {
    id: `DEL-${d.id}`,
    trackingNumber: d.tracking_number,
    recipientName: d.customer_name,
    phone: d.phone ?? '',
    address: d.address,
    coordinates,
    weightKg: d.package_weight,
    volumeM3: d.volume_m3,
    timeWindowStart: d.time_window_start,
    timeWindowEnd: d.time_window_end,
    priority: normalizePriority(d.priority),
    status: normalizeDeliveryStatus(d.status),
    rawStatus: d.status,
    assignedVehicleId: d.assigned_vehicle_id !== null ? `V-${d.assigned_vehicle_id}` : null,
    notes: d.notes ?? undefined,
    createdAt: d.created_at,
    updatedAt: d.updated_at,
    _backendId: d.id,
  };
}

function normalizePriority(raw: string): DeliveryPriority {
  const value = (raw ?? '').trim().toLowerCase();
  const known: DeliveryPriority[] = ['low', 'normal', 'high', 'urgent'];
  return (known as string[]).includes(value) ? (value as DeliveryPriority) : 'normal';
}

export function normalizeDeliveryStatus(raw: string): DeliveryStatus {
  const value = (raw ?? '').trim().toLowerCase();
  const known: DeliveryStatus[] = [
    'pending',
    'assigned',
    'in_transit',
    'delivered',
    'delayed',
    'cancelled',
    'failed',
  ];
  return (known as string[]).includes(value) ? (value as DeliveryStatus) : 'unknown';
}

// ─── Health ───────────────────────────────────────────────────────────────────

export async function fetchHealthStatus(): Promise<HealthStatus> {
  try {
    const data = await apiRequest<HealthStatus>('/health');
    return { ...data, lastChecked: new Date().toLocaleTimeString() };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to connect to backend';
    return {
      status: 'error',
      app: 'RouteIQ',
      version: '0.1.0',
      environment: 'development',
      database: 'disconnected',
      error: msg,
      lastChecked: new Date().toLocaleTimeString(),
    };
  }
}

// ─── Vehicles ─────────────────────────────────────────────────────────────────

export async function fetchVehicles(): Promise<ApiVehicle[]> {
  return apiRequest<ApiVehicle[]>('/vehicles');
}

export async function createVehicle(data: Partial<ApiVehicle>): Promise<ApiVehicle> {
  return apiRequest<ApiVehicle>('/vehicles', { method: 'POST', body: JSON.stringify(data) });
}

export async function updateVehicle(id: number, data: Partial<ApiVehicle>): Promise<ApiVehicle> {
  return apiRequest<ApiVehicle>(`/vehicles/${id}`, { method: 'PUT', body: JSON.stringify(data) });
}

export async function deleteVehicle(id: number): Promise<void> {
  return apiRequest<void>(`/vehicles/${id}`, { method: 'DELETE' });
}

// ─── Deliveries ───────────────────────────────────────────────────────────────

export async function fetchDeliveries(): Promise<ApiDelivery[]> {
  return apiRequest<ApiDelivery[]>('/deliveries');
}

export async function createDelivery(data: Partial<ApiDelivery>): Promise<ApiDelivery> {
  return apiRequest<ApiDelivery>('/deliveries', { method: 'POST', body: JSON.stringify(data) });
}

export async function updateDelivery(id: number, data: Partial<ApiDelivery>): Promise<ApiDelivery> {
  return apiRequest<ApiDelivery>(`/deliveries/${id}`, { method: 'PUT', body: JSON.stringify(data) });
}

export async function deleteDelivery(id: number): Promise<void> {
  return apiRequest<void>(`/deliveries/${id}`, { method: 'DELETE' });
}

// ─── Drivers ───────────────────────────────────────────────────────────────────

export interface ApiDriver {
  id: number;
  name: string;
  phone: string | null;
  /** "active" | "off_duty" | "suspended" */
  status: string;
  created_at: string;
  updated_at: string;
}

export type DriverStatus = 'active' | 'off_duty' | 'suspended';

/**
 * Map a driver status onto the three the backend accepts.
 *
 * An unrecognised stored value becomes `active` only if the string is empty;
 * anything else the backend may introduce is passed through untouched so the UI
 * shows the truth rather than silently promoting a suspended driver to active.
 */
export function normalizeDriverStatus(raw: string): DriverStatus | string {
  const value = (raw ?? '').trim().toLowerCase();
  if (value === '') return 'active';
  const known: DriverStatus[] = ['active', 'off_duty', 'suspended'];
  return known.includes(value as DriverStatus) ? (value as DriverStatus) : value;
}

export async function fetchDrivers(): Promise<ApiDriver[]> {
  return apiRequest<ApiDriver[]>('/drivers');
}

export async function createDriver(data: Partial<ApiDriver>): Promise<ApiDriver> {
  return apiRequest<ApiDriver>('/drivers', { method: 'POST', body: JSON.stringify(data) });
}

export async function updateDriver(id: number, data: Partial<ApiDriver>): Promise<ApiDriver> {
  return apiRequest<ApiDriver>(`/drivers/${id}`, { method: 'PUT', body: JSON.stringify(data) });
}

/** Deletes the driver; any vehicle they drove is released, not removed. */
export async function deleteDriver(id: number): Promise<void> {
  return apiRequest<void>(`/drivers/${id}`, { method: 'DELETE' });
}

// ─── Tracking ─────────────────────────────────────────────────────────────────

export async function fetchTrackedVehicles(): Promise<ApiVehicle[]> {
  return apiRequest<ApiVehicle[]>('/tracking/vehicles');
}

export async function startTracking(vehicleId: number): Promise<TrackingState> {
  return apiRequest<TrackingState>(`/tracking/vehicles/${vehicleId}/start`, { method: 'POST' });
}

export async function stopTracking(vehicleId: number): Promise<TrackingState> {
  return apiRequest<TrackingState>(`/tracking/vehicles/${vehicleId}/stop`, { method: 'POST' });
}

// ─── Map configuration ────────────────────────────────────────────────────────

/**
 * Basemap configuration served by the backend.
 *
 * The frontend never hardcodes tile URLs — the active provider advertises its
 * styles here so swapping providers is a backend-only change.
 */
export async function fetchMapConfig(): Promise<MapProviderInfo> {
  return apiRequest<MapProviderInfo>('/maps/config');
}

/** Single call returning basemap + routing + geocoding provider metadata. */
export async function fetchProviderBundle(): Promise<{
  map: MapProviderInfo;
  routing: RoutingProviderInfo;
  geocoding: GeocodingProviderInfo;
}> {
  return apiRequest('/maps/providers');
}

// ─── Geocoding ────────────────────────────────────────────────────────────────

export async function geocodeAddress(address: string): Promise<GeocodeResult> {
  return apiRequest<GeocodeResult>('/geocoding/geocode', {
    method: 'POST',
    body: JSON.stringify({ address }),
  });
}

/** The backend takes the coordinates as query parameters on this endpoint. */
export async function reverseGeocode(
  latitude: number,
  longitude: number
): Promise<ReverseGeocodeResult> {
  const query = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
  });
  return apiRequest<ReverseGeocodeResult>(`/geocoding/reverse?${query.toString()}`, {
    method: 'POST',
  });
}

export async function fetchGeocodingProviders(): Promise<GeocodingProviderInfo> {
  return apiRequest<GeocodingProviderInfo>('/geocoding/providers');
}

// ─── Routing ──────────────────────────────────────────────────────────────────
/** A place to route through: free-text address or explicit coordinates. */
export interface RoutePlaceInput {
  address?: string;
  latitude?: number;
  longitude?: number;
  label?: string;
  /** Numeric backend delivery ID — echoed back on the resolved waypoint. */
  deliveryId?: number;
  /** Numeric backend vehicle ID — echoed back on the resolved waypoint. */
  vehicleId?: number;
}

export interface RoutePreviewRequest {
  origin: RoutePlaceInput;
  destination: RoutePlaceInput;
  stops?: RoutePlaceInput[];
  profile?: 'driving' | 'walking' | 'cycling';
}

/** Convert the camelCase client shape into the backend's snake_case contract. */
function toRouteStopInput(place: RoutePlaceInput) {
  const payload: Record<string, unknown> = {};
  if (typeof place.latitude === 'number') payload.latitude = place.latitude;
  if (typeof place.longitude === 'number') payload.longitude = place.longitude;
  if (place.address) payload.address = place.address;
  if (place.label) payload.label = place.label;
  if (typeof place.deliveryId === 'number') payload.delivery_id = place.deliveryId;
  if (typeof place.vehicleId === 'number') payload.vehicle_id = place.vehicleId;
  return payload;
}

export async function previewRoute(payload: RoutePreviewRequest): Promise<RoutePreview> {
  return apiRequest<RoutePreview>('/routes/preview', {
    method: 'POST',
    body: JSON.stringify({
      origin: toRouteStopInput(payload.origin),
      destination: toRouteStopInput(payload.destination),
      stops: (payload.stops ?? []).map(toRouteStopInput),
      profile: payload.profile ?? 'driving',
    }),
  });
}

export async function fetchRoutingProviders(): Promise<RoutingProviderInfo> {
  return apiRequest<RoutingProviderInfo>('/routes/providers');
}

export async function optimizeRoutes(
  payload: OptimizationRequest,
): Promise<OptimizationResult> {
  return apiRequest<OptimizationResult>('/routes/optimize', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function fetchOptimizationCapabilities(): Promise<OptimizationCapabilities> {
  return apiRequest<OptimizationCapabilities>('/routes/optimize/capabilities');
}

export { ApiRequestError };
