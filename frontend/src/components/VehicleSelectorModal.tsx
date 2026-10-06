import React, { useMemo, useState } from 'react';
import { useFleet } from '../context/FleetContext';
import { StatusBadge } from './StatusBadge';
import { vehicleTypeLabel } from '../utils/status';
import { openDeliveryCountForVehicle, indexOpenDeliveriesByVehicle } from '../utils/assignment';
import { X, Search, Truck, Radio, Check, AlertTriangle, Loader2 } from 'lucide-react';

/**
 * Fleet-wide tracking control.
 *
 * Each action calls the real tracking endpoint and waits for it. The button
 * stays disabled and shows progress while in flight, and the modal closes only
 * after the server confirms — previously it closed optimistically, so a failed
 * request looked like it had worked.
 */
export const VehicleSelectorModal: React.FC = () => {
  const {
    vehicles,
    deliveries,
    isTrackingModalOpen,
    setIsTrackingModalOpen,
    startTrackingVehicle,
    stopTrackingVehicle,
    dataSource,
    loadState,
  } = useFleet();

  const [filterText, setFilterText] = useState('');
  const [filterType, setFilterType] = useState<string>('all');
  const [pendingId, setPendingId] = useState<string | null>(null);

  const openByVehicle = useMemo(() => indexOpenDeliveriesByVehicle(deliveries), [deliveries]);
  const trackedCount = vehicles.filter((v) => v.isTracked).length;

  if (!isTrackingModalOpen) return null;

  const needle = filterText.trim().toLowerCase();
  const filteredVehicles = vehicles.filter((v) => {
    const matchesSearch =
      needle === '' ||
      v.name.toLowerCase().includes(needle) ||
      v.id.toLowerCase().includes(needle) ||
      (v.driver ?? '').toLowerCase().includes(needle);
    const matchesType = filterType === 'all' || v.type === filterType;
    return matchesSearch && matchesType;
  });

  const backendConnected = dataSource === 'backend' && loadState === 'success';
  const close = () => setIsTrackingModalOpen(false);

  const handleTrack = async (vehicleId: string) => {
    setPendingId(vehicleId);
    // The server response arrives before the modal closes, so a rejection leaves
    // the operator looking at the list with the error in place.
    await startTrackingVehicle(vehicleId);
    setPendingId(null);
  };

  const handleStop = async (vehicleId: string) => {
    setPendingId(vehicleId);
    await stopTrackingVehicle(vehicleId);
    setPendingId(null);
  };

  return (
    <div className="modal-overlay" onClick={close}>
      <div
        className="modal-container"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Manage vehicle tracking"
      >
        <div className="modal-header">
          <div className="modal-title-area">
            <Radio size={20} className="modal-icon" aria-hidden="true" />
            <div>
              <h3>Manage Vehicle Tracking</h3>
              <p>
                Turning tracking on lets RouteIQ store position updates for a vehicle. It does not
                produce an estimated arrival time.
              </p>
            </div>
          </div>
          <button type="button" className="modal-close-btn" onClick={close} aria-label="Close modal">
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        {!backendConnected && (
          <p className="inline-banner is-warning" role="status">
            <AlertTriangle size={14} aria-hidden="true" />
            Tracking can only be changed while the backend is connected.
          </p>
        )}

        {/* Action errors render once, globally, in Layout. */}

        <div className="modal-filters">
          <div className="modal-search">
            <Search size={15} aria-hidden="true" />
            <label className="visually-hidden" htmlFor="modal-vehicle-search">
              Search vehicles
            </label>
            <input
              id="modal-vehicle-search"
              type="text"
              placeholder="Search by vehicle ID, name, driver..."
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
            />
          </div>
          <label className="visually-hidden" htmlFor="modal-vehicle-type">
            Vehicle type
          </label>
          <select
            id="modal-vehicle-type"
            className="modal-select"
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
          >
            <option value="all">All Vehicle Types</option>
            <option value="van">Van</option>
            <option value="truck">Truck</option>
            <option value="bike">E-Bike</option>
            <option value="refrigerated">Refrigerated</option>
          </select>
        </div>

        <div className="modal-vehicle-list">
          {filteredVehicles.length === 0 ? (
            <p className="modal-empty">
              {vehicles.length === 0
                ? 'No vehicles exist yet. Add one on the Vehicles page.'
                : 'No vehicles matched this search.'}
            </p>
          ) : (
            filteredVehicles.map((vehicle) => {
              const busy = pendingId === vehicle.id;
              const openCount = openDeliveryCountForVehicle(openByVehicle, vehicle);

              return (
                <div
                  key={vehicle.id}
                  className={`modal-vehicle-item ${vehicle.isTracked ? 'is-tracked' : ''}`}
                >
                  <div className="item-icon">
                    <Truck size={18} aria-hidden="true" />
                  </div>
                  <div className="item-details">
                    <div className="item-title">
                      <span className="item-name">{vehicle.name}</span>
                      <span className="item-id font-mono">{vehicle.id}</span>
                    </div>
                    <div className="item-sub">
                      <span>Driver: {vehicle.driver ?? 'Not assigned'}</span>
                      <span aria-hidden="true">&bull;</span>
                      <span>
                        {vehicleTypeLabel(vehicle.type)} &bull; {vehicle.capacityKg} kg /{' '}
                        {vehicle.capacityVolumeM3} m³
                      </span>
                      <span aria-hidden="true">&bull;</span>
                      <span>
                        {openCount} open deliver{openCount === 1 ? 'y' : 'ies'}
                      </span>
                    </div>
                  </div>

                  <div className="item-status">
                    <StatusBadge status={vehicle.status} size="sm" />
                    {vehicle.isTracked && !vehicle.coordinates && (
                      <span className="table-subtext inline-warning">No position yet</span>
                    )}
                  </div>

                  <div className="item-action">
                    {vehicle.isTracked ? (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={!backendConnected || busy}
                        onClick={() => handleStop(vehicle.id)}
                      >
                        {busy ? <Loader2 size={14} className="spin" aria-hidden="true" /> : <Check size={14} aria-hidden="true" />}
                        Stop tracking
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={!backendConnected || busy}
                        onClick={() => handleTrack(vehicle.id)}
                      >
                        {busy ? <Loader2 size={14} className="spin" aria-hidden="true" /> : <Radio size={14} aria-hidden="true" />}
                        Track
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="modal-footer">
          <span className="footer-count">
            {trackedCount} of {vehicles.length} vehicles tracked
          </span>
          <button type="button" className="btn btn-secondary" onClick={close}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
};