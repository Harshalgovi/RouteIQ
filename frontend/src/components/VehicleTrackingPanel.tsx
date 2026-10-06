import React from 'react';
import type { Delivery, Vehicle } from '../types';
import { StatusBadge } from './StatusBadge';
import { describeVehicleStatus } from '../utils/status';
import { formatApiClock, apiTimestampMs } from '../utils/datetime';
import { useFleet } from '../context/FleetContext';
import { X, Truck, User, Phone, MapPin, Radio, Package, Info } from 'lucide-react';

interface VehicleTrackingPanelProps {
  vehicle: Vehicle;
  /** Deliveries the database currently assigns to this vehicle. */
  deliveries: Delivery[];
  onClose: () => void;
}

const formatClock = (iso: string | null): string => formatApiClock(iso);

/**
 * Vehicle detail panel.
 *
 * Shows only fields the backend stores: status, driver, last reported position,
 * the time window, and the deliveries the database actually assigns to this
 * vehicle.
 *
 * There is deliberately no ETA, speed, battery or route-progress figure. The
 * backend does not record those, so a value here would be invented — and a
 * dispatcher acting on an invented ETA is worse off than one who knows it is
 * missing. Where an ETA would help, the panel says where to get a real one.
 */
export const VehicleTrackingPanel: React.FC<VehicleTrackingPanelProps> = ({
  vehicle,
  deliveries,
  onClose,
}) => {
  const { toggleVehicleTracking } = useFleet();
  const status = describeVehicleStatus(vehicle.status);
  const openDeliveries = deliveries.filter(
    (d) => d.status !== 'delivered' && d.status !== 'cancelled'
  );
  const nextByWindow = [...openDeliveries]
    .filter((d) => d.timeWindowStart || d.timeWindowEnd)
    .sort((a, b) => {
      const left = a.timeWindowStart
        ? (apiTimestampMs(a.timeWindowStart) ?? Infinity)
        : Infinity;
      const right = b.timeWindowStart
        ? (apiTimestampMs(b.timeWindowStart) ?? Infinity)
        : Infinity;
      return left - right;
    })[0];

  return (
    <aside className="vehicle-tracking-panel" aria-label={`Details for ${vehicle.id}`}>
      <div className="panel-header">
        <div className="panel-title-area">
          <div className="vehicle-icon-badge" aria-hidden="true">
            <Truck size={18} />
          </div>
          <div>
            <h3 className="panel-vehicle-name">{vehicle.name}</h3>
            <span className="panel-vehicle-id">
              {vehicle.id} · {vehicle.licensePlate}
            </span>
          </div>
        </div>
        <button
          type="button"
          className="panel-close-btn"
          onClick={onClose}
          aria-label={`Close details for ${vehicle.id}`}
        >
          <X size={16} />
        </button>
      </div>

      <div className="panel-status-bar">
        <StatusBadge status={vehicle.status} />
        <span className={`tracking-state-tag ${vehicle.isTracked ? 'is-on' : 'is-off'}`}>
          <Radio size={12} aria-hidden="true" />{' '}
          {vehicle.isTracked ? 'Tracking on' : 'Tracking off'}
        </span>
      </div>

      <p className="panel-status-meaning">{status.meaning}</p>

      <div className="panel-body">
        <div className="panel-row">
          <User size={14} className="panel-icon" aria-hidden="true" />
          <div className="panel-row-content">
            <span className="panel-label">Driver</span>
            <span className="panel-value">{vehicle.driver ?? 'No driver assigned'}</span>
          </div>
          {vehicle.driverPhone && (
            <a
              href={`tel:${vehicle.driverPhone}`}
              className="call-driver-btn"
              title={`Call ${vehicle.driver ?? 'driver'}`}
              aria-label={`Call ${vehicle.driver ?? 'driver'}`}
            >
              <Phone size={13} />
            </a>
          )}
        </div>

        <div className="panel-row">
          <MapPin size={14} className="panel-icon" aria-hidden="true" />
          <div className="panel-row-content">
            <span className="panel-label">Last reported position</span>
            <span className="panel-value">
              {vehicle.coordinates ? (
                <>
                  {vehicle.coordinates[0].toFixed(5)}, {vehicle.coordinates[1].toFixed(5)}
                  <span className="panel-value-note">
                    last updated {formatClock(vehicle.updatedAt)}
                  </span>
                </>
              ) : (
                <span className="panel-value-missing">
                  None reported — this vehicle cannot be shown on the map
                </span>
              )}
            </span>
          </div>
        </div>

        <div className="panel-row">
          <Package size={14} className="panel-icon" aria-hidden="true" />
          <div className="panel-row-content">
            <span className="panel-label">Assigned in database</span>
            <span className="panel-value">
              {openDeliveries.length} open deliver{openDeliveries.length === 1 ? 'y' : 'ies'}
              {deliveries.length !== openDeliveries.length &&
                ` · ${deliveries.length - openDeliveries.length} completed`}
            </span>
          </div>
        </div>

        {nextByWindow ? (
          <div className="panel-next-stop">
            <span className="panel-label">Next window to open</span>
            <span className="panel-value">{nextByWindow.trackingNumber}</span>
            <span className="panel-value-note">
              {nextByWindow.recipientName} · window{' '}
              {nextByWindow.timeWindowStart
                ? `${formatClock(nextByWindow.timeWindowStart)}–${formatClock(nextByWindow.timeWindowEnd)}`
                : 'not set'}
            </span>
          </div>
        ) : (
          openDeliveries.length === 0 && (
            <p className="panel-hint">
              No deliveries are assigned to this vehicle. Use the Route Planner to propose a route.
            </p>
          )
        )}

        <p className="panel-hint panel-hint-info">
          <Info size={12} aria-hidden="true" /> RouteIQ does not store a live ETA or speed. Use
          Route Planner to get real travel times from the routing provider.
        </p>

        <div className="panel-footer-actions">
          <button
            type="button"
            className={`btn ${vehicle.isTracked ? 'btn-secondary' : 'btn-primary'} full-width`}
            onClick={() => toggleVehicleTracking(vehicle.id)}
          >
            <Radio size={14} aria-hidden="true" />
            {vehicle.isTracked ? 'Stop tracking this vehicle' : 'Track this vehicle'}
          </button>
        </div>
      </div>
    </aside>
  );
};
