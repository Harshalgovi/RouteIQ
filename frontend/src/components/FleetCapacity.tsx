import React, { useMemo } from 'react';
import type { Delivery, Vehicle } from '../types';
import { CapacityBar } from './CapacityBar';
import { EmptyState } from './EmptyState';
import { Truck, Info } from 'lucide-react';

interface FleetCapacityProps {
  vehicles: Vehicle[];
  deliveries: Delivery[];
  /** Group by vehicle type instead of listing each vehicle. */
  groupByType?: boolean;
}

const typeLabel = (type: string): string => {
  const labels: Record<string, string> = {
    van: 'Vans',
    truck: 'Trucks',
    bike: 'E-Bikes',
    refrigerated: 'Refrigerated',
  };
  return labels[type] ?? type;
};

interface Group {
  key: string;
  label: string;
  assignedKg: number;
  capacityKg: number;
  assignedM3: number;
  capacityM3: number;
  vehicleCount: number;
  loadedVehicleCount: number;
}

/**
 * Fleet capacity.
 *
 * Replaces a bare "Fleet Capacity Utilization: 78%" with the actual question a
 * dispatcher asks: how full are my vans, and against what limit?
 *
 * Load is the sum of package weights the *database* currently assigns to each
 * vehicle, compared with that vehicle's `capacity_kg`. Both numbers are printed
 * next to every bar, so the percentage is always traceable to real figures.
 * Volume is shown alongside because a van can be full by volume before it is
 * full by weight.
 */
export const FleetCapacity: React.FC<FleetCapacityProps> = ({
  vehicles,
  deliveries,
  groupByType = false,
}) => {
  const groups = useMemo<Group[]>(() => {
    const openDeliveries = deliveries.filter(
      (d) => d.status !== 'delivered' && d.status !== 'cancelled' && d.assignedVehicleId
    );

    const byVehicle = vehicles.map((vehicle) => {
      const assigned = openDeliveries.filter(
        (d) =>
          d.assignedVehicleId === vehicle.id ||
          `V-${vehicle._backendId}` === d.assignedVehicleId
      );
      return {
        vehicle,
        assignedKg: assigned.reduce((sum, d) => sum + d.weightKg, 0),
        assignedM3: assigned.reduce((sum, d) => sum + d.volumeM3, 0),
      };
    });

    if (!groupByType) {
      return byVehicle
        .map(({ vehicle, assignedKg, assignedM3 }) => ({
          key: vehicle.id,
          label: `${vehicle.id} · ${vehicle.name}`,
          assignedKg,
          capacityKg: vehicle.capacityKg,
          assignedM3,
          capacityM3: vehicle.capacityVolumeM3,
          vehicleCount: 1,
          loadedVehicleCount: assignedKg > 0 ? 1 : 0,
        }))
        .sort((a, b) => b.assignedKg / (b.capacityKg || 1) - a.assignedKg / (a.capacityKg || 1));
    }

    const byType = new Map<string, Group>();
    for (const { vehicle, assignedKg, assignedM3 } of byVehicle) {
      const key = vehicle.type;
      const existing = byType.get(key) ?? {
        key,
        label: typeLabel(vehicle.type),
        assignedKg: 0,
        capacityKg: 0,
        assignedM3: 0,
        capacityM3: 0,
        vehicleCount: 0,
        loadedVehicleCount: 0,
      };
      existing.assignedKg += assignedKg;
      existing.capacityKg += vehicle.capacityKg;
      existing.assignedM3 += assignedM3;
      existing.capacityM3 += vehicle.capacityVolumeM3;
      existing.vehicleCount += 1;
      if (assignedKg > 0) existing.loadedVehicleCount += 1;
      byType.set(key, existing);
    }
    return [...byType.values()];
  }, [vehicles, deliveries, groupByType]);

  const withLoad = groups.filter((g) => g.assignedKg > 0);

  if (vehicles.length === 0) {
    return (
      <section className="card capacity-card" aria-labelledby="capacity-heading">
        <h3 className="card-title-text" id="capacity-heading">
          <Truck size={16} aria-hidden="true" /> Fleet Capacity
        </h3>
        <EmptyState
          icon={Truck}
          title="No vehicles to measure"
          description="Add vehicles with a payload capacity to see how loaded the fleet is."
        />
      </section>
    );
  }

  return (
    <section className="card capacity-card" aria-labelledby="capacity-heading">
      <div className="card-header-flex">
        <div>
          <h3 className="card-title-text" id="capacity-heading">
            <Truck size={16} aria-hidden="true" /> Fleet Capacity
          </h3>
          <p className="card-subtitle-text">
            Assigned package weight compared with each vehicle&rsquo;s rated capacity.
          </p>
        </div>
      </div>

      {withLoad.length === 0 ? (
        <EmptyState
          icon={Truck}
          title="No deliveries are assigned to any vehicle"
          description="Every vehicle is empty because the database has no delivery assigned to one. Assign deliveries to see real load figures."
        />
      ) : (
        <div className="capacity-bars">
          {groups.map((group) => {
            const percent =
              group.capacityKg > 0 ? (group.assignedKg / group.capacityKg) * 100 : 0;
            const volumePercent =
              group.capacityM3 > 0 ? (group.assignedM3 / group.capacityM3) * 100 : 0;
            return (
              <CapacityBar
                key={group.key}
                label={group.label}
                percent={percent}
                detail={`${group.assignedKg.toFixed(1)} / ${group.capacityKg} kg`}
                secondary={{
                  label: `volume ${group.assignedM3.toFixed(2)} / ${group.capacityM3} m3`,
                  percent: volumePercent,
                }}
              />
            );
          })}
        </div>
      )}

      <p className="capacity-note">
        <Info size={12} aria-hidden="true" /> Based on deliveries the database currently assigns to
        each vehicle. The Route Planner proposes a plan but never writes assignments back, so this
        reflects what is actually booked, not what was last suggested.
      </p>
    </section>
  );
};
