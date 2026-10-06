import React, { useMemo } from 'react';
import type { Delivery, Vehicle } from '../types';
import { EmptyState } from './EmptyState';
import { findVehicleByAnyId } from '../utils/assignment';
import { formatApiClock, apiTimestampMs } from '../utils/datetime';
import { AlertTriangle, Clock, PackageCheck } from 'lucide-react';

interface DelayAlertsProps {
  deliveries: Delivery[];
  vehicles: Vehicle[];
  onViewDelivery: (deliveryId: string) => void;
}

const formatClock = (iso: string | null): string => formatApiClock(iso);

/** Human-readable elapsed/remaining time from a millisecond delta. */
const formatDuration = (ms: number): string => {
  const minutes = Math.round(Math.abs(ms) / 60000);
  if (minutes < 1) return 'under a minute';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
};

/**
 * Delay alerts.
 *
 * Each alert names a specific delivery, its customer, and the window that has
 * slipped — the three things a dispatcher needs to decide what to do.
 *
 * "Delayed: 3" is not shown anywhere. A count tells you there is a problem
 * without telling you which problem, so the panel lists the actual deliveries
 * and says plainly when RouteIQ cannot quantify the slip. RouteIQ does not
 * record a live ETA per delivery, so no "estimated 14:32" is invented here.
 */
export const DelayAlerts: React.FC<DelayAlertsProps> = ({
  deliveries,
  vehicles,
  onViewDelivery,
}) => {
  const alerts = useMemo(() => {
    const delayed = deliveries.filter((d) => d.status === 'delayed');

    // Also flag deliveries whose window has already closed but which are still
    // marked pending or assigned — the database may simply not have been updated.
    const now = Date.now();
    const overdue = deliveries.filter(
      (d) =>
        (d.status === 'pending' || d.status === 'assigned') &&
        d.timeWindowEnd !== null &&
        (apiTimestampMs(d.timeWindowEnd) ?? Infinity) < now
    );

    return { delayed, overdue };
  }, [deliveries]);

  const vehicleName = (delivery: Delivery): string | null => {
    const match = findVehicleByAnyId(vehicles, delivery.assignedVehicleId);
    return match ? match.id : delivery.assignedVehicleId;
  };

  const hasAny = alerts.delayed.length > 0 || alerts.overdue.length > 0;

  if (!hasAny) {
    return (
      <section className="card delay-alerts-card is-clear" aria-labelledby="delay-alerts-heading">
        <h3 className="card-title-text" id="delay-alerts-heading">
          <PackageCheck size={16} aria-hidden="true" /> Delay Alerts
        </h3>
        <EmptyState
          icon={PackageCheck}
          title="Nothing needs attention"
          description="No deliveries are marked delayed and no delivery window has passed while the delivery is still open."
        />
      </section>
    );
  }

  return (
    <section className="card delay-alerts-card" aria-labelledby="delay-alerts-heading">
      <div className="card-header-flex">
        <div>
          <h3 className="card-title-text" id="delay-alerts-heading">
            <AlertTriangle size={16} aria-hidden="true" /> Delay Alerts
          </h3>
          <p className="card-subtitle-text">
            Specific deliveries that are late or past their window.
          </p>
        </div>
        <span className="alert-count" aria-label={`${alerts.delayed.length + alerts.overdue.length} alerts`}>
          {alerts.delayed.length + alerts.overdue.length}
        </span>
      </div>

      <ul className="delay-alert-list">
        {alerts.delayed.map((delivery) => {
          const assigned = vehicleName(delivery);
          const closedBy =
            delivery.timeWindowEnd !== null
              ? (apiTimestampMs(delivery.timeWindowEnd) ?? 0) - Date.now()
              : null;
          return (
            <li key={delivery.id} className="delay-alert-item">
              <div className="delay-alert-head">
                <span className="delay-alert-title">{delivery.trackingNumber}</span>
                <span className="delay-alert-badge">Marked delayed</span>
              </div>
              <p className="delay-alert-customer">{delivery.recipientName}</p>
              <dl className="delay-alert-facts">
                <div>
                  <dt>Window closed</dt>
                  <dd>
                    <Clock size={11} aria-hidden="true" />{' '}
                    {delivery.timeWindowEnd ? formatClock(delivery.timeWindowEnd) : 'No window set'}
                  </dd>
                </div>
                <div>
                  <dt>Assigned to</dt>
                  <dd>{assigned ?? 'No vehicle'}</dd>
                </div>
                <div>
                  <dt>Late by</dt>
                  <dd>
                    {closedBy === null
                      ? 'No window set'
                      : closedBy < 0
                      ? `window passed ${formatDuration(-closedBy)} ago`
                      : `window still open (closes in ${formatDuration(closedBy)})`}
                  </dd>
                </div>
              </dl>
              <button
                type="button"
                className="btn btn-secondary btn-xs"
                onClick={() => onViewDelivery(delivery.id)}
              >
                View delivery
              </button>
            </li>
          );
        })}

        {alerts.overdue.map((delivery) => (
          <li key={delivery.id} className="delay-alert-item is-warning">
            <div className="delay-alert-head">
              <span className="delay-alert-title">{delivery.trackingNumber}</span>
              <span className="delay-alert-badge is-warning">Window passed</span>
            </div>
            <p className="delay-alert-customer">{delivery.recipientName}</p>
            <dl className="delay-alert-facts">
              <div>
                <dt>Window closed</dt>
                <dd>
                  <Clock size={11} aria-hidden="true" /> {formatClock(delivery.timeWindowEnd)}
                </dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{delivery.status.replace('_', ' ')}</dd>
              </div>
              <div>
                <dt>Assigned to</dt>
                <dd>{vehicleName(delivery) ?? 'No vehicle'}</dd>
              </div>
            </dl>
            <button
              type="button"
              className="btn btn-secondary btn-xs"
              onClick={() => onViewDelivery(delivery.id)}
            >
              View delivery
            </button>
          </li>
        ))}
      </ul>

      <p className="delay-alerts-note">
        RouteIQ does not store a live per-delivery ETA, so the slip above is measured against the
        delivery window rather than a live estimate.
      </p>
    </section>
  );
};
