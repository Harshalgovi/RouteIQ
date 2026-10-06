/**
 * Status vocabulary.
 *
 * Single source of truth for how a backend status is labelled and coloured.
 *
 * Every entry pairs a colour with an explicit label, and `StatusBadge` always
 * renders the label as text. Colour is never the only carrier of meaning, which
 * is what makes the interface usable for colour-blind operators and in a
 * control room at a glance.
 */

import type { DeliveryPriority, DeliveryStatus, VehicleStatus } from '../types';

export type StatusTone = 'success' | 'info' | 'warning' | 'danger' | 'muted';

export interface StatusDescriptor {
  /** Short human label, e.g. "On route". */
  label: string;
  tone: StatusTone;
  /**
   * What this status means for the operator. Shown as a tooltip so the UI can
   * teach the vocabulary instead of assuming the dispatcher already knows it.
   */
  meaning: string;
}

export const VEHICLE_STATUS: Record<VehicleStatus, StatusDescriptor> = {
  available: {
    label: 'Available',
    tone: 'success',
    meaning: 'Ready for dispatch. The route optimizer will use this vehicle.',
  },
  active: {
    label: 'Active',
    tone: 'info',
    meaning: 'On shift and dispatchable. The route optimizer will use this vehicle.',
  },
  in_transit: {
    label: 'In transit',
    tone: 'info',
    meaning: 'Carrying deliveries. Not available to the optimizer until set back to available.',
  },
  delivering: {
    label: 'Delivering',
    tone: 'info',
    meaning: 'Stopped at a delivery point.',
  },
  delayed: {
    label: 'Delayed',
    tone: 'danger',
    meaning: 'Behind schedule. Investigate before assigning more work.',
  },
  offline: {
    label: 'Offline',
    tone: 'muted',
    meaning: 'Not reporting. Excluded from route optimization.',
  },
  maintenance: {
    label: 'Maintenance',
    tone: 'muted',
    meaning: 'Out of service. Excluded from route optimization.',
  },
  unknown: {
    label: 'Unknown status',
    tone: 'muted',
    meaning: 'The backend reported a status this build does not recognise.',
  },
};

export const DELIVERY_STATUS: Record<DeliveryStatus, StatusDescriptor> = {
  pending: {
    label: 'Pending',
    tone: 'warning',
    meaning: 'Waiting to be assigned to a vehicle.',
  },
  assigned: {
    label: 'Assigned',
    tone: 'info',
    meaning: 'Allocated to a vehicle but not yet started.',
  },
  in_transit: {
    label: 'In transit',
    tone: 'info',
    meaning: 'On the vehicle and moving to the address.',
  },
  delivered: {
    label: 'Delivered',
    tone: 'success',
    meaning: 'Completed.',
  },
  delayed: {
    label: 'Delayed',
    tone: 'danger',
    meaning: 'Behind schedule or outside its time window.',
  },
  cancelled: {
    label: 'Cancelled',
    tone: 'muted',
    meaning: 'No longer going ahead.',
  },
  failed: {
    label: 'Failed',
    tone: 'danger',
    meaning: 'Delivery attempt did not succeed.',
  },
  unknown: {
    label: 'Unknown status',
    tone: 'muted',
    meaning: 'The backend reported a status this build does not recognise.',
  },
};

export const DELIVERY_PRIORITY: Record<DeliveryPriority, StatusDescriptor> = {
  low: { label: 'Low', tone: 'muted', meaning: 'No urgency recorded.' },
  normal: { label: 'Normal', tone: 'info', meaning: 'Standard delivery.' },
  high: { label: 'High', tone: 'warning', meaning: 'Should be served before normal work.' },
  urgent: {
    label: 'Urgent',
    tone: 'danger',
    meaning: 'Time-critical. Surpasses normal work.',
  },
};

const TONE_CLASS: Record<StatusTone, string> = {
  success: 'badge-success',
  info: 'badge-info',
  warning: 'badge-warning',
  danger: 'badge-danger',
  muted: 'badge-muted',
};

export const toneClass = (tone: StatusTone): string => TONE_CLASS[tone];

export const describeVehicleStatus = (status: VehicleStatus): StatusDescriptor =>
  VEHICLE_STATUS[status] ?? VEHICLE_STATUS.unknown;

export const describeDeliveryStatus = (status: DeliveryStatus): StatusDescriptor =>
  DELIVERY_STATUS[status] ?? DELIVERY_STATUS.unknown;

export const describePriority = (priority: DeliveryPriority): StatusDescriptor =>
  DELIVERY_PRIORITY[priority] ?? DELIVERY_PRIORITY.normal;

/**
 * Resolve a status from either vocabulary.
 *
 * Resolves by key membership rather than by trying one map and falling through,
 * because both maps contain an `unknown` entry: a naive fallback would report
 * every delivery-only status (pending, delivered, failed…) as "Unknown".
 */
export const describeStatus = (
  status: VehicleStatus | DeliveryStatus
): StatusDescriptor => {
  if (isVehicleStatus(status)) return describeVehicleStatus(status);
  if (isDeliveryStatus(status)) return describeDeliveryStatus(status);
  return {
    label: 'Unknown status',
    tone: 'muted',
    meaning: 'The backend reported a status this build does not recognise.',
  };
};

/** True when the status exists in the vehicle vocabulary. */
export const isVehicleStatus = (
  status: VehicleStatus | DeliveryStatus
): status is VehicleStatus => status in VEHICLE_STATUS;

/** True when the status exists in the delivery vocabulary (not a vehicle-only one). */
export const isDeliveryStatus = (
  status: VehicleStatus | DeliveryStatus
): status is DeliveryStatus => !isVehicleStatus(status) && status in DELIVERY_STATUS;

/** Vehicle types grouped the way a dispatcher thinks about capacity. */
export const VEHICLE_TYPE_LABEL: Record<string, string> = {
  van: 'Van',
  truck: 'Truck',
  bike: 'E-Bike',
  refrigerated: 'Refrigerated',
};

export const vehicleTypeLabel = (type: string): string =>
  VEHICLE_TYPE_LABEL[type] ?? type;
