/**
 * Vehicle ↔ delivery matching.
 *
 * The API mapper sets a delivery's `assignedVehicleId` to `V-{backendId}`,
 * because the backend's `assigned_vehicle_id` is a surrogate key. A `Vehicle`,
 * however, is addressed in the UI by its human `vehicle_number` (`id`), so the
 * two forms differ whenever the vehicle number is not literally `V-<id>`.
 *
 * Every component that needs "the deliveries on this vehicle" goes through this
 * helper, so the mismatch is handled once instead of being re-guessed per
 * component (which previously caused some views to silently show nothing).
 */

import type { Delivery, Vehicle } from '../types';

/** Keys under which a delivery may reference its vehicle. */
export const deliveryAssignmentKeys = (delivery: Delivery): string[] =>
  delivery.assignedVehicleId ? [delivery.assignedVehicleId] : [];

/** True when the delivery is assigned to this specific vehicle. */
export const isAssignedToVehicle = (delivery: Delivery, vehicle: Vehicle): boolean => {
  if (!delivery.assignedVehicleId) return false;
  if (delivery.assignedVehicleId === vehicle.id) return true;
  return (
    vehicle._backendId !== undefined &&
    delivery.assignedVehicleId === `V-${vehicle._backendId}`
  );
};

/** Open work only: delivered and cancelled deliveries are not outstanding. */
export const isOpenDelivery = (delivery: Delivery): boolean =>
  delivery.status !== 'delivered' && delivery.status !== 'cancelled';

/** All open deliveries assigned to this vehicle. */
export const openDeliveriesForVehicle = (
  deliveries: Delivery[],
  vehicle: Vehicle
): Delivery[] => deliveries.filter((d) => isOpenDelivery(d) && isAssignedToVehicle(d, vehicle));

/** Index open deliveries by every key a vehicle might be looked up under. */
export const indexOpenDeliveriesByVehicle = (
  deliveries: Delivery[]
): Map<string, Delivery[]> => {
  const index = new Map<string, Delivery[]>();
  for (const delivery of deliveries) {
    if (!isOpenDelivery(delivery)) continue;
    for (const key of deliveryAssignmentKeys(delivery)) {
      const list = index.get(key);
      if (list) list.push(delivery);
      else index.set(key, [delivery]);
    }
  }
  return index;
};

/** Open delivery count for a vehicle, resolving both identifier forms. */
export const openDeliveryCountForVehicle = (
  index: Map<string, Delivery[]>,
  vehicle: Vehicle
): number =>
  (index.get(vehicle.id)?.length ?? 0) +
  (vehicle._backendId !== undefined ? (index.get(`V-${vehicle._backendId}`)?.length ?? 0) : 0);

/** Find a vehicle from a map key, accepting either identifier form. */
export const findVehicleByAnyId = (
  vehicles: Vehicle[],
  id: string | null | undefined
): Vehicle | undefined => {
  if (!id) return undefined;
  return (
    vehicles.find((v) => v.id === id) ??
    vehicles.find((v) => `V-${v._backendId}` === id)
  );
};