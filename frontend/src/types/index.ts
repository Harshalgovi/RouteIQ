export type NavTab = 
  | 'dashboard'
  | 'deliveries'
  | 'vehicles'
  | 'drivers'
  | 'planner'
  | 'maps'
  | 'tracking'
  | 'analytics'
  | 'settings';

/**
 * Vehicle status vocabulary.
 *
 * These are the statuses the backend actually stores and filters on. The route
 * optimizer only treats `available` and `active` as dispatchable
 * (see `AVAILABLE_VEHICLE_STATUSES` in `optimization/constraints.py`), so the UI
 * must not silently relabel them — "available" and "on route" mean different
 * things to a dispatcher.
 */
export type VehicleStatus =
  | 'available'
  | 'active'
  | 'in_transit'
  | 'delivering'
  | 'delayed'
  | 'offline'
  | 'maintenance'
  | 'unknown';

/** Statuses the backend will accept for optimization (mirrors the solver). */
export const DISPATCHABLE_VEHICLE_STATUSES: readonly VehicleStatus[] = ['available', 'active'];

export type VehicleType = 'van' | 'truck' | 'bike' | 'refrigerated';

/** [latitude, longitude] as stored by the backend. `null` = never located. */
export type LatLng = [number, number];

export interface Vehicle {
  id: string;
  name: string;
  licensePlate: string;
  type: VehicleType;
  capacityKg: number;
  capacityVolumeM3: number;
  status: VehicleStatus;
  /** Exactly what the backend returned, before normalization. Shown as a tooltip. */
  rawStatus: string;
  /** `null` when no driver is assigned in the database. */
  driver: string | null;
  driverPhone: string | null;
  driverId: number | null;
  /** Last position reported by the backend. Null when the vehicle has no location. */
  coordinates: LatLng | null;
  isTracked: boolean;
  /**
   * Removed deliberately. The backend has no separate position-report timestamp,
   * so any "last seen" value would have to be `updated_at` wearing a different
   * label, implying a freshness the data cannot support. `updatedAt` is shown
   * instead, labelled as the record's last change.
   */
  createdAt: string;
  updatedAt: string;
  /** Numeric backend DB ID — used for API calls. */
  _backendId?: number;
}

export type DeliveryPriority = 'low' | 'normal' | 'high' | 'urgent';
export type DeliveryStatus =
  | 'pending'
  | 'assigned'
  | 'in_transit'
  | 'delivered'
  | 'delayed'
  | 'cancelled'
  | 'failed'
  | 'unknown';

export interface Delivery {
  id: string;
  trackingNumber: string;
  recipientName: string;
  phone: string;
  address: string;
  /** Geocoded by the backend from `address`. Null when geocoding has not resolved yet. */
  coordinates: LatLng | null;
  weightKg: number;
  volumeM3: number;
  /** Real datetimes from the backend, or null when the delivery is unconstrained. */
  timeWindowStart: string | null;
  timeWindowEnd: string | null;
  priority: DeliveryPriority;
  status: DeliveryStatus;
  rawStatus: string;
  /** Backend-assigned vehicle. The database owns this; the planner never writes it. */
  assignedVehicleId: string | null;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  /** Numeric backend DB ID — used for API calls. */
  _backendId?: number;
}

// ─── Map / geocoding / routing contracts (mirror the backend schemas) ─────────

export interface TileStyle {
  id: string;
  name: string;
  url: string;
  attribution: string;
  max_zoom: number;
  min_zoom: number;
  subdomains: string;
  /** "light" | "dark" — lets the UI pick readable marker colours. */
  scheme: string;
  /**
   * Class applied to the tile pane. Lets a single set of OSM tiles serve both a
   * light and a dark basemap without a second tile provider.
   */
  css_class?: string | null;
}

export interface MapProviderInfo {
  provider: string;
  name: string;
  requires_api_key: boolean;
  configured: boolean;
  supported: string[];
  message: string | null;
  default_style: string;
  styles: TileStyle[];
  default_view: { latitude: number; longitude: number; zoom: number };
  attribution: { label: string; url: string | null }[];
}

export interface GeocodingProviderInfo {
  provider: string;
  name: string;
  requires_api_key: boolean;
  configured: boolean;
  supported: string[];
  message: string | null;
}

export interface RoutingProviderInfo {
  provider: string;
  name: string;
  requires_api_key: boolean;
  configured: boolean;
  supports_matrix: boolean;
  supported: string[];
  profiles: string[];
}

export interface GeocodeResult {
  latitude: number;
  longitude: number;
  formatted_address: string | null;
  display_name: string | null;
  provider: string;
  provider_reference: string | null;
  /** [min_lat, min_lon, max_lat, max_lon] when the provider supplies one. */
  bounding_box: number[] | null;
  cached: boolean;
}

export interface ReverseGeocodeResult {
  address: string | null;
  latitude: number;
  longitude: number;
  provider: string;
}

export interface RouteStop {
  order: number;
  role: 'origin' | 'stop' | 'destination';
  latitude: number;
  longitude: number;
  label: string | null;
  reference_id: string | null;
  snapped_name: string | null;
  /** True when the backend resolved these coordinates from an address. */
  geocoded: boolean;
}

export interface RouteLeg {
  distance_meters: number;
  distance_km: number;
  duration_seconds: number;
  duration_minutes: number;
  from_label: string | null;
  to_label: string | null;
}

export interface RouteBounds {
  min_latitude: number;
  min_longitude: number;
  max_latitude: number;
  max_longitude: number;
}

export interface RouteGeometry {
  type: 'LineString';
  /** GeoJSON-style [ [longitude, latitude], ... ] as returned by the provider. */
  coordinates: [number, number][];
}

export interface RoutePreview {
  provider: string;
  profile: string;
  distance_meters: number;
  distance_km: number;
  duration_seconds: number;
  duration_minutes: number;
  stop_count: number;
  total_points: number;
  bounds: RouteBounds | null;
  geometry: RouteGeometry;
  waypoints: RouteStop[];
  legs: RouteLeg[];
  computed_at: string;
}

/* ── Optimization ─────────────────────────────────────────────────────────── */

export type OptimizationStatus = 'optimal' | 'feasible' | 'partial' | 'infeasible';

export type OptimizationProfile = 'driving' | 'walking' | 'cycling';

export interface ObjectiveWeights {
  distance_weight?: number;
  duration_weight?: number;
  vehicle_count_weight?: number;
  priority_weight?: number;
}

export interface OptimizationPreferences {
  profile?: OptimizationProfile;
  allow_partial?: boolean;
  service_seconds_per_delivery?: number;
  use_current_vehicle_positions?: boolean;
  time_limit_seconds?: number;
  return_to_start?: boolean;
  reference_time?: string;
  shift_start?: string;
  shift_end?: string;
  vehicle_availability?: Record<string, { start?: string | null; end?: string | null }>;
  objective?: ObjectiveWeights;
}

export interface OptimizationRequest {
  delivery_ids?: number[];
  vehicle_ids?: number[];
  profile?: OptimizationProfile;
  preferences?: OptimizationPreferences;
}

export interface RouteEndpoint {
  label: string;
  latitude: number;
  longitude: number;
}

export interface OptimizedStop {
  sequence: number;
  delivery_id: number;
  tracking_number: string;
  customer_name: string;
  address: string;
  latitude: number;
  longitude: number;
  priority: string;
  arrival: string;
  service_start: string;
  service_end: string;
  estimated_arrival: string;
  wait_seconds: number;
  driving_seconds: number;
  window_start: string | null;
  window_end: string | null;
  within_window: boolean;
  late_by_seconds: number;
}

export interface CapacityUsage {
  capacity_kg: number;
  used_kg: number;
  remaining_kg: number | null;
  utilization_percent: number | null;
  capacity_volume_m3: number;
  used_volume_m3: number;
  remaining_volume_m3: number | null;
}

export interface OptimizedVehicleRoute {
  vehicle_id: number;
  vehicle_number: string;
  vehicle_name: string;
  vehicle_status: string;
  driver_id: number | null;
  driver_name: string | null;
  start: RouteEndpoint;
  end: RouteEndpoint;
  stops: OptimizedStop[];
  stop_count: number;
  distance_meters: number;
  distance_km: number;
  duration_seconds: number;
  duration_minutes: number;
  driving_seconds: number;
  waiting_seconds: number;
  estimated_return: string | null;
  capacity: CapacityUsage;
  has_time_window_violations: boolean;
  /** Real road polyline as [latitude, longitude] pairs; empty if unavailable. */
  geometry: [number, number][];
  /** [south, west, north, east]. */
  bounds: [number, number, number, number] | null;
}

export interface UnassignedDelivery {
  delivery_id: number;
  tracking_number: string;
  customer_name: string;
  address: string;
  priority: string;
  weight_kg: number;
  reason: string;
}

export interface ConstraintViolation {
  kind: string;
  subject: string;
  message: string;
  delivery_id: number | null;
  vehicle_id: number | null;
}

export interface OptimizationSummary {
  total_distance_meters: number;
  total_distance_km: number;
  total_duration_seconds: number;
  total_duration_minutes: number;
  vehicles_available: number;
  vehicles_used: number;
  deliveries_eligible: number;
  deliveries_assigned: number;
  deliveries_unassigned: number;
  total_demand_kg: number;
  total_demand_m3: number;
  total_capacity_kg: number;
  total_capacity_m3: number;
  constraints_enforced: string[];
}

export interface BaselineComparison {
  baseline: {
    label: string;
    description: string;
    total_distance_meters: number;
    distance_km: number;
    total_duration_seconds: number;
    duration_minutes: number;
    vehicles_used: number;
  };
  optimized_distance_meters: number;
  optimized_distance_km: number;
  optimized_duration_seconds: number;
  optimized_duration_minutes: number;
  distance_saved_meters: number;
  distance_saved_km: number;
  duration_saved_seconds: number;
  duration_saved_minutes: number;
  distance_saved_percent: number;
}

export interface SolverDiagnostics {
  objective_value: number;
  wall_time_ms: number;
  vehicles_available: number;
  matrix_nodes: number;
  matrix_source: string;
  matrix_degraded: boolean;
  time_limit_seconds: number;
  enforced_constraints: string[];
  objective: string;
}

export interface OptimizationResult {
  optimization_id: string;
  status: OptimizationStatus;
  message: string | null;
  provider: string;
  profile: string;
  summary: OptimizationSummary;
  routes: OptimizedVehicleRoute[];
  unassigned: UnassignedDelivery[];
  violations: ConstraintViolation[];
  baseline: BaselineComparison | null;
  solver: SolverDiagnostics;
  warnings: string[];
  computed_at: string;
}

/**
 * What the solver reports it can actually do.
 *
 * Mirrors `GET /routes/optimize/capabilities`. `constraints_*` are the honesty
 * contract: anything the solver does not model is listed under
 * `constraints_not_yet_implemented` rather than silently ignored.
 */
export interface OptimizationCapabilities {
  engine: string;
  solver: string;
  objective: string;
  objective_is_extensible: boolean;
  constraints_enforced: string[];
  constraints_not_yet_implemented: string[];
  supports_partial_plans: boolean;
  routing_provider: string;
  matrix_supported_by_provider: boolean;
}


export interface ActivityLog {
  id: string;
  timestamp: string;
  type:
    | 'tracking_started'
    | 'tracking_stopped'
    | 'delivery_completed'
    | 'vehicle_delayed'
    | 'route_optimized'
    | 'delivery_added'
    | 'vehicle_added'
    | 'driver_added';
  title: string;
  description: string;
  vehicleId?: string;
  deliveryId?: string;
  }

export interface HealthStatus {
  status: 'ok' | 'degraded' | 'error' | 'loading';
  app: string;
  version: string;
  environment: string;
  database: string;
  details?: Record<string, unknown> | null;
  error?: string;
  lastChecked?: string;
}

export interface NotificationItem {
  id: string;
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
  type: 'info' | 'warning' | 'alert' | 'success';
}

/**
 * Operations summary — every field derived from backend records.
 *
 * Nothing here is stored: these counts are recomputed from the vehicle and
 * delivery lists the API returns, so they cannot drift from reality.
 */
export interface OperationsSummary {
  /** Vehicles the backend reports with tracking_enabled = true. */
  vehiclesTracked: number;
  vehiclesTotal: number;
  /** Statuses the optimizer would accept as dispatchable. */
  vehiclesDispatchable: number;
  /** Vehicles with no driver assigned — an operational gap, not an error. */
  vehiclesWithoutDriver: number;
  /** Vehicles with no stored position, so they cannot be drawn on the map. */
  vehiclesWithoutPosition: number;

  /** Deliveries created today (server `created_at`). */
  deliveriesToday: number;
  deliveriesTotal: number;
  deliveriesPending: number;
  deliveriesAssigned: number;
  deliveriesInTransit: number;
  deliveriesDelivered: number;
  deliveriesDelayed: number;
  /** Pending or assigned deliveries that no vehicle owns yet. */
  deliveriesUnassigned: number;

  /** Load actually assigned in the database, per vehicle id. */
  loadByVehicle: Record<string, VehicleLoad>;
  /** Total assigned weight across the whole fleet, in kg. */
  totalAssignedKg: number;
  /** Sum of capacity across dispatchable vehicles, in kg. */
  totalDispatchableCapacityKg: number;
}

export interface VehicleLoad {
  vehicleId: string;
  assignedDeliveries: number;
  assignedKg: number;
  assignedVolumeM3: number;
  capacityKg: number;
  capacityVolumeM3: number;
  /** 0–100. May exceed 100 when the database assignment overfills a vehicle. */
  weightPercent: number;
  volumePercent: number;
}
