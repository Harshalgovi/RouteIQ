import React, { useEffect, useMemo, useState } from 'react';
import { useFleet } from '../context/FleetContext';
import { useLastOptimization } from '../context/OptimizationContext';
import { FleetMap, routeColorAt } from '../components/map/FleetMap';
import type { MapMarker, MapRoute } from '../components/map/FleetMap';
import { ErrorState } from '../components/ErrorState';
import {
  previewRoute,
  optimizeRoutes,
  fetchOptimizationCapabilities,
  ApiRequestError,
} from '../services/api';
import type { RoutePreviewRequest, RoutePlaceInput } from '../services/api';
import type {
  LatLng,
  RoutePreview,
  OptimizationResult,
  OptimizedVehicleRoute,
  OptimizationCapabilities,
  OptimizationProfile,
} from '../types';
import { fromGeoJson, formatDistanceKm, formatDuration } from '../utils/geo';
import { formatApiClock, localInputToUtcIso } from '../utils/datetime';
import {
  Route as RouteIcon,
  Play,
  Trash2,
  Plus,
  Loader2,
  Navigation,
  Flag,
  ListOrdered,
  Info,
  Wand2,
  Package,
  Truck,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Scale,
} from 'lucide-react';

interface StopDraft {
  id: string;
  address: string;
  /** Set when the stop came from a geocoded delivery (coordinates + ID known). */
  place?: RoutePlaceInput;
}

const PROFILES: { value: OptimizationProfile; label: string }[] = [
  { value: 'driving', label: 'Driving' },
  { value: 'walking', label: 'Walking' },
  { value: 'cycling', label: 'Cycling' },
];

const emptyStop = (): StopDraft => ({ id: `stop-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, address: '' });

/** Backend statuses that cannot take part in a plan; mirrors the API filters. */
const CLOSED_DELIVERY_STATUSES = ['delivered', 'cancelled'];
const UNAVAILABLE_VEHICLE_STATUSES = ['offline'];

const STATUS_BADGE: Record<string, string> = {
  optimal: 'badge-success',
  feasible: 'badge-success',
  partial: 'badge-warning',
  infeasible: 'badge-danger',
};

export const OptimizationPage: React.FC = () => {
  const { vehicles, deliveries } = useFleet();

  const [mode, setMode] = useState<'optimize' | 'preview'>('optimize');

  // ── Optimization state ──────────────────────────────────────────────────────
  const [selectedDeliveryIds, setSelectedDeliveryIds] = useState<number[]>([]);
  const [selectedVehicleIds, setSelectedVehicleIds] = useState<number[]>([]);
  const [optProfile, setOptProfile] = useState<OptimizationProfile>('driving');
  const [allowPartial, setAllowPartial] = useState(false);
  const [useCurrentPositions, setUseCurrentPositions] = useState(true);
  const [timeLimit, setTimeLimit] = useState(5);
  const [shiftStart, setShiftStart] = useState('');
  const [shiftEnd, setShiftEnd] = useState('');

  const [optimization, setOptimization] = useState<OptimizationResult | null>(null);
  // Also published app-wide so the Dashboard and Analytics pages can describe the
  // plan that was actually produced, rather than guessing at one.
  const { setOptimization: setSharedOptimization } = useLastOptimization();
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [optimizeError, setOptimizeError] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<OptimizationCapabilities | null>(null);
  const [selectedRouteId, setSelectedRouteId] = useState<number | null>(null);

  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [profile, setProfile] = useState<OptimizationProfile>('driving');
  const [stops, setStops] = useState<StopDraft[]>([]);

  const [preview, setPreview] = useState<RoutePreview | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Deliveries that the backend already geocoded can be used as route points. */
  const geocodedDeliveries = useMemo(
    () => deliveries.filter((d) => d.coordinates !== null),
    [deliveries]
  );
  const locatedVehicles = useMemo(
    () => vehicles.filter((v) => v.coordinates !== null),
    [vehicles]
  );

  /** Only deliveries the API can actually route (has a backend id, not closed). */
  const routableDeliveries = useMemo(
    () =>
      deliveries.filter(
        (d) => typeof d._backendId === 'number' && !CLOSED_DELIVERY_STATUSES.includes(d.status)
      ),
    [deliveries]
  );

  /** Only vehicles with a backend id and a status that is not excluded. */
  const routableVehicles = useMemo(
    () =>
      vehicles.filter(
        (v) => typeof v._backendId === 'number' && !UNAVAILABLE_VEHICLE_STATUSES.includes(v.status)
      ),
    [vehicles]
  );

  const [useVehicleOriginId, setUseVehicleOriginId] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    fetchOptimizationCapabilities()
      .then((result) => {
        if (!cancelled) setCapabilities(result);
      })
      .catch(() => {
        // Capabilities are advisory; the planner still works without them.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * A 409 from POST /routes/optimize still carries a complete result when the
   * solver (not the pre-flight checks) proved the problem infeasible. Validate
   * it before trusting it, so a plain `{detail}` error never renders as a plan.
   */
  const optimizationResultFromError = (
    err: ApiRequestError
  ): OptimizationResult | null => {
    const body = err.body as Partial<OptimizationResult> | null;
    if (!body || typeof body !== 'object') return null;
    if (body.status !== 'infeasible') return null;
    if (!Array.isArray(body.routes) || !Array.isArray(body.unassigned)) return null;
    if (!body.summary) return null;
    return body as OptimizationResult;
  };

  const toggleDelivery = (backendId: number) =>
    setSelectedDeliveryIds((prev) =>
      prev.includes(backendId) ? prev.filter((id) => id !== backendId) : [...prev, backendId]
    );

  const toggleVehicle = (backendId: number) =>
    setSelectedVehicleIds((prev) =>
      prev.includes(backendId) ? prev.filter((id) => id !== backendId) : [...prev, backendId]
    );

  const selectAllDeliveries = () =>
    setSelectedDeliveryIds(routableDeliveries.map((d) => d._backendId as number));

  const selectAllVehicles = () =>
    setSelectedVehicleIds(routableVehicles.map((v) => v._backendId as number));

  const canOptimize = routableDeliveries.length > 0 && selectedDeliveryIds.length > 0;

  const handleOptimize = async () => {
    if (!canOptimize) return;

    setIsOptimizing(true);
    setOptimizeError(null);
    setOptimization(null);
    setSelectedRouteId(null);

    try {
      const result = await optimizeRoutes({
        delivery_ids: selectedDeliveryIds,
        vehicle_ids: selectedVehicleIds.length > 0 ? selectedVehicleIds : undefined,
        profile: optProfile,
        preferences: {
          allow_partial: allowPartial,
          use_current_vehicle_positions: useCurrentPositions,
          time_limit_seconds: timeLimit,
          service_seconds_per_delivery: 300,
          // Empty strings would fail validation; only send filled values.
          // These two come from `datetime-local` inputs, so they are wall-clock
          // local times and must be converted *to* UTC, not read as UTC.
          shift_start: localInputToUtcIso(shiftStart),
          shift_end: localInputToUtcIso(shiftEnd),
        },
      });
      setOptimization(result);
      // Publish to the app so Dashboard and Analytics can describe this plan.
      setSharedOptimization(result);
      // Focus the first route so the map highlights something immediately.
      setSelectedRouteId(result.routes[0]?.vehicle_id ?? null);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        // 409 means the request was valid but no plan exists. The body still
        // carries the summary, unassigned deliveries and violations, so show it
        // instead of collapsing the outcome to a bare message.
        const reported = optimizationResultFromError(err);
        if (reported) {
          setOptimization(reported);
          setSharedOptimization(reported);
          setSelectedRouteId(null);
          setOptimizeError(null);
        } else {
          setOptimizeError(err.message);
        }
      } else {
        setOptimizeError(err instanceof Error ? err.message : 'Optimization failed');
      }
    } finally {
      setIsOptimizing(false);
    }
  };

  const optimizeRoutesForMap: MapRoute[] = useMemo(() => {
    if (!optimization) return [];
    return optimization.routes.map((route, index) => ({
      id: String(route.vehicle_id),
      path: route.geometry as LatLng[],
      color: routeColorAt(index),
      selected: selectedRouteId === null || selectedRouteId === route.vehicle_id,
      label: route.vehicle_number,
    }));
  }, [optimization, selectedRouteId]);

  const optimizeMarkers: MapMarker[] = useMemo(() => {
    if (!optimization) return [];
    const byVehicle = new Map<number, MapMarker[]>();

    optimization.routes.forEach((route, routeIndex) => {
      const color = routeColorAt(routeIndex);
      const list: MapMarker[] = [];

      list.push({
        id: `opt-start-${route.vehicle_id}`,
        position: [route.start.latitude, route.start.longitude],
        label: 'S',
        kind: 'origin',
        color,
        title: `${route.vehicle_number} start: ${route.start.label}`,
      });

      route.stops.forEach((stop) => {
        list.push({
          id: `opt-stop-${route.vehicle_id}-${stop.delivery_id}`,
          position: [stop.latitude, stop.longitude],
          // Numbered in visit order so the sequence is readable on the map.
          label: String(stop.sequence),
          kind: 'delivery',
          color,
          selected: selectedRouteId === route.vehicle_id,
          title: `${stop.sequence}. ${stop.tracking_number} — ${stop.customer_name}`,
          onClick: () => setSelectedRouteId(route.vehicle_id),
        });
      });

      list.push({
        id: `opt-end-${route.vehicle_id}`,
        position: [route.end.latitude, route.end.longitude],
        label: 'E',
        kind: 'destination',
        color,
        title: `${route.vehicle_number} return: ${route.end.label}`,
      });

      byVehicle.set(route.vehicle_id, list);
    });

    // Only the highlighted vehicle's markers get numbers; the others would
    // overlap and become unreadable.
    if (selectedRouteId !== null) {
      return byVehicle.get(selectedRouteId) ?? [];
    }
    return [...byVehicle.values()].flat();
  }, [optimization, selectedRouteId]);

  const resolveOrigin = (): RoutePlaceInput | null => {
    if (useVehicleOriginId) {
      const vehicle = vehicles.find((v) => v.id === useVehicleOriginId);
      if (vehicle?.coordinates) {
        return {
          latitude: vehicle.coordinates[0],
          longitude: vehicle.coordinates[1],
          label: vehicle.name,
          vehicleId: vehicle._backendId,
        };
      }
    }
    return origin.trim() ? { address: origin.trim(), label: 'Origin' } : null;
  };

  const canPreview = Boolean(resolveOrigin() && destination.trim());

  const handlePreview = async () => {
    const originPlace = resolveOrigin();
    if (!originPlace || !destination.trim()) return;

    const payload: RoutePreviewRequest = {
      origin: originPlace,
      destination: { address: destination.trim(), label: 'Destination' },
      profile,
    };

    const validStops = stops
      .map((s) => ({
        address: s.address.trim(),
        place: s.place,
      }))
      .filter((s) => s.address.length > 0 || s.place);
    if (validStops.length > 0) {
      payload.stops = validStops.map((s, index) =>
        s.place ?? { address: s.address, label: `Stop ${index + 1}` }
      );
    }

    setIsLoading(true);
    setError(null);
    try {
      const result = await previewRoute(payload);
      setPreview(result);
    } catch (err) {
      setPreview(null);
      if (err instanceof ApiRequestError) {
        setError(err.status === 404
          ? err.message
          : `Routing provider error (HTTP ${err.status}): ${err.message}`);
      } else {
        setError(err instanceof Error ? err.message : 'Route preview failed');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleUseDelivery = (deliveryId: string) => {
    const delivery = deliveries.find((d) => d.id === deliveryId);
    if (!delivery) return;

    // A geocoded delivery is the most accurate input available, so send its
    // stored coordinates plus the backend ID for traceability.
    const place: RoutePlaceInput = delivery.coordinates
      ? {
          latitude: delivery.coordinates[0],
          longitude: delivery.coordinates[1],
          label: delivery.recipientName,
          deliveryId: delivery._backendId,
        }
      : { address: delivery.address, label: delivery.recipientName };

    if (!destination.trim()) {
      setDestination(delivery.address);
    } else {
      setStops((prev) => [...prev, { id: `stop-${delivery.id}`, address: delivery.address, place }]);
    }
    setPreview(null);
  };

  const routePath = useMemo<LatLng[]>(
    () => (preview ? fromGeoJson(preview.geometry.coordinates) : []),
    [preview]
  );

  const markers = useMemo<MapMarker[]>(() => {
    if (!preview) return [];

    const routeMarkers: MapMarker[] = preview.waypoints.map((waypoint) => ({
      id: `wp-${waypoint.order}`,
      position: [waypoint.latitude, waypoint.longitude] as LatLng,
      label: String(waypoint.order + 1),
      kind: waypoint.role === 'origin' ? 'origin' : waypoint.role === 'destination' ? 'destination' : 'stop',
      title: waypoint.snapped_name ?? waypoint.label ?? `Waypoint ${waypoint.order + 1}`,
    }));

    return routeMarkers;
  }, [preview]);

  const hasPreview = Boolean(preview && routePath.length > 1);

  return (
    <div className="planner-page">
      <div className="page-action-header">
        <div>
          <h2 className="section-title">
            <RouteIcon size={20} /> Route Planner
          </h2>
          <p className="section-subtitle">
            {mode === 'optimize'
              ? 'Multi-vehicle routing solved with Google OR-Tools against real road distance and travel time from the configured routing provider.'
              : 'Real routing preview from the configured OpenStreetMap routing provider. Stops are visited in the order you enter them — this mode does not optimise or reorder them.'}
          </p>
        </div>

        <div className="tile-toggle-group" role="group" aria-label="Planner mode">
          <button
            type="button"
            className={`tile-btn ${mode === 'optimize' ? 'active' : ''}`}
            onClick={() => setMode('optimize')}
            aria-pressed={mode === 'optimize'}
          >
            <Wand2 size={13} /> Optimize deliveries
          </button>
          <button
            type="button"
            className={`tile-btn ${mode === 'preview' ? 'active' : ''}`}
            onClick={() => setMode('preview')}
            aria-pressed={mode === 'preview'}
          >
            <Navigation size={13} /> Route preview
          </button>
        </div>
      </div>

      {mode === 'optimize' ? (
        <div className="planner-layout">
          {/* LEFT — what to optimize */}
          <div className="planner-control-column">
            <div className="card planner-card">
              <h3 className="card-title-sm">
                <Package size={16} /> 1. Deliveries ({selectedDeliveryIds.length} selected)
              </h3>

              {routableDeliveries.length === 0 ? (
                <p className="hint-text">
                  No open deliveries with a backend record are available to optimize.
                </p>
              ) : (
                <>
                  <div className="param-header-flex">
                    <span className="hint-text">
                      {routableDeliveries.length} deliverable
                      {routableDeliveries.length === 1 ? '' : 's'} available.
                    </span>
                    <button
                      type="button"
                      className="text-btn"
                      onClick={() =>
                        selectedDeliveryIds.length === routableDeliveries.length
                          ? setSelectedDeliveryIds([])
                          : selectAllDeliveries()
                      }
                    >
                      {selectedDeliveryIds.length === routableDeliveries.length
                        ? 'Clear all'
                        : 'Select all'}
                    </button>
                  </div>

                  <div className="selection-list">
                    {routableDeliveries.map((delivery) => {
                      const checked = selectedDeliveryIds.includes(delivery._backendId as number);
                      return (
                        <label key={delivery.id} className="selection-item as-checkbox">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleDelivery(delivery._backendId as number)}
                          />
                          <span className="item-name">{delivery.trackingNumber}</span>
                          <span className="item-cap">
                            {delivery.recipientName} · {delivery.weightKg} kg
                            {delivery.coordinates ? '' : ' · no coordinates yet'}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </>
              )}
            </div>

            <div className="card planner-card">
              <h3 className="card-title-sm">
                <Truck size={16} /> 2. Vehicles ({selectedVehicleIds.length} selected)
              </h3>

              {routableVehicles.length === 0 ? (
                <p className="hint-text">
                  No available vehicles. Offline vehicles and vehicles with inactive drivers are
                  excluded by the server.
                </p>
              ) : (
                <>
                  <div className="param-header-flex">
                    <span className="hint-text">
                      Leave empty to let the solver use every available vehicle.
                    </span>
                    <button
                      type="button"
                      className="text-btn"
                      onClick={() =>
                        selectedVehicleIds.length === routableVehicles.length
                          ? setSelectedVehicleIds([])
                          : selectAllVehicles()
                      }
                    >
                      {selectedVehicleIds.length === routableVehicles.length
                        ? 'Clear all'
                        : 'Select all'}
                    </button>
                  </div>

                  <div className="selection-list">
                    {routableVehicles.map((vehicle) => {
                      const checked = selectedVehicleIds.includes(vehicle._backendId as number);
                      return (
                        <label key={vehicle.id} className="selection-item as-checkbox">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleVehicle(vehicle._backendId as number)}
                          />
                          <span className="item-name">{vehicle.name}</span>
                          <span className="item-cap">
                            {vehicle.capacityKg} kg
                            {vehicle.capacityVolumeM3 > 0 ? ` · ${vehicle.capacityVolumeM3} m³` : ''}
                            {vehicle.driver ? ` · ${vehicle.driver}` : ''}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </>
              )}
            </div>

            <div className="card planner-card">
              <h3 className="card-title-sm">
                <Scale size={16} /> 3. Constraints
              </h3>

              <div className="parameter-group">
                <label className="param-label" htmlFor="opt-profile">
                  Travel profile
                </label>
                <select
                  id="opt-profile"
                  className="table-select full-width"
                  value={optProfile}
                  onChange={(e) => setOptProfile(e.target.value as OptimizationProfile)}
                >
                  {PROFILES.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="parameter-group">
                <label className="param-label" htmlFor="opt-shift-start">
                  Shift starts
                </label>
                <input
                  id="opt-shift-start"
                  type="datetime-local"
                  value={shiftStart}
                  onChange={(e) => setShiftStart(e.target.value)}
                />
                <span className="hint-text">
                  Optional. Vehicles cannot leave before this time.
                </span>
              </div>

              <div className="parameter-group">
                <label className="param-label" htmlFor="opt-shift-end">
                  Shift ends
                </label>
                <input
                  id="opt-shift-end"
                  type="datetime-local"
                  value={shiftEnd}
                  onChange={(e) => setShiftEnd(e.target.value)}
                />
                <span className="hint-text">
                  Optional hard deadline — every vehicle must be back by then.
                </span>
              </div>

              <div className="parameter-group">
                <label className="param-label" htmlFor="opt-time-limit">
                  Solver time limit: {timeLimit}s
                </label>
                <input
                  id="opt-time-limit"
                  type="range"
                  min={1}
                  max={30}
                  step={1}
                  value={timeLimit}
                  onChange={(e) => setTimeLimit(Number(e.target.value))}
                />
              </div>

              <label className="selection-item as-checkbox">
                <input
                  type="checkbox"
                  checked={useCurrentPositions}
                  onChange={(e) => setUseCurrentPositions(e.target.checked)}
                />
                <span className="item-name">Start from current vehicle positions</span>
              </label>

              <label className="selection-item as-checkbox">
                <input
                  type="checkbox"
                  checked={allowPartial}
                  onChange={(e) => setAllowPartial(e.target.checked)}
                />
                <span className="item-name">Allow a partial plan</span>
                <span className="item-cap">
                  Serve as many deliveries as fit and list the rest as unassigned, instead of
                  failing outright.
                </span>
              </label>

              <button
                type="button"
                className="btn btn-primary full-width"
                onClick={handleOptimize}
                disabled={!canOptimize || isOptimizing}
              >
                {isOptimizing ? (
                  <Loader2 size={15} className="spin" />
                ) : (
                  <Wand2 size={15} />
                )}
                {isOptimizing ? 'Solving…' : 'Optimize routes'}
              </button>

              {!canOptimize && routableDeliveries.length > 0 && (
                <p className="hint-text">Select at least one delivery to optimize.</p>
              )}
            </div>
          </div>

          {/* MAIN — map */}
          <div className="planner-main-column">
            <div className="card map-card">
              <div className="card-header-flex" style={{ padding: '1rem 1.25rem 0.5rem' }}>
                <h3 className="card-title-sm">
                  <Navigation size={16} /> Optimized routes
                </h3>
                {optimization && (
                  <span className={`status-badge ${STATUS_BADGE[optimization.status] ?? ''}`}>
                    {optimization.status}
                  </span>
                )}
              </div>

              <div className="planner-map-wrap">
                <FleetMap
                  markers={optimization ? optimizeMarkers : []}
                  routes={optimizeRoutesForMap}
                  height="100%"
                  ariaLabel="Map showing optimized vehicle routes"
                  showStyleSwitcher
                />

                {optimization?.status === 'infeasible' && (
                  <div className="map-empty-overlay">
                    <div className="empty-state-container">
                      <div className="empty-state-icon map-empty-icon-danger">
                        <AlertTriangle size={26} />
                      </div>
                      <div className="empty-state-title">No feasible plan</div>
                      <p className="empty-state-desc">
                        {optimization.message ??
                          'No combination of vehicles and stop order satisfies every constraint.'}
                      </p>
                    </div>
                  </div>
                )}

                {!optimization && !isOptimizing && (
                  <div className="map-empty-overlay">
                    <div className="empty-state-container">
                      <div className="empty-state-icon">
                        <Wand2 size={26} />
                      </div>
                      <div className="empty-state-title">No plan yet</div>
                      <p className="empty-state-desc">
                        Select deliveries and choose “Optimize routes”. Every line drawn here comes
                        from the routing provider's real road geometry.
                      </p>
                    </div>
                  </div>
                )}

                {isOptimizing && (
                  <div className="map-empty-overlay">
                    <div className="empty-state-container">
                      <div className="empty-state-icon">
                        <Loader2 size={26} className="spin" />
                      </div>
                      <div className="empty-state-title">Solving…</div>
                      <p className="empty-state-desc">
                        Building the travel matrix and searching for the best assignment of
                        deliveries to vehicles.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* RIGHT — result */}
          <div className="planner-result-column">
            <div className="card planner-card">
              <h3 className="card-title-sm">
                <ListOrdered size={16} /> Plan
              </h3>

              {optimizeError && (
                <ErrorState title="No feasible plan" message={optimizeError} />
              )}

              {optimization && (
                <>
                  {optimization.message && (
                    <p className="hint-text">{optimization.message}</p>
                  )}

                  <div className="solver-meta-box">
                    <div className="meta-row">
                      <span className="meta-label">Distance</span>
                      <span className="meta-val font-mono">
                        {formatDistanceKm(optimization.summary.total_distance_meters)}
                      </span>
                    </div>
                    <div className="meta-row">
                      <span className="meta-label">Duration</span>
                      <span className="meta-val font-mono">
                        {formatDuration(optimization.summary.total_duration_seconds)}
                      </span>
                    </div>
                    <div className="meta-row">
                      <span className="meta-label">Vehicles used</span>
                      <span className="meta-val font-mono">
                        {optimization.summary.vehicles_used} of{' '}
                        {optimization.summary.vehicles_available}
                      </span>
                    </div>
                    <div className="meta-row">
                      <span className="meta-label">Stops assigned</span>
                      <span className="meta-val font-mono">
                        {optimization.summary.deliveries_assigned} of{' '}
                        {optimization.summary.deliveries_eligible}
                      </span>
                    </div>
                    <div className="meta-row">
                      <span className="meta-label">Load</span>
                      <span className="meta-val font-mono">
                        {optimization.summary.total_demand_kg} /{' '}
                        {optimization.summary.total_capacity_kg} kg
                      </span>
                    </div>
                    <div className="meta-row">
                      <span className="meta-label">Constraints</span>
                      <span className="meta-val">
                        {optimization.summary.constraints_enforced.join(', ') || 'none'}
                      </span>
                    </div>
                    <div className="meta-row">
                      <span className="meta-label">Solver</span>
                      <span className="meta-val font-mono">
                        {optimization.solver.wall_time_ms} ms
                        {optimization.solver.matrix_degraded ? ' · degraded matrix' : ''}
                      </span>
                    </div>
                  </div>

                  {optimization.baseline && (
                    <>
                      <h4 className="sub-heading">
                        <Scale size={13} /> Compared with {optimization.baseline.baseline.label}
                      </h4>
                      <p className="hint-text">{optimization.baseline.baseline.description}</p>
                      <ul className="leg-list">
                        <li>
                          Distance: {optimization.baseline.baseline.distance_km} km →{' '}
                          <strong>{optimization.baseline.optimized_distance_km} km</strong>
                          {optimization.baseline.distance_saved_percent > 0 && (
                            <span className="badge-success">
                              {' '}
                              −{optimization.baseline.distance_saved_percent.toFixed(1)}%
                            </span>
                          )}
                        </li>
                        <li>
                          Duration: {formatDuration(optimization.baseline.baseline.total_duration_seconds)}{' '}
                          → <strong>{formatDuration(optimization.baseline.optimized_duration_seconds)}</strong>
                        </li>
                      </ul>
                    </>
                  )}

                  <h4 className="sub-heading">
                    <Truck size={13} /> Vehicles ({optimization.routes.length})
                  </h4>
                  <div className="selection-list">
                    {optimization.routes.map((route: OptimizedVehicleRoute, index) => {
                      const color = routeColorAt(index);
                      const active = selectedRouteId === route.vehicle_id;
                      return (
                        <button
                          key={route.vehicle_id}
                          type="button"
                          className={`selection-item as-button ${active ? 'is-active' : ''}`}
                          onClick={() => setSelectedRouteId(active ? null : route.vehicle_id)}
                          aria-pressed={active}
                        >
                          <span className="route-swatch" style={{ background: color }} />
                          <span className="item-name">{route.vehicle_number}</span>
                          <span className="item-cap">
                            {route.stop_count} stop{route.stop_count === 1 ? '' : 's'} ·{' '}
                            {formatDistanceKm(route.distance_meters)} ·{' '}
                            {route.capacity.used_kg}/{route.capacity.capacity_kg} kg
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {selectedRouteId !== null &&
                    optimization.routes
                      .filter((route) => route.vehicle_id === selectedRouteId)
                      .map((route) => (
                        <div key={`stops-${route.vehicle_id}`}>
                          <h4 className="sub-heading">
                            <Flag size={13} /> {route.vehicle_number} stops in order
                          </h4>
                          <ol className="route-stop-list">
                            {route.stops.map((stop) => (
                              <li key={stop.delivery_id} className="route-stop-item">
                                <span className="stop-order-badge role-stop">{stop.sequence}</span>
                                <span className="stop-text">
                                  <strong>{stop.tracking_number}</strong> — {stop.customer_name}
                                  <em className="stop-ref">
                                    {formatApiClock(stop.estimated_arrival)}
                                    {stop.wait_seconds > 0 && (
                                      <> · waits {formatDuration(stop.wait_seconds)}</>
                                    )}
                                    {stop.window_start && (
                                      <>
                                        {' · window '}
                                        {formatApiClock(stop.window_start)}–
                                        {formatApiClock(stop.window_end as string)}
                                      </>
                                    )}
                                  </em>
                                </span>
                                {stop.within_window ? (
                                  <CheckCircle2 size={14} className="icon-success" aria-label="Within window" />
                                ) : (
                                  <AlertTriangle size={14} className="icon-warning" aria-label="Outside window" />
                                )}
                              </li>
                            ))}
                          </ol>
                          <div className="meta-row">
                            <span className="meta-label">
                              <Clock size={12} /> Back at depot
                            </span>
                            <span className="meta-val font-mono">
                              {route.estimated_return
                                ? formatApiClock(route.estimated_return)
                                : '—'}
                            </span>
                          </div>
                        </div>
                      ))}

                  {optimization.unassigned.length > 0 && (
                    <>
                      <h4 className="sub-heading">
                        <AlertTriangle size={13} /> Unassigned ({optimization.unassigned.length})
                      </h4>
                      <ul className="route-stop-list">
                        {optimization.unassigned.map((item) => (
                          <li key={item.delivery_id} className="route-stop-item">
                            <span className="stop-order-badge">{item.tracking_number}</span>
                            <span className="stop-text">
                              <strong>{item.customer_name}</strong>
                              <em className="stop-ref">{item.reason}</em>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}

                  {optimization.violations.length > 0 && (
                    <>
                      <h4 className="sub-heading">
                        <AlertTriangle size={13} /> Constraint violations (
                        {optimization.violations.length})
                      </h4>
                      <ul className="route-stop-list">
                        {optimization.violations.map((violation, i) => (
                          <li key={i} className="route-stop-item">
                            <span className="stop-text">
                              <strong>{violation.subject}</strong>
                              <em className="stop-ref">{violation.message}</em>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}

                  {optimization.warnings.length > 0 && (
                    <>
                      <h4 className="sub-heading">
                        <Info size={13} /> Notes
                      </h4>
                      <ul className="leg-list">
                        {optimization.warnings.map((warning, i) => (
                          <li key={i}>{warning}</li>
                        ))}
                      </ul>
                    </>
                  )}

                  {capabilities && (
                    <p className="hint-text">
                      Provider {capabilities.routing_provider} ·{' '}
                      {capabilities.constraints_enforced.length} constraints enforced ·{' '}
                      {capabilities.constraints_not_yet_implemented.length} not implemented.
                    </p>
                  )}
                </>
              )}

              {!optimization && !optimizeError && (
                <p className="hint-text">
                  No plan yet. Select the deliveries to serve and press “Optimize routes”.
                </p>
              )}
            </div>
          </div>
        </div>
      ) : (
      <div className="planner-layout">
        {/* LEFT — route input */}
        <div className="planner-control-column">
          <div className="card planner-card">
            <h3 className="card-title-sm">
              <Navigation size={16} /> 1. Route Stops
            </h3>

            {locatedVehicles.length > 0 && (
              <div className="parameter-group">
                <label className="param-label" htmlFor="planner-vehicle-origin">
                  Start from a vehicle position
                </label>
                <select
                  id="planner-vehicle-origin"
                  className="table-select full-width"
                  value={useVehicleOriginId}
                  onChange={(e) => setUseVehicleOriginId(e.target.value)}
                >
                  <option value="">Use address instead</option>
                  {locatedVehicles.map((vehicle) => (
                    <option key={vehicle.id} value={vehicle.id}>
                      {vehicle.id} — {vehicle.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="parameter-group">
              <label className="param-label" htmlFor="planner-origin">
                Origin
              </label>
              <input
                id="planner-origin"
                type="text"
                placeholder="e.g. MG Road, Bengaluru"
                value={origin}
                disabled={Boolean(useVehicleOriginId)}
                onChange={(e) => setOrigin(e.target.value)}
              />
            </div>

            <div className="parameter-group">
              <label className="param-label" htmlFor="planner-destination">
                Destination
              </label>
              <input
                id="planner-destination"
                type="text"
                placeholder="e.g. Whitefield Main Road, Bengaluru"
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
              />
            </div>

            <div className="parameter-group">
              <label className="param-label" htmlFor="planner-profile">
                Travel profile
              </label>
              <select
                id="planner-profile"
                className="table-select full-width"
                value={profile}
                onChange={(e) => setProfile(e.target.value as 'driving' | 'walking' | 'cycling')}
              >
                {PROFILES.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="parameter-group">
              <div className="param-header-flex">
                <label className="param-label">Intermediate stops ({stops.length})</label>
                <button
                  type="button"
                  className="text-btn"
                  onClick={() => setStops((prev) => [...prev, emptyStop()])}
                >
                  <Plus size={12} /> Add stop
                </button>
              </div>

              {stops.length === 0 && (
                <p className="hint-text">
                  Optional. Stops are routed through in the order listed.
                </p>
              )}

              <div className="selection-list">
                {stops.map((stop, index) => (
                  <div key={stop.id} className="stop-editor-row">
                    <span className="stop-order-badge">{index + 1}</span>
                    <input
                      type="text"
                      aria-label={`Stop ${index + 1} address`}
                      placeholder="Address"
                      value={stop.address}
                      onChange={(e) =>
                        setStops((prev) =>
                          prev.map((s) =>
                            s.id === stop.id
                              ? // Editing the text invalidates stored coordinates.
                                { ...s, address: e.target.value, place: undefined }
                              : s
                          )
                        )
                      }
                    />
                    <button
                      type="button"
                      className="map-control-icon-btn"
                      aria-label={`Remove stop ${index + 1}`}
                      onClick={() => setStops((prev) => prev.filter((s) => s.id !== stop.id))}
                    >
                      <Trash2 size={13} />
                    </button>
                    <button
                      type="button"
                      className="map-control-icon-btn"
                      aria-label={`Move stop ${index + 1} up`}
                      disabled={index === 0}
                      onClick={() =>
                        setStops((prev) => {
                          const next = [...prev];
                          [next[index - 1], next[index]] = [next[index], next[index - 1]];
                          return next;
                        })
                      }
                    >
                      ↑
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <button
              type="button"
              className="btn btn-primary full-width"
              onClick={handlePreview}
              disabled={!canPreview || isLoading}
            >
              {isLoading ? <Loader2 size={15} className="spin" /> : <Play size={15} />}
              {isLoading ? 'Requesting route…' : 'Preview route'}
            </button>

            {!canPreview && (
              <p className="hint-text">
                Enter an origin and a destination to request a real route.
              </p>
            )}
          </div>

          {geocodedDeliveries.length > 0 && (
            <div className="card planner-card">
              <h3 className="card-title-sm">
                <Info size={16} /> Add a delivery to the route
              </h3>
              <p className="hint-text">
                The first one becomes the destination; later ones are appended as stops in order.
              </p>
              <div className="selection-list">
                {geocodedDeliveries.map((delivery) => (
                  <button
                    key={delivery.id}
                    type="button"
                    className="selection-item as-button"
                    onClick={() => handleUseDelivery(delivery.id)}
                  >
                    <span className="item-name">{delivery.trackingNumber}</span>
                    <span className="item-cap">{delivery.recipientName}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* MAIN — map */}
        <div className="planner-main-column">
          <div className="card map-card">
            <div className="card-header-flex" style={{ padding: '1rem 1.25rem 0.5rem' }}>
              <h3 className="card-title-sm">
                <Navigation size={16} /> 2. Route Preview
              </h3>
            </div>

            <div className="planner-map-wrap">
              <FleetMap
                markers={markers}
                route={routePath}
                height="100%"
                ariaLabel="Map showing the previewed route"
                showStyleSwitcher
              />

              {!hasPreview && !isLoading && (
                <div className="map-empty-overlay">
                  <div className="empty-state-container">
                    <div className="empty-state-icon">
                      <Navigation size={26} />
                    </div>
                    <div className="empty-state-title">No route preview yet</div>
                    <p className="empty-state-desc">
                      Enter an origin and destination, then choose “Preview route”. Distances, time
                      and the path come straight from the routing provider.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* RIGHT — result */}
        <div className="planner-result-column">
          <div className="card planner-card">
            <h3 className="card-title-sm">
              <ListOrdered size={16} /> 3. Preview summary
            </h3>

            {error && <ErrorState title="Route preview failed" message={error} />}

            {preview ? (
              <>
                <div className="solver-meta-box">
                  <div className="meta-row">
                    <span className="meta-label">Routing provider</span>
                    <span className="meta-val">{preview.provider}</span>
                  </div>
                  <div className="meta-row">
                    <span className="meta-label">Profile</span>
                    <span className="meta-val">{preview.profile}</span>
                  </div>
                  <div className="meta-row">
                    <span className="meta-label">Distance</span>
                    <span className="meta-val font-mono">{formatDistanceKm(preview.distance_meters)}</span>
                  </div>
                  <div className="meta-row">
                    <span className="meta-label">Driving time</span>
                    <span className="meta-val font-mono">{formatDuration(preview.duration_seconds)}</span>
                  </div>
                  <div className="meta-row">
                    <span className="meta-label">Intermediate stops</span>
                    <span className="meta-val font-mono">{preview.stop_count}</span>
                  </div>
                  <div className="meta-row">
                    <span className="meta-label">Geometry points</span>
                    <span className="meta-val font-mono">{preview.total_points}</span>
                  </div>
                </div>

                <h4 className="sub-heading">
                  <Flag size={13} /> Stops in order
                </h4>
                <ol className="route-stop-list">
                  {preview.waypoints.map((waypoint) => (
                    <li
                      key={`${waypoint.order}-${waypoint.latitude}`}
                      className="route-stop-item"
                    >
                      <span className={`stop-order-badge role-${waypoint.role}`}>
                        {waypoint.order + 1}
                      </span>
                      <span className="stop-text">
                        <strong>{waypoint.snapped_name ?? waypoint.label ?? 'Unnamed point'}</strong>
                        <em className="stop-ref">
                          {waypoint.geocoded
                            ? `geocoded from address${waypoint.reference_id ? ` · ${waypoint.reference_id}` : ''}`
                            : waypoint.reference_id ?? 'supplied coordinates'}
                        </em>
                      </span>
                    </li>
                  ))}
                </ol>

                {preview.legs.length > 1 && (
                  <>
                    <h4 className="sub-heading">Leg breakdown</h4>
                    <ul className="leg-list">
                      {preview.legs.map((leg, index) => (
                        <li key={index}>
                          <strong>{leg.from_label ?? '—'}</strong> → <strong>{leg.to_label ?? '—'}</strong>:{' '}
                          {formatDistanceKm(leg.distance_meters)} · {formatDuration(leg.duration_seconds)}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </>
            ) : (
              !error && (
                <p className="hint-text">
                  Request a preview to see real distance, duration and the road path. RouteIQ does
                  not reorder or optimise stops.
                </p>
              )
            )}
          </div>
        </div>
      </div>
      )}
    </div>
  );
};
