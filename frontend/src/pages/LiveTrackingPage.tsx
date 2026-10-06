import React, { useMemo, useState } from 'react';
import { useFleet } from '../context/FleetContext';
import { LiveFleetMap } from '../components/LiveFleetMap';
import { StatusBadge } from '../components/StatusBadge';
import { openDeliveryCountForVehicle, indexOpenDeliveriesByVehicle } from '../utils/assignment';
import { Radio, Truck, User, Search, Check, RotateCcw, AlertTriangle } from 'lucide-react';
import type { NavTab } from '../types';

interface LiveTrackingPageProps {
  onNavigate: (tab: NavTab, filter?: string) => void;
}

type FleetFilter = 'all' | 'tracked' | 'untracked';

/**
 * Live Tracking.
 *
 * The map is the page, not a widget inside it. The side panel is a roster of
 * every vehicle with its real tracking state and a direct control to change it —
 * no ETA, speed or progress bar, because the backend records none of those.
 */
export const LiveTrackingPage: React.FC<LiveTrackingPageProps> = ({ onNavigate }) => {
  const {
    vehicles,
    deliveries,
    trackedVehicles,
    selectedVehicleId,
    setSelectedVehicleId,
    startTrackingVehicle,
    stopTrackingVehicle,
    setIsTrackingModalOpen,
    clearAllTracking,
    dataSource,
    loadState,
  } = useFleet();

  const [filterText, setFilterText] = useState('');
  const [statusFilter, setStatusFilter] = useState<FleetFilter>('all');
  const [pendingId, setPendingId] = useState<string | null>(null);

  const openByVehicle = useMemo(() => indexOpenDeliveriesByVehicle(deliveries), [deliveries]);

  const filteredVehicles = useMemo(() => {
    const needle = filterText.trim().toLowerCase();
    return vehicles.filter((vehicle) => {
      const matchesText =
        !needle ||
        vehicle.name.toLowerCase().includes(needle) ||
        vehicle.id.toLowerCase().includes(needle) ||
        (vehicle.driver ?? '').toLowerCase().includes(needle) ||
        vehicle.licensePlate.toLowerCase().includes(needle);

      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'tracked' && vehicle.isTracked) ||
        (statusFilter === 'untracked' && !vehicle.isTracked);

      return matchesText && matchesStatus;
    });
  }, [vehicles, filterText, statusFilter]);

  const canTrack = dataSource === 'backend' && loadState === 'success';

  return (
    <div className="live-tracking-page">
      {/* Action errors render once, globally, in Layout. */}

      <div className="tracking-workspace-layout">
        <aside className="tracking-side-panel card" aria-label="Fleet roster">
          <div className="panel-top-header">
            <div className="panel-title-group">
              <Radio size={18} className="panel-live-icon" aria-hidden="true" />
              <div>
                <h2 className="panel-heading">Fleet Tracking</h2>
                <span className="panel-subheading">
                  {trackedVehicles.length} of {vehicles.length} tracked
                </span>
              </div>
            </div>

            {trackedVehicles.length > 0 && (
              <button
                type="button"
                className="btn-icon"
                onClick={clearAllTracking}
                title="Stop tracking every vehicle"
                aria-label="Stop tracking every vehicle"
              >
                <RotateCcw size={14} />
              </button>
            )}
          </div>

          <div className="panel-filters-row">
            <div className="panel-search-box">
              <Search size={14} aria-hidden="true" />
              <label className="visually-hidden" htmlFor="fleet-filter">
                Filter fleet
              </label>
              <input
                id="fleet-filter"
                type="text"
                placeholder="Filter by ID, name, driver…"
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
              />
            </div>
            <label className="visually-hidden" htmlFor="fleet-state-filter">
              Tracking state
            </label>
            <select
              id="fleet-state-filter"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as FleetFilter)}
              className="table-select text-xs"
            >
              <option value="all">All vehicles</option>
              <option value="tracked">Tracked</option>
              <option value="untracked">Not tracked</option>
            </select>
          </div>

          <div className="panel-vehicle-cards-list">
            {filteredVehicles.length === 0 ? (
              <p className="modal-empty">
                {vehicles.length === 0
                  ? 'No vehicles exist yet. Add one on the Vehicles page.'
                  : 'No vehicles match this filter.'}
              </p>
            ) : (
              filteredVehicles.map((vehicle) => {
                const isSelected = selectedVehicleId === vehicle.id;
                const openAssigned = openDeliveryCountForVehicle(openByVehicle, vehicle);
                const noPosition = vehicle.isTracked && vehicle.coordinates === null;

                return (
                  <div
                    key={vehicle.id}
                    className={`tracking-vehicle-card ${isSelected ? 'selected' : ''} ${
                      vehicle.isTracked ? 'tracked' : ''
                    }`}
                  >
                    <button
                      type="button"
                      className="tracking-card-select"
                      onClick={() => setSelectedVehicleId(isSelected ? null : vehicle.id)}
                      aria-pressed={isSelected}
                      aria-label={`${isSelected ? 'Deselect' : 'Select'} ${vehicle.id} ${vehicle.name}`}
                    >
                      <span className="card-top-row">
                        <span className="vehicle-title-wrap">
                          <Truck size={15} aria-hidden="true" />
                          <span className="v-name">{vehicle.name}</span>
                          <span className="v-id font-mono">{vehicle.id}</span>
                        </span>
                        <StatusBadge status={vehicle.status} size="sm" />
                      </span>

                      <span className="card-driver-row">
                        <span>
                          <User size={12} aria-hidden="true" /> {vehicle.driver ?? 'No driver'}
                        </span>
                      </span>

                      <span className="card-facts-row">
                        <span className="card-fact">
                          <strong>{openAssigned}</strong> open deliver
                          {openAssigned === 1 ? 'y' : 'ies'}
                        </span>
                        <span className="card-fact">
                          {vehicle.coordinates ? 'Position reported' : 'No position'}
                        </span>
                      </span>

                      {noPosition && (
                        <span className="card-warning">
                          <AlertTriangle size={11} aria-hidden="true" /> Tracked, but no position
                          has been reported — not shown on the map
                        </span>
                      )}
                    </button>

                    <div className="card-action-row">
                      {vehicle.isTracked ? (
                        <button
                          type="button"
                          className="btn btn-secondary btn-xs"
                          disabled={!canTrack || pendingId === vehicle.id}
                          onClick={async () => {
                            setPendingId(vehicle.id);
                            await stopTrackingVehicle(vehicle.id);
                            setPendingId(null);
                          }}
                        >
                          <Check size={12} aria-hidden="true" /> Stop tracking
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-primary btn-xs"
                          disabled={!canTrack || pendingId === vehicle.id}
                          onClick={async () => {
                            setPendingId(vehicle.id);
                            await startTrackingVehicle(vehicle.id);
                            setPendingId(null);
                          }}
                        >
                          <Radio size={12} aria-hidden="true" /> Track
                        </button>
                      )}
                      <span className="tracking-state-tag is-inline">
                        {vehicle.isTracked ? 'Tracked' : 'Not tracked'}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="panel-bottom-footer">
            <button
              type="button"
              className="btn btn-secondary full-width btn-sm"
              onClick={() => setIsTrackingModalOpen(true)}
            >
              Manage tracking for all vehicles
            </button>
          </div>
        </aside>

        <div className="tracking-main-map-wrap">
          <LiveFleetMap
            deliveries={deliveries}
            height="100%"
            onNavigateToVehicles={() => onNavigate('vehicles')}
          />
        </div>
      </div>
    </div>
  );
};
