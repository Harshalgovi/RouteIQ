import React, { useMemo } from 'react';
import type { Delivery, OptimizationResult, Vehicle } from '../types';
import { StatusBadge } from './StatusBadge';
import { EmptyState } from './EmptyState';
import { Route as RouteIcon, Clock, AlertTriangle, MapPin } from 'lucide-react';
import { formatApiClock, apiTimestampMs } from '../utils/datetime';

interface ActiveRoutesProps {
  vehicles: Vehicle[];
  deliveries: Delivery[];
  /**
   * Last optimization result, when the planner has produced one. This is the
   * only place a real stop order, distance and ETA exists, so the table uses it
   * when available and says so plainly when it does not.
   */
  optimization: OptimizationResult | null;
  onFocusVehicle: (vehicleId: string) => void;
}

const formatClock = (iso: string | null): string => formatApiClock(iso);

/**
 * Active routes table.
 *
 * Two honest sources, in priority order:
 *
 *  1. A real optimization run — real stop order, real distance, real ETAs
 *     computed by the routing provider.
 *  2. Database assignments only — how many deliveries each vehicle owns. No
 *     stop order and no ETA, because nothing in the database records either.
 *
 * It never blends the two, because a table mixing planned routes with database
 * assignments invites the reader to assume the plan is being executed.
 */
export const ActiveRoutes: React.FC<ActiveRoutesProps> = ({
  vehicles,
  deliveries,
  optimization,
  onFocusVehicle,
}) => {
  const plannedRoutes = optimization?.routes ?? [];

  const assignmentRows = useMemo(() => {
    return vehicles
      .map((vehicle) => {
        const assigned = deliveries.filter(
          (d) =>
            d.assignedVehicleId === vehicle.id &&
            d.status !== 'delivered' &&
            d.status !== 'cancelled'
        );
        return { vehicle, assigned };
      })
      .filter((row) => row.assigned.length > 0);
  }, [vehicles, deliveries]);

  const hasPlanned = plannedRoutes.length > 0;

  return (
    <section className="card active-routes-card" aria-labelledby="active-routes-heading">
      <div className="card-header-flex">
        <div>
          <h3 className="card-title-text" id="active-routes-heading">
            <RouteIcon size={16} aria-hidden="true" /> Active Routes
          </h3>
          <p className="card-subtitle-text">
            {hasPlanned
              ? 'From the last optimization run — real stop order and travel times from the routing provider.'
              : 'Database assignments per vehicle. Run the Route Planner for stop order and ETAs.'}
          </p>
        </div>
      </div>

      {hasPlanned ? (
        <div className="table-responsive">
          <table className="data-table compact">
            <caption className="visually-hidden">
              Routes from the last optimization run, with stop counts, next stop and return time.
            </caption>
            <thead>
              <tr>
                <th scope="col">Vehicle</th>
                <th scope="col">Driver</th>
                <th scope="col">Stops</th>
                <th scope="col">Distance</th>
                <th scope="col">Next delivery</th>
                <th scope="col">Arrives</th>
                <th scope="col">Back by</th>
              </tr>
            </thead>
            <tbody>
              {plannedRoutes.map((route) => {
                const first = route.stops[0];
                const late = route.has_time_window_violations;
                return (
                  <tr
                    key={route.vehicle_id}
                    className="table-row hoverable"
                    onClick={() => onFocusVehicle(String(route.vehicle_id))}
                  >
                    <th scope="row" className="table-row-header">
                      <span className="font-mono">{route.vehicle_number}</span>
                      <span className="table-subtext">{route.vehicle_name}</span>
                    </th>
                    <td>{route.driver_name ?? <span className="muted-text">No driver</span>}</td>
                    <td className="font-mono">{route.stop_count}</td>
                    <td className="font-mono">{route.distance_km.toFixed(1)} km</td>
                    <td className="table-address-cell">
                      {first ? (
                        <>
                          <span className="font-mono">{first.tracking_number}</span>
                          <span className="table-subtext">{first.customer_name}</span>
                        </>
                      ) : (
                        <span className="muted-text">No stops</span>
                      )}
                    </td>
                    <td className="font-mono">
                      {first ? formatClock(first.service_start) : '—'}
                      {first?.wait_seconds ? (
                        <span className="table-subtext">
                          waits {Math.round(first.wait_seconds / 60)} min
                        </span>
                      ) : null}
                    </td>
                    <td className="font-mono">
                      {route.estimated_return ? formatClock(route.estimated_return) : '—'}
                      {late && (
                        <span className="table-subtext inline-warning">
                          <AlertTriangle size={11} aria-hidden="true" /> window missed
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : assignmentRows.length > 0 ? (
        <div className="table-responsive">
          <table className="data-table compact">
            <caption className="visually-hidden">
              Deliveries assigned to each vehicle in the database.
            </caption>
            <thead>
              <tr>
                <th scope="col">Vehicle</th>
                <th scope="col">Status</th>
                <th scope="col">Driver</th>
                <th scope="col">Open deliveries</th>
                <th scope="col">Load</th>
                <th scope="col">Next window</th>
              </tr>
            </thead>
            <tbody>
              {assignmentRows.map(({ vehicle, assigned }) => {
                const next = [...assigned]
                  .filter((d) => d.timeWindowStart)
                  .sort(
                    (a, b) =>
                      (apiTimestampMs(a.timeWindowStart) ?? Infinity) -
                      (apiTimestampMs(b.timeWindowStart) ?? Infinity)
                  )[0];
                return (
                  <tr
                    key={vehicle.id}
                    className="table-row hoverable"
                    onClick={() => onFocusVehicle(vehicle.id)}
                  >
                    <th scope="row" className="table-row-header">
                      <span className="font-mono">{vehicle.id}</span>
                      <span className="table-subtext">{vehicle.name}</span>
                    </th>
                    <td>
                      <StatusBadge status={vehicle.status} size="sm" />
                    </td>
                    <td>{vehicle.driver ?? <span className="muted-text">No driver</span>}</td>
                    <td className="font-mono">{assigned.length}</td>
                    <td className="font-mono">
                      {assigned.reduce((sum, d) => sum + d.weightKg, 0).toFixed(1)} /{' '}
                      {vehicle.capacityKg} kg
                    </td>
                    <td>
                      {next ? (
                        <>
                          <span className="font-mono">{formatClock(next.timeWindowStart)}</span>
                          <span className="table-subtext">{next.trackingNumber}</span>
                        </>
                      ) : (
                        <span className="muted-text">No windows set</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          icon={RouteIcon}
          title="No routes to show"
          description="No vehicle has deliveries assigned in the database, and no optimization run has been made yet. Assign deliveries or run the Route Planner."
        />
      )}
    </section>
  );
};

export const ActiveRoutesLegend: React.FC = () => (
  <p className="active-routes-legend">
    <Clock size={12} aria-hidden="true" /> Times come from the routing provider at the moment the
    plan was solved. <MapPin size={12} aria-hidden="true" /> They do not update as traffic changes.
  </p>
);
