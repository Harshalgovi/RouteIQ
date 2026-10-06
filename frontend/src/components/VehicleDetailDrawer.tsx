import React, { useMemo } from 'react';
import type { Vehicle } from '../types';
import { StatusBadge } from './StatusBadge';
import { useFleet } from '../context/FleetContext';
import { vehicleTypeLabel } from '../utils/status';
import { openDeliveriesForVehicle } from '../utils/assignment';
import { formatApiClock } from '../utils/datetime';
import { EmptyState } from './EmptyState';
import { Package, Pencil, Trash2 } from 'lucide-react';
import {
  X,
  Truck,
  User,
  Phone,
  MapPin,
  Gauge,
  Radio,
  AlertTriangle,
  Info,
} from 'lucide-react';

interface VehicleDetailDrawerProps {
  vehicle: Vehicle | null;
  onClose: () => void;
  /** Open the edit form. Omit when the caller does not support editing. */
  onEdit?: () => void;
  /** Ask for confirmation before deleting. Omit when not supported. */
  onDelete?: () => void;
}

const formatClock = (iso: string | null): string => formatApiClock(iso);

/**
 * Vehicle detail drawer.
 *
 * Every row here is a stored field. RouteIQ does not record speed, battery,
 * destination, ETA or route progress for a vehicle, so those rows are absent
 * rather than filled with plausible-looking numbers — a dispatcher acting on an
 * invented ETA is worse off than one with no ETA.
 */
export const VehicleDetailDrawer: React.FC<VehicleDetailDrawerProps> = ({
  vehicle,
  onClose,
  onEdit,
  onDelete,
}) => {
  const { toggleVehicleTracking, deliveries } = useFleet();

  const assigned = useMemo(
    () => (vehicle ? openDeliveriesForVehicle(deliveries, vehicle) : []),
    [deliveries, vehicle]
  );

  if (!vehicle) return null;

  const loadKg = assigned.reduce((sum, d) => sum + d.weightKg, 0);
  const loadVolume = assigned.reduce((sum, d) => sum + d.volumeM3, 0);

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div
        className="drawer-container"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`${vehicle.id} details`}
      >
        <div className="drawer-header">
          <div className="drawer-title-area">
            <Truck size={20} className="drawer-icon" aria-hidden="true" />
            <div>
              <h3>{vehicle.name}</h3>
              <span className="font-mono">
                {vehicle.id} • {vehicle.licensePlate}
              </span>
            </div>
          </div>
          <button type="button" className="drawer-close-btn" onClick={onClose} aria-label="Close drawer">
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        {(onEdit || onDelete) && (
          <div className="drawer-actions-bar">
            {onEdit && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={onEdit}>
                <Pencil size={13} aria-hidden="true" /> Edit Vehicle
              </button>
            )}
            {onDelete && (
              <button type="button" className="btn btn-danger btn-sm" onClick={onDelete}>
                <Trash2 size={13} aria-hidden="true" /> Delete
              </button>
            )}
          </div>
        )}

        <div className="drawer-body">
          <div className="drawer-status-bar">
            <StatusBadge status={vehicle.status} />
            <span className={vehicle.isTracked ? 'tracking-active-tag' : 'tracking-inactive-tag'}>
              <Radio size={12} aria-hidden="true" />
              {vehicle.isTracked ? 'Tracked' : 'Not tracked'}
            </span>
            {!vehicle.driver && (
              <span className="inline-warning">
                <AlertTriangle size={12} aria-hidden="true" /> No driver assigned
              </span>
            )}
          </div>

          <div className="drawer-section">
            <h4 className="drawer-section-title">Driver &amp; Contact</h4>
            <div className="drawer-info-grid">
              <div className="info-item">
                <span className="info-item-label">Assigned Driver</span>
                <span className="info-item-value">
                  <User size={12} aria-hidden="true" />
                  {vehicle.driver ?? 'Not assigned'}
                </span>
              </div>
              <div className="info-item">
                <span className="info-item-label">Phone Contact</span>
                <span className="info-item-value">
                  <Phone size={12} aria-hidden="true" />
                  {vehicle.driverPhone ?? '—'}
                </span>
              </div>
            </div>
          </div>

          <div className="drawer-section">
            <h4 className="drawer-section-title">Payload Capacity Specs</h4>
            <div className="drawer-info-grid">
              <div className="info-item">
                <span className="info-item-label">Vehicle Type</span>
                <span className="info-item-value">{vehicleTypeLabel(vehicle.type)}</span>
              </div>
              <div className="info-item">
                <span className="info-item-label">Max Payload Weight</span>
                <span className="info-item-value font-mono">{vehicle.capacityKg} kg</span>
              </div>
              <div className="info-item">
                <span className="info-item-label">Max Cargo Volume</span>
                <span className="info-item-value font-mono">{vehicle.capacityVolumeM3} m³</span>
              </div>
              <div className="info-item">
                <span className="info-item-label">Currently Assigned</span>
                <span className="info-item-value font-mono">
                  <Gauge size={12} aria-hidden="true" />
                  {loadKg.toFixed(1)} kg / {loadVolume.toFixed(2)} m³
                </span>
              </div>
            </div>
          </div>

          <div className="drawer-section">
            <h4 className="drawer-section-title">Position</h4>
            <div className="drawer-info-grid">
              <div className="info-item full-width">
                <span className="info-item-label">Last Reported Coordinates</span>
                <span className="info-item-value font-mono">
                  <MapPin size={12} aria-hidden="true" />
                  {vehicle.coordinates
                    ? `${vehicle.coordinates[0].toFixed(5)}, ${vehicle.coordinates[1].toFixed(5)}`
                    : 'No position reported'}
                </span>
              </div>
              <div className="info-item">
                {/*
                  Only one timestamp is shown, and it is labelled for what it
                  actually is. `updated_at` is when the record last changed, not
                  when the vehicle was last observed moving: RouteIQ has no
                  telemetry feed, so presenting it as a "last seen" position
                  time would imply a freshness guarantee the data cannot support.
                */}
                <span className="info-item-label">Record Last Updated</span>
                <span className="info-item-value font-mono">
                  {formatClock(vehicle.updatedAt)}
                </span>
              </div>
            </div>

            {vehicle.isTracked && vehicle.coordinates === null && (
              <p className="drawer-note is-warning">
                <AlertTriangle size={13} aria-hidden="true" />
                Tracking is enabled but the backend holds no coordinates for this vehicle, so it
                cannot be shown on the map.
              </p>
            )}
            {vehicle.isTracked && vehicle.coordinates !== null && (
              <p className="drawer-note">
                <Info size={13} aria-hidden="true" />
                The position above is the last one stored in the database. Enabling tracking tells
                RouteIQ to accept position updates; it does not by itself generate them, and no
                arrival time is estimated from it.
              </p>
            )}
          </div>

          <div className="drawer-section">
            <h4 className="drawer-section-title">
              <Package size={14} aria-hidden="true" /> Open Deliveries ({assigned.length})
            </h4>
            {assigned.length === 0 ? (
              <EmptyState
                icon={Package}
                title="No open deliveries"
                description="Nothing in the database is currently assigned to this vehicle."
              />
            ) : (
              <ul className="drawer-delivery-list">
                {assigned.map((delivery) => (
                  <li key={delivery.id}>
                    <span className="font-mono">{delivery.trackingNumber}</span>
                    <StatusBadge status={delivery.status} size="sm" />
                    <span className="drawer-delivery-recipient">{delivery.recipientName}</span>
                    <span className="drawer-delivery-weight">{delivery.weightKg} kg</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="drawer-section">
            <button
              type="button"
              className={`btn ${vehicle.isTracked ? 'btn-secondary' : 'btn-primary'}`}
              onClick={() => toggleVehicleTracking(vehicle.id)}
              style={{ width: '100%', gap: '0.5rem' }}
            >
              <Radio size={14} aria-hidden="true" />
              {vehicle.isTracked ? 'Stop tracking this vehicle' : 'Start tracking this vehicle'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};