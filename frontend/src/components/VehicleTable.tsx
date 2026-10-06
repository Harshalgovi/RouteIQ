import React, { useMemo, useState } from 'react';
import type { Vehicle } from '../types';
import { StatusBadge } from './StatusBadge';
import { useFleet } from '../context/FleetContext';
import { describeVehicleStatus, vehicleTypeLabel } from '../utils/status';
import { indexOpenDeliveriesByVehicle, openDeliveryCountForVehicle } from '../utils/assignment';
import { EmptyState } from './EmptyState';
import { Truck, User, Gauge, MapPin, Radio, Check, Eye, Search, Filter, AlertTriangle, Pencil, Trash2 } from 'lucide-react';
import type { PendingTableFilter } from './DeliveryTable';

interface VehicleTableProps {
  onSelectVehicle: (vehicle: Vehicle) => void;
  /** Filter requested by another page, e.g. "no-driver" or "dispatchable". */
  pendingFilter?: PendingTableFilter | null;
  /** Open the edit form for a vehicle. Omit to hide the edit action. */
  onEditVehicle?: (vehicle: Vehicle) => void;
  /** Ask for confirmation before removing a vehicle. Omit to hide the action. */
  onDeleteVehicle?: (vehicle: Vehicle) => void;
}


 /**
 * Fleet table.
 *
 * Shows only what the backend stores. There is no current route, no location
 * name, no speed and no battery column, because no such data exists — a blank
 * cell would invite the question, so each one states what is missing instead.
 */
export const VehicleTable: React.FC<VehicleTableProps> = ({
  onSelectVehicle,
  pendingFilter,
  onEditVehicle,
  onDeleteVehicle,
}) => {
  const { vehicles, deliveries, startTrackingVehicle, stopTrackingVehicle } = useFleet();

  // A dashboard request arrives as new props; manual edits live in state. `nonce`
  // records which request the manual filters belong to, so a new request wins
  // once and then the user's own changes take over again.
  const [manualFilters, setManualFilters] = useState({
    nonce: -1,
    searchTerm: '',
    statusFilter: 'all',
    trackingFilter: 'all',
    driverFilter: 'all' as 'all' | 'missing',
  });
  
  const [pendingVehicleId, setPendingVehicleId] = useState<string | null>(null);

  const effective =
    pendingFilter && pendingFilter.nonce !== manualFilters.nonce
      ? requestedFilters(pendingFilter.value)
      : manualFilters;

  /**
   * Any manual filter change takes ownership from the dashboard request, so the
   * table does not snap back on the next render.
   */
  const claimFilterChange = (
    patch: Partial<{
      searchTerm: string;
      statusFilter: string;
      trackingFilter: string;
      driverFilter: 'all' | 'missing';
    }>
  ) => {
    const status = patch.statusFilter ?? effective.statusFilter;
    // Switching status can imply a derived view, so start from its defaults and
    // let any explicitly supplied patch override them.
    const requested = requestedFilters(status);
    setManualFilters({
      nonce: pendingFilter?.nonce ?? -1,
      searchTerm: patch.searchTerm ?? '',
      statusFilter: status,
      trackingFilter: patch.trackingFilter ?? requested.trackingFilter,
      driverFilter: patch.driverFilter ?? requested.driverFilter,
    });
  };

  const openDeliveriesByVehicle = useMemo(
    () => indexOpenDeliveriesByVehicle(deliveries),
    [deliveries]
  );

  const filteredVehicles = vehicles.filter((v) => {
    const needle = effective.searchTerm.trim().toLowerCase();
    const matchesSearch =
      needle === '' ||
      v.name.toLowerCase().includes(needle) ||
      v.id.toLowerCase().includes(needle) ||
      (v.driver ?? '').toLowerCase().includes(needle) ||
      v.licensePlate.toLowerCase().includes(needle);

    // "dispatchable" is a derived view, not a stored status: it means the
    // statuses the route optimizer is allowed to use.
    const matchesStatus =
      effective.statusFilter === 'all' ||
      (effective.statusFilter === 'dispatchable'
        ? v.status === 'available' || v.status === 'active'
        : v.status === effective.statusFilter);

    const matchesTracking =
      effective.trackingFilter === 'all' ||
      (effective.trackingFilter === 'tracked' && v.isTracked) ||
      (effective.trackingFilter === 'untracked' && !v.isTracked);

    const matchesDriver = effective.driverFilter === 'all' || !v.driver;

    return matchesSearch && matchesStatus && matchesTracking && matchesDriver;
  });

  return (
    <div className="card vehicle-table-card">
      <div className="table-toolbar">
        <div className="table-search">
          <Search size={15} aria-hidden="true" />
          <label className="visually-hidden" htmlFor="vehicle-search">
            Search vehicles
          </label>
          <input
            id="vehicle-search"
            type="text"
            placeholder="Search by vehicle ID, name, driver, or license plate..."
            value={effective.searchTerm}
            onChange={(e) => claimFilterChange({ searchTerm: e.target.value })}
          />
        </div>

        <div className="table-filters">
          <div className="filter-select-wrapper">
            <Filter size={14} className="filter-icon" aria-hidden="true" />
            <label className="visually-hidden" htmlFor="vehicle-status-filter">
              Vehicle status
            </label>
            <select
              id="vehicle-status-filter"
              value={effective.statusFilter}
              onChange={(e) => claimFilterChange({ statusFilter: e.target.value })}
              className="table-select"
            >
              <option value="all">All Statuses</option>
              <option value="dispatchable">Dispatchable (available or active)</option>
              {Object.entries(describeVehicleStatusLabels()).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div className="filter-select-wrapper">
            <label className="visually-hidden" htmlFor="vehicle-driver-filter">
              Driver
            </label>
            <select
              id="vehicle-driver-filter"
              value={effective.driverFilter}
              onChange={(e) =>
                claimFilterChange({ driverFilter: e.target.value as 'all' | 'missing' })
              }
              className="table-select"
            >
              <option value="all">All Drivers</option>
              <option value="missing">No driver assigned</option>
            </select>
          </div>

          <div className="filter-select-wrapper">
            <label className="visually-hidden" htmlFor="vehicle-tracking-filter">
              Tracking state
            </label>
            <select
              id="vehicle-tracking-filter"
              value={effective.trackingFilter}
              onChange={(e) => claimFilterChange({ trackingFilter: e.target.value })}
              className="table-select"
            >
              <option value="all">All Tracking States</option>
              <option value="tracked">Tracked Only</option>
              <option value="untracked">Not Tracked Only</option>
            </select>
          </div>
        </div>
      </div>

      {filteredVehicles.length === 0 ? (
        <EmptyState
          icon={Truck}
          title={vehicles.length === 0 ? 'No vehicles in the fleet' : 'No vehicles match these filters'}
          description={
            vehicles.length === 0
              ? 'A vehicle needs a capacity and a status before the route planner can use it.'
              : 'Clear the filters above to see the whole fleet.'
          }
          action={
            vehicles.length > 0 ? (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => claimFilterChange({ statusFilter: 'all' })}
              >
                Clear filters
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="table-responsive">
          <table className="data-table">
            <caption className="visually-hidden">
              Fleet vehicles with status, driver, capacity, assignment and tracking state.
            </caption>
            <thead>
              <tr>
                <th scope="col">Vehicle</th>
                <th scope="col">Type &amp; Plate</th>
                <th scope="col">Status</th>
                <th scope="col">Driver</th>
                <th scope="col">Capacity</th>
                <th scope="col">Assigned &amp; Position</th>
                <th scope="col">Tracking</th>
                <th scope="col" style={{ textAlign: 'right' }}>
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredVehicles.map((vehicle) => {
                const openCount = openDeliveryCountForVehicle(openDeliveriesByVehicle, vehicle);
                const busy = pendingVehicleId === vehicle.id;

                return (
                  <tr key={vehicle.id} className="table-row hoverable">
                    <th scope="row">
                      <button
                        type="button"
                        className="vehicle-name-button"
                        onClick={() => onSelectVehicle(vehicle)}
                      >
                        <span className="vehicle-table-icon">
                          <Truck size={16} aria-hidden="true" />
                        </span>
                        <span>
                          <span className="vehicle-name-text">{vehicle.name}</span>
                          <span className="font-mono table-subtext">{vehicle.id}</span>
                        </span>
                      </button>
                    </th>
                    <td>
                      <div style={{ fontWeight: 500 }}>{vehicleTypeLabel(vehicle.type)}</div>
                      <div className="font-mono table-subtext">{vehicle.licensePlate}</div>
                    </td>
                    <td>
                      <StatusBadge status={vehicle.status} size="sm" />
                    </td>
                    <td>
                      {vehicle.driver ? (
                        <>
                          <div style={{ fontWeight: 500 }}>
                            <User size={12} aria-hidden="true" /> {vehicle.driver}
                          </div>
                          {vehicle.driverPhone && (
                            <div className="table-subtext">{vehicle.driverPhone}</div>
                          )}
                        </>
                      ) : (
                        <span className="inline-warning">
                          <AlertTriangle size={11} aria-hidden="true" /> No driver
                        </span>
                      )}
                    </td>
                    <td className="font-mono table-subtext">
                      <Gauge size={12} aria-hidden="true" />
                      {vehicle.capacityKg} kg / {vehicle.capacityVolumeM3} m³
                    </td>
                    <td>
                      <div style={{ fontWeight: 500 }}>
                        {openCount} open deliver{openCount === 1 ? 'y' : 'ies'}
                      </div>
                      <div className="table-subtext">
                        {vehicle.coordinates ? (
                          <>
                            <MapPin size={11} aria-hidden="true" /> {vehicle.coordinates[0].toFixed(4)},{' '}
                            {vehicle.coordinates[1].toFixed(4)}
                          </>
                        ) : (
                          'No position reported'
                        )}
                      </div>
                    </td>
                    <td>
                      {vehicle.isTracked ? (
                        <span className="tracking-active-tag">
                          <Radio size={12} aria-hidden="true" /> Tracked
                        </span>
                      ) : (
                        <span className="tracking-inactive-tag">Not tracked</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'flex-end' }}>
                        {vehicle.isTracked ? (
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            disabled={busy}
                            onClick={async () => {
                              setPendingVehicleId(vehicle.id);
                              await stopTrackingVehicle(vehicle.id);
                              setPendingVehicleId(null);
                            }}
                          >
                            <Check size={13} aria-hidden="true" /> Stop tracking
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            disabled={busy}
                            onClick={async () => {
                              setPendingVehicleId(vehicle.id);
                              await startTrackingVehicle(vehicle.id);
                              setPendingVehicleId(null);
                            }}
                          >
                            <Radio size={13} aria-hidden="true" /> Track
                          </button>
                        )}

                        <button
                          type="button"
                          className="btn-icon"
                          onClick={() => onSelectVehicle(vehicle)}
                          title={`View ${vehicle.id} details`}
                          aria-label={`View ${vehicle.id} details`}
                        >
                          <Eye size={15} aria-hidden="true" />
                        </button>

                        {onEditVehicle && (
                          <button
                            type="button"
                            className="btn-icon"
                            onClick={() => onEditVehicle(vehicle)}
                            title={`Edit ${vehicle.id}`}
                            aria-label={`Edit ${vehicle.id}`}
                          >
                            <Pencil size={15} aria-hidden="true" />
                          </button>
                        )}

                        {onDeleteVehicle && (
                          <button
                            type="button"
                            className="btn-icon danger"
                            onClick={() => onDeleteVehicle(vehicle)}
                            title={`Delete ${vehicle.id}`}
                            aria-label={`Delete ${vehicle.id}`}
                          >
                            <Trash2 size={15} aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

/**
 * Translate a dashboard filter request into table filter values.
 *
 * `no-driver` and `dispatchable` are derived views rather than stored statuses,
 * which is why they need their own columns instead of landing in the status
 * select.
 */
function requestedFilters(value: string) {
  switch (value) {
    case 'no-driver':
      return {
        searchTerm: '',
        statusFilter: 'all',
        trackingFilter: 'all',
        driverFilter: 'missing' as const,
      };
    case 'dispatchable':
      return {
        searchTerm: '',
        statusFilter: 'dispatchable',
        trackingFilter: 'all',
        driverFilter: 'all' as const,
      };
    case 'tracked':
      return {
        searchTerm: '',
        statusFilter: 'all',
        trackingFilter: 'tracked',
        driverFilter: 'all' as const,
      };
    default:
      return {
        searchTerm: '',
        statusFilter: value,
        trackingFilter: 'all',
        driverFilter: 'all' as const,
      };
  }
}

/** Labels for the status dropdown, taken from the shared vocabulary. */
function describeVehicleStatusLabels(): Record<string, string> {
  return {
    available: describeVehicleStatus('available').label,
    active: describeVehicleStatus('active').label,
    in_transit: describeVehicleStatus('in_transit').label,
    delivering: describeVehicleStatus('delivering').label,
    delayed: describeVehicleStatus('delayed').label,
    offline: describeVehicleStatus('offline').label,
    maintenance: describeVehicleStatus('maintenance').label,
  };
}