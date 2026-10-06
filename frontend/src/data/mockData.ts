/**
 * Offline development dataset.
 *
 * This is ONLY used when the backend cannot be reached, and the UI labels it
 * "Development data" everywhere it appears. It deliberately contains no
 * fabricated telemetry: no ETAs, no speeds, no battery levels, no completion
 * percentages, no "efficiency score". Those numbers looked real but came from
 * nowhere, which is worse than showing nothing.
 *
 * Vehicles below carry no coordinates on purpose — it demonstrates the honest
 * "tracked but never reported a position" state rather than inventing a position.
 */

import type { Vehicle, Delivery, ActivityLog } from '../types';

const NO_POSITION: null = null;
const createdAt = '2026-01-01T08:00:00';
const updatedAt = '2026-01-01T08:00:00';

export const INITIAL_VEHICLES: Vehicle[] = [
  {
    id: 'DEV-VAN-01',
    name: 'Express Van 01',
    licensePlate: 'DEV-0001',
    type: 'van',
    capacityKg: 1200,
    capacityVolumeM3: 8.5,
    status: 'available',
    rawStatus: 'available',
    driver: 'Dev Driver One',
    driverPhone: null,
    driverId: null,
    coordinates: NO_POSITION,
    isTracked: false,
    createdAt,
    updatedAt,
  },
  {
    id: 'DEV-TRUCK-01',
    name: 'Heavy Truck 01',
    licensePlate: 'DEV-0002',
    type: 'truck',
    capacityKg: 3500,
    capacityVolumeM3: 22,
    status: 'offline',
    rawStatus: 'offline',
    driver: null,
    driverPhone: null,
    driverId: null,
    coordinates: NO_POSITION,
    isTracked: false,
    createdAt,
    updatedAt,
  },
  {
    id: 'DEV-BIKE-01',
    name: 'E-Bike 01',
    licensePlate: 'DEV-0003',
    type: 'bike',
    capacityKg: 150,
    capacityVolumeM3: 1.2,
    status: 'maintenance',
    rawStatus: 'maintenance',
    driver: null,
    driverPhone: null,
    driverId: null,
    coordinates: NO_POSITION,
    isTracked: false,
    createdAt,
    updatedAt,
  },
];

export const INITIAL_DELIVERIES: Delivery[] = [
  {
    id: 'DEV-DEL-1',
    trackingNumber: 'DEV-0001',
    recipientName: 'Development Delivery 1',
    phone: '',
    address: 'No address — backend unavailable',
    coordinates: NO_POSITION,
    weightKg: 45,
    volumeM3: 0.45,
    timeWindowStart: null,
    timeWindowEnd: null,
    priority: 'normal',
    status: 'pending',
    rawStatus: 'pending',
    assignedVehicleId: null,
    notes: 'Sample row shown only while the backend is unreachable.',
    createdAt,
    updatedAt,
  },
  {
    id: 'DEV-DEL-2',
    trackingNumber: 'DEV-0002',
    recipientName: 'Development Delivery 2',
    phone: '',
    address: 'No address — backend unavailable',
    coordinates: NO_POSITION,
    weightKg: 12,
    volumeM3: 0.15,
    timeWindowStart: null,
    timeWindowEnd: null,
    priority: 'normal',
    status: 'pending',
    rawStatus: 'pending',
    assignedVehicleId: null,
    notes: 'Sample row shown only while the backend is unreachable.',
    createdAt,
    updatedAt,
  },
];

/**
 * No seeded activity. Entries are added by real user actions during the session
 * (start tracking, stop tracking, create delivery) so the log cannot describe
 * events that never happened.
 */
export const INITIAL_ACTIVITIES: ActivityLog[] = [];
