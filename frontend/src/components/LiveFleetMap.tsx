import React, { useMemo, useState } from 'react';
import type { Delivery, Vehicle, VehicleStatus } from '../types';
import { useFleet } from '../context/FleetContext';
import { useMapConfig } from '../context/MapContext';
import { FleetMap } from './map/FleetMap';
import type { MapMarker } from './map/FleetMap';
import { VehicleTrackingPanel } from './VehicleTrackingPanel';
import { EmptyState } from './EmptyState';
import { describeVehicleStatus } from '../utils/status';
import { openDeliveriesForVehicle } from '../utils/assignment';
import { Compass, Radio, Maximize2, LocateFixed } from 'lucide-react';

interface LiveFleetMapProps {
  /** Deliveries to show as context pins. Only those with coordinates are drawn. */
  deliveries?: Delivery[];
  /** Shown when the operator wants every vehicle, not just tracked ones. */
  showAllVehicles?: boolean;
  height?: string;
  onNavigateToVehicles?: () => void;
  onNavigateToTracking?: () => void;
}

const STATUS_COLORS: Record<VehicleStatus, string> = {
  available: '#10b981',
  active: '#3b82f6',
  in_transit: '#3b82f6',
  delivering: '#38bdf8',
  delayed: '#ef4444',
  offline: '#64748b',
  maintenance: '#64748b',
  unknown: '#64748b',
};

/**
 * The live fleet map — the centre of RouteIQ.
 *
 * Three states, each of which is genuinely useful:
 *  1. tracked vehicles with positions → markers plus delivery context
 *  2. vehicles exist but none tracked → pick one to track, inline
 *  3. no vehicles at all → explain why and point at the vehicles page
 *
 * A vehicle with tracking enabled but no stored position is never drawn and is
 * always counted in the notice, because silently omitting it looks like the
 * vehicle does not exist.
 */
export const LiveFleetMap: React.FC<LiveFleetMapProps> = ({
  deliveries = [],
  showAllVehicles = false,
  height = '520px',
  onNavigateToVehicles,
  onNavigateToTracking,
}) => {
  const {
    vehicles,
    trackedVehicles,
    untrackedVehicles,
    selectedVehicle,
    selectedVehicleId,
    setSelectedVehicleId,
    startTrackingVehicle,
    setIsTrackingModalOpen,
    dataSource,
    loadState,
  } = useFleet();
  const { defaultCenter, defaultZoom } = useMapConfig();

  // Which vehicle the side panel shows. Null closes it.
  //
  // The panel follows the global selection (set by clicking a marker, by the
  // track list, or by the dashboard jumping here) so it never gets out of sync
  // with the map. `dismissedFor` records the selection the operator explicitly
  // closed the panel on: a plain `panelOverride ?? selectedVehicle` would make
  // closing impossible, because the underlying selection is still set and the
  // panel would immediately reopen itself.
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);

  const panelVehicle =
    selectedVehicle && selectedVehicle.id !== dismissedFor ? selectedVehicle : null;

  const setPanelVehicle = (vehicle: Vehicle | null) => {
    // Reopening the same vehicle means clearing its dismissal first.
    if (vehicle) setDismissedFor(null);
    else setDismissedFor(selectedVehicleId);
  };
  const [fitToken, setFitToken] = useState(0);
  const [pendingVehicleId, setPendingVehicleId] = useState<string | null>(null);

  const focusVehicles = showAllVehicles ? vehicles : trackedVehicles;
  const locatedVehicles = useMemo(
    () => focusVehicles.filter((v) => v.coordinates !== null),
    [focusVehicles]
  );
  const missingPositionCount = focusVehicles.length - locatedVehicles.length;

  const panelVehicleDeliveries = useMemo(
    () => (panelVehicle ? openDeliveriesForVehicle(deliveries, panelVehicle) : []),
    [deliveries, panelVehicle]
  );

  // Delivery pins give the operator context for where the work actually is.
  const deliveryMarkers = useMemo<MapMarker[]>(
    () =>
      deliveries
        .filter((d) => d.coordinates !== null && d.status !== 'delivered')
        .map((delivery) => ({
          id: `pin-${delivery.id}`,
          position: delivery.coordinates as [number, number],
          kind: 'delivery' as const,
          label: delivery.trackingNumber,
          title: `${delivery.trackingNumber} — ${delivery.recipientName}`,
          onClick: () => setSelectedVehicleId(null),
        })),
    [deliveries, setSelectedVehicleId]
  );

  const vehicleMarkers = useMemo<MapMarker[]>(
    () =>
      locatedVehicles.map((vehicle) => ({
        id: vehicle.id,
        position: vehicle.coordinates as [number, number],
        label: vehicle.id.replace(/^.*?([A-Z]*-?\d+)$/, '$1'),
        kind: 'vehicle' as const,
        color: STATUS_COLORS[vehicle.status],
        selected: selectedVehicle?.id === vehicle.id,
        title: `${vehicle.id} — ${vehicle.name} — ${describeVehicleStatus(vehicle.status).label}`,
onClick: () => {
          // Clicking the marker clears any earlier dismissal so the panel opens
          // for this vehicle.
          setSelectedVehicleId(vehicle.id);
        },
      })),
    [locatedVehicles, selectedVehicle, setSelectedVehicleId]
  );

  const markers = useMemo(
    () => [...vehicleMarkers, ...deliveryMarkers],
    [vehicleMarkers, deliveryMarkers]
  );

  const hasTracked = trackedVehicles.length > 0;
  const hasAnyVehicles = vehicles.length > 0;
  const showNoneTrackedState = !hasTracked;

  /**
   * Tracking is a server-side flag, so it can only be changed while the API is
   * actually reachable. The buttons below stay disabled and say why, rather than
   * accepting a click that the context would reject immediately.
   */
  const canTrack = dataSource === 'backend' && loadState === 'success';

  return (
    <section className="live-fleet" aria-label="Live fleet map">
      <div className="live-fleet-head">
        <div className="live-fleet-title-group">
          <h3 className="live-fleet-title">
            <LocateFixed size={16} aria-hidden="true" /> Live Fleet
          </h3>
          <span className="live-fleet-subtitle">
            {locatedVehicles.length} vehicle{locatedVehicles.length === 1 ? '' : 's'} positioned
            {missingPositionCount > 0 && ` · ${missingPositionCount} awaiting a position`}
            {deliveryMarkers.length > 0 && ` · ${deliveryMarkers.length} open deliveries`}
          </span>
        </div>

        <div className="live-fleet-actions">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setFitToken((n) => n + 1)}
            title="Fit the map to every positioned vehicle"
          >
            <Maximize2 size={13} aria-hidden="true" /> Fit all
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setIsTrackingModalOpen(true)}
            title="Choose a vehicle to start or stop tracking"
          >
            <Radio size={13} aria-hidden="true" /> Manage tracking
          </button>
        </div>
      </div>

      <div className="live-fleet-canvas" style={{ height }}>
        <FleetMap
          markers={markers}
          height="100%"
          center={defaultCenter}
          zoom={defaultZoom}
          fitSignal={fitToken}
          ariaLabel="Map of tracked fleet vehicles and open deliveries"
          showStyleSwitcher
        />

        {showNoneTrackedState && (
          <div className="map-empty-overlay">
            <EmptyState
              icon={Compass}
              title={
                hasAnyVehicles
                  ? 'No vehicles are being tracked'
                  : 'No vehicles exist yet'
              }
              description={
                hasAnyVehicles
                  ? 'Start tracking a vehicle to see its position on the map. RouteIQ only shows a location the backend has actually reported.'
                  : 'Add a vehicle before tracking or planning routes.'
              }
              primaryActionLabel={hasAnyVehicles ? 'Track a Vehicle' : undefined}
              onPrimaryAction={
                hasAnyVehicles ? () => setIsTrackingModalOpen(true) : onNavigateToVehicles
              }
              secondaryActionLabel="View Vehicles"
              onSecondaryAction={onNavigateToVehicles}
            >
              {/* Inline selection so the operator can act without a dialog. */}
              {hasAnyVehicles && untrackedVehicles.length > 0 && (
                <div className="track-picker">
                  <p className="track-picker-title">
                    {untrackedVehicles.length} vehicle
                    {untrackedVehicles.length === 1 ? '' : 's'} available to track
                  </p>
                  {!canTrack && (
                    <p className="table-subtext inline-warning">
                      Tracking is stored by the backend, so it cannot be changed while the API is
                      unreachable. These are development records — start the API and retry.
                    </p>
                  )}
                  <ul className="track-picker-list">
                    {untrackedVehicles.slice(0, 5).map((vehicle) => (
                      <li key={vehicle.id}>
                        <button
                          type="button"
                          className="track-picker-item"
                          disabled={pendingVehicleId === vehicle.id || !canTrack}
                          onClick={async () => {
                            setPendingVehicleId(vehicle.id);
                            await startTrackingVehicle(vehicle.id);
                            setPendingVehicleId(null);
                          }}
                        >
                          <span className="track-picker-name">
                            {vehicle.name}
                            <span className="track-picker-id">{vehicle.id}</span>
                          </span>
                          <span className="track-picker-status">
                            {describeVehicleStatus(vehicle.status).label}
                          </span>
                          <span className="track-picker-action">
                            {pendingVehicleId === vehicle.id ? 'Starting…' : 'Track'}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  {untrackedVehicles.length > 5 && onNavigateToVehicles && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={onNavigateToVehicles}
                    >
                      View all {untrackedVehicles.length} vehicles
                    </button>
                  )}
                </div>
              )}
            </EmptyState>
          </div>
        )}

        {panelVehicle && (
          <VehicleTrackingPanel
            vehicle={panelVehicle}
            deliveries={panelVehicleDeliveries}
            onClose={() => setPanelVehicle(null)}
          />
        )}
      </div>

      {missingPositionCount > 0 && (
        <p className="live-fleet-notice">
          {missingPositionCount} vehicle{missingPositionCount === 1 ? '' : 's'} on this map{' '}
          {missingPositionCount === 1 ? 'has' : 'have'} no position reported by the backend yet, so{' '}
          {missingPositionCount === 1 ? 'it is' : 'they are'} not drawn. Tracking a vehicle does
          not create a position — the vehicle has to report one.
        </p>
      )}

      {onNavigateToTracking && hasTracked && (
        <button
          type="button"
          className="btn btn-ghost btn-sm live-fleet-link"
          onClick={onNavigateToTracking}
        >
          Open Live Tracking for the full fleet view
        </button>
      )}
    </section>
  );
};
