import React, { useMemo, useState } from 'react';
import type { Delivery, OptimizationResult, Vehicle } from '../types';
import { StatusBadge } from './StatusBadge';
import { EmptyState } from './EmptyState';
import { openDeliveriesForVehicle } from '../utils/assignment';
import { ArrowUpDown, Route as RouteIcon } from 'lucide-react';

type SortKey = 'distance' | 'deliveries' | 'load' | 'delays';

/** Sort keys that compare plain numbers, so no cast is needed in the comparator. */
type NumericSortKey = Exclude<SortKey, 'distance'>;

interface RoutePerformanceProps {
  vehicles: Vehicle[];
  deliveries: Delivery[];
  optimization: OptimizationResult | null;
}

interface PerformanceRow {
  vehicle: Vehicle;
  deliveries: number;
  loadKg: number;
  loadPercent: number;
  delays: number;
  distanceKm: number | null;
  durationMinutes: number | null;
  windowViolations: boolean | null;
}

/**
 * Row shape restricted to the plain-number columns, so the comparator can index
 * it without a cast that would hide a rename.
 */
type SortableRow = PerformanceRow & Record<NumericSortKey, number>;

const SORT_LABEL: Record<SortKey, string> = {
  distance: 'Distance',
  deliveries: 'Deliveries',
  load: 'Load',
  delays: 'Delays',
};

/**
 * Per-vehicle route performance.
 *
 * Distance and stop count come from the last real optimization run. When no run
 * exists those columns are marked "Not available" instead of being filled from
 * an estimate, and the sortable columns fall back to the ones that are real:
 * deliveries assigned, load, and delays.
 */
export const RoutePerformance: React.FC<RoutePerformanceProps> = ({
  vehicles,
  deliveries,
  optimization,
}) => {
  const [sortKey, setSortKey] = useState<SortKey>('deliveries');
  const [ascending, setAscending] = useState(false);

  const plannedById = useMemo(() => {
    const map = new Map<number, OptimizationResult['routes'][number]>();
    for (const route of optimization?.routes ?? []) map.set(route.vehicle_id, route);
    return map;
  }, [optimization]);

  const rows = useMemo<PerformanceRow[]>(() => {
    return vehicles.map((vehicle): PerformanceRow => {
      const assigned = openDeliveriesForVehicle(deliveries, vehicle);
      const planned =
        vehicle._backendId !== undefined ? plannedById.get(vehicle._backendId) : undefined;
      const loadKg = assigned.reduce((sum, d) => sum + d.weightKg, 0);

      return {
        vehicle,
        deliveries: assigned.length,
        loadKg,
        loadPercent: vehicle.capacityKg > 0 ? (loadKg / vehicle.capacityKg) * 100 : 0,
        delays: assigned.filter((d) => d.status === 'delayed').length,
        distanceKm: planned?.distance_km ?? null,
        durationMinutes: planned?.duration_minutes ?? null,
        windowViolations: planned?.has_time_window_violations ?? null,
      };
    });
  }, [vehicles, deliveries, plannedById]);

  const sorted = useMemo(() => {
    const direction = ascending ? 1 : -1;
    return [...rows].sort((a, b) => {
      if (sortKey === 'distance') {
        // Vehicles with no plan sort last regardless of direction.
        if (a.distanceKm === null && b.distanceKm === null) return 0;
        if (a.distanceKm === null) return 1;
        if (b.distanceKm === null) return -1;
        return (a.distanceKm - b.distanceKm) * direction;
      }
      const aNum = a as SortableRow;
      const bNum = b as SortableRow;
      return (aNum[sortKey] - bNum[sortKey]) * direction;
    });
  }, [rows, sortKey, ascending]);

  const hasPlan = plannedById.size > 0;

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setAscending((prev) => !prev);
    } else {
      setSortKey(key);
      setAscending(false);
    }
  };

  if (vehicles.length === 0) {
    return (
      <section className="card performance-card" aria-labelledby="performance-heading">
        <h3 className="card-title-text" id="performance-heading">
          <RouteIcon size={16} aria-hidden="true" /> Route Performance
        </h3>
        <EmptyState
          icon={RouteIcon}
          title="No vehicles to report on"
          description="Add vehicles to compare how much work each one is carrying."
        />
      </section>
    );
  }

  return (
    <section className="card performance-card" aria-labelledby="performance-heading">
      <div className="card-header-flex">
        <div>
          <h3 className="card-title-text" id="performance-heading">
            <RouteIcon size={16} aria-hidden="true" /> Route Performance
          </h3>
          <p className="card-subtitle-text">
            {hasPlan
              ? 'Distance and time from the last optimization run; deliveries and load from the database.'
              : 'Deliveries and load from the database. Distance appears after a Route Planner run.'}
          </p>
        </div>
      </div>

      <div className="table-responsive">
        <table className="data-table compact sortable-table">
          <caption className="visually-hidden">
            Per-vehicle deliveries, load, delays, and planned distance. Use the column buttons to sort.
          </caption>
          <thead>
            <tr>
              <th scope="col">Vehicle</th>
              <th scope="col">Status</th>
              <th scope="col">
                <button type="button" className="sort-button" onClick={() => toggleSort('deliveries')}>
                  Deliveries
                  <ArrowUpDown size={11} aria-hidden="true" className={sortKey === 'deliveries' ? 'is-active' : ''} />
                  {sortKey === 'deliveries' && <span className="visually-hidden">sorted {ascending ? 'ascending' : 'descending'}</span>}
                </button>
              </th>
              <th scope="col">
                <button type="button" className="sort-button" onClick={() => toggleSort('load')}>
                  Load
                  <ArrowUpDown size={11} aria-hidden="true" className={sortKey === 'load' ? 'is-active' : ''} />
                  {sortKey === 'load' && <span className="visually-hidden">sorted {ascending ? 'ascending' : 'descending'}</span>}
                </button>
              </th>
              <th scope="col">
                <button type="button" className="sort-button" onClick={() => toggleSort('distance')}>
                  {SORT_LABEL.distance}
                  <ArrowUpDown size={11} aria-hidden="true" className={sortKey === 'distance' ? 'is-active' : ''} />
                  {sortKey === 'distance' && <span className="visually-hidden">sorted {ascending ? 'ascending' : 'descending'}</span>}
                </button>
              </th>
              <th scope="col">Driving time</th>
              <th scope="col">
                <button type="button" className="sort-button" onClick={() => toggleSort('delays')}>
                  Delays
                  <ArrowUpDown size={11} aria-hidden="true" className={sortKey === 'delays' ? 'is-active' : ''} />
                  {sortKey === 'delays' && <span className="visually-hidden">sorted {ascending ? 'ascending' : 'descending'}</span>}
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr key={row.vehicle.id} className="table-row">
                <th scope="row" className="table-row-header">
                  <span className="font-mono">{row.vehicle.id}</span>
                  <span className="table-subtext">{row.vehicle.name}</span>
                </th>
                <td>
                  <StatusBadge status={row.vehicle.status} size="sm" />
                </td>
                <td className="font-mono">{row.deliveries}</td>
                <td className="font-mono">
                  {row.loadKg.toFixed(1)} kg
                  <span className="table-subtext">{Math.round(row.loadPercent)}% of capacity</span>
                </td>
                <td className="font-mono">
                  {row.distanceKm !== null ? (
                    <>
                      {row.distanceKm.toFixed(1)} km
                      {row.windowViolations && (
                        <span className="table-subtext inline-warning">window missed</span>
                      )}
                    </>
                  ) : (
                    <span className="muted-text" title="No optimization run has covered this vehicle">
                      Not available
                    </span>
                  )}
                </td>
                <td className="font-mono">
                  {row.durationMinutes !== null ? (
                    `${row.durationMinutes.toFixed(0)} min`
                  ) : (
                    <span className="muted-text">Not available</span>
                  )}
                </td>
                <td className="font-mono">
                  {row.delays > 0 ? (
                    <span className="delay-count">{row.delays}</span>
                  ) : (
                    <span className="muted-text">0</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
};
