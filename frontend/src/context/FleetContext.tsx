/**
 * FleetContext — Global fleet state management.
 *
 * Data source: FastAPI backend (/api/v1/vehicles, /api/v1/deliveries).
 *
 * The backend is the single source of truth for the vehicle list, the delivery
 * list and tracking state. Every number the UI shows is derived from those
 * records in `useOperationsSummary`; nothing is stored or hardcoded here.
 *
 * If the backend is unreachable the app falls back to `INITIAL_VEHICLES` /
 * `INITIAL_DELIVERIES` so the shell stays navigable, and `dataSource` becomes
 * 'mock' so the UI can label that data as development data instead of passing it
 * off as live. All mutations (track/untrack, add delivery) call the real API.
 */

import React, {
  createContext,
  useContext,
  useRef,
  useState,
  useMemo,
  useCallback,
  useEffect,
} from 'react';
import type {
  Vehicle,
  Delivery,
  ActivityLog,
  NotificationItem,
  DeliveryStatus,
  DeliveryPriority,
  VehicleStatus,
  OperationsSummary,
  LatLng,
} from '../types';
import {
  INITIAL_VEHICLES,
  INITIAL_DELIVERIES,
  INITIAL_ACTIVITIES,
} from '../data/mockData';
import { findVehicleByAnyId } from '../utils/assignment';
import { formatApiClock, isSameApiLocalDay } from '../utils/datetime';
import {
  fetchVehicles,
  fetchDeliveries,
  fetchDrivers,
  startTracking,
  stopTracking,
  createDelivery,
  updateDelivery,
  deleteDelivery,
  createVehicle,
  updateVehicle,
  deleteVehicle,
  createDriver,
  updateDriver,
  deleteDriver,
  mapApiVehicle,
  mapApiDelivery,
  normalizeDriverStatus,
  ApiRequestError,
} from '../services/api';
import type { ApiDriver } from '../services/api';

// ─── Context Type ─────────────────────────────────────────────────────────────

export type DataSource = 'backend' | 'mock';
export type LoadState = 'idle' | 'loading' | 'success' | 'error';

interface FleetContextType {
  vehicles: Vehicle[];
  deliveries: Delivery[];
  drivers: ApiDriver[];
  activities: ActivityLog[];
  notifications: NotificationItem[];
  /** Real counts recomputed from vehicles + deliveries. Never a stored value. */
  summary: OperationsSummary;
  trackedVehicles: Vehicle[];
  untrackedVehicles: Vehicle[];
  selectedVehicle: Vehicle | null;
  selectedDelivery: Delivery | null;
  selectedVehicleId: string | null;
  selectedDeliveryId: string | null;
  isTrackingModalOpen: boolean;
  searchQuery: string;
  dataSource: DataSource;
  loadState: LoadState;
  loadError: string | null;

  // Actions
  toggleVehicleTracking: (vehicleId: string) => Promise<void>;
  startTrackingVehicle: (vehicleId: string) => Promise<void>;
  stopTrackingVehicle: (vehicleId: string) => Promise<void>;
  setSelectedVehicleId: (id: string | null) => void;
  setSelectedDeliveryId: (id: string | null) => void;
  setIsTrackingModalOpen: (open: boolean) => void;
  setSearchQuery: (query: string) => void;

  /** Payload accepted by the delivery create/update forms. */
  addDelivery: (draft: DeliveryDraft) => Promise<void>;
  updateDelivery: (id: string, draft: DeliveryDraft) => Promise<void>;
  deleteDelivery: (id: string) => Promise<void>;
  updateDeliveryStatus: (id: string, status: DeliveryStatus) => Promise<void>;

  addVehicle: (draft: VehicleDraft) => Promise<void>;
  updateVehicle: (id: string, draft: VehicleDraft) => Promise<void>;
  deleteVehicle: (id: string) => Promise<void>;

  addDriver: (draft: DriverDraft) => Promise<void>;
  updateDriver: (id: number, draft: DriverDraft) => Promise<void>;
  deleteDriver: (id: number) => Promise<void>;

  markNotificationRead: (id: string) => void;
  clearAllTracking: () => Promise<void>;
  refreshData: () => Promise<void>;
  /** Message from the most recent failed action, cleared by the next one. */
  actionError: string | null;
  clearActionError: () => void;
}

/**
 * Fields the delivery form collects.
 *
 * Time windows arrive as the API's naive-UTC ISO strings (already converted from
 * the operator's local date/from/to inputs by `fieldsToWindow`) and are sent
 * straight through, so no client-side timezone guesswork happens here.
 */
export interface DeliveryDraft {
  recipientName: string;
  phone: string;
  address: string;
  coordinates: LatLng | null;
  weightKg: number;
  volumeM3: number;
  timeWindowStart?: string;
  timeWindowEnd?: string;
  priority: DeliveryPriority;
  status?: DeliveryStatus;
  notes: string;
  assignedVehicleId: string | null;
}

export interface VehicleDraft {
  vehicleNumber: string;
  name: string;
  licensePlate: string;
  vehicleType: Vehicle['type'];
  capacityKg: number;
  capacityVolumeM3: number;
  status: VehicleStatus;
  driverId: number | null;
  coordinates: LatLng | null;
}

export interface DriverDraft {
  name: string;
  phone: string;
  status: string;
}

const FleetContext = createContext<FleetContextType | undefined>(undefined);

// ─── Provider ─────────────────────────────────────────────────────────────────

/** Sequential, human-readable shipment number — never a random collision-prone id. */
const buildTrackingNumber = (existingCount: number): string => {
  const serial = String(existingCount + 1).padStart(4, '0');
  return `RT-${serial}`;
};

const isSameLocalDay = (iso: string, reference: Date): boolean =>
  isSameApiLocalDay(iso, reference);

/**
 * Derive every operational number from the records the backend returned.
 *
 * Deliberately computed rather than fetched or stored: there is no analytics
 * endpoint, so any number shown must be reproducible from the vehicle and
 * delivery lists, or it does not belong on screen.
 */
const summarize = (vehicles: Vehicle[], deliveries: Delivery[]): OperationsSummary => {
  const now = new Date();

  // A delivery points at its vehicle by surrogate key (`V-3`) while the fleet is
  // addressed by vehicle number (`VAN-02`), so resolve aliases before bucketing.
  const vehicleIdForAlias = new Map<string, string>();
  for (const vehicle of vehicles) {
    vehicleIdForAlias.set(vehicle.id, vehicle.id);
    if (vehicle._backendId !== undefined) {
      vehicleIdForAlias.set(`V-${vehicle._backendId}`, vehicle.id);
    }
  }

  const loadByVehicle: OperationsSummary['loadByVehicle'] = {};
  for (const vehicle of vehicles) {
    loadByVehicle[vehicle.id] = {
      vehicleId: vehicle.id,
      assignedDeliveries: 0,
      assignedKg: 0,
      assignedVolumeM3: 0,
      capacityKg: vehicle.capacityKg,
      capacityVolumeM3: vehicle.capacityVolumeM3,
      weightPercent: vehicle.capacityKg > 0 ? 0 : 0,
      volumePercent: vehicle.capacityVolumeM3 > 0 ? 0 : 0,
    };
  }

  const findVehicleBucket = (delivery: Delivery): OperationsSummary['loadByVehicle'][string] | null => {
    if (!delivery.assignedVehicleId) return null;
    const vehicleId = vehicleIdForAlias.get(delivery.assignedVehicleId);
    return vehicleId ? loadByVehicle[vehicleId] ?? null : null;
  };

  for (const delivery of deliveries) {
    // Only work that is actually still on board counts as load. A delivered or
    // cancelled parcel is no longer occupying capacity.
    const bucket = findVehicleBucket(delivery);
    if (!bucket) continue;

    bucket.assignedDeliveries += 1;
    bucket.assignedKg += delivery.weightKg;
    bucket.assignedVolumeM3 += delivery.volumeM3;
  }

  for (const bucket of Object.values(loadByVehicle)) {
    bucket.weightPercent =
      bucket.capacityKg > 0 ? (bucket.assignedKg / bucket.capacityKg) * 100 : 0;
    bucket.volumePercent =
      bucket.capacityVolumeM3 > 0 ? (bucket.assignedVolumeM3 / bucket.capacityVolumeM3) * 100 : 0;
  }

  const dispatchable = vehicles.filter((v) => v.status === 'available' || v.status === 'active');

  return {
    vehiclesTracked: vehicles.filter((v) => v.isTracked).length,
    vehiclesTotal: vehicles.length,
    vehiclesDispatchable: dispatchable.length,
    vehiclesWithoutDriver: vehicles.filter((v) => v.driver === null).length,
    vehiclesWithoutPosition: vehicles.filter((v) => v.coordinates === null).length,

    deliveriesToday: deliveries.filter((d) => isSameLocalDay(d.createdAt, now)).length,
    deliveriesTotal: deliveries.length,
    deliveriesPending: deliveries.filter((d) => d.status === 'pending').length,
    deliveriesAssigned: deliveries.filter((d) => d.status === 'assigned').length,
    deliveriesInTransit: deliveries.filter((d) => d.status === 'in_transit').length,
    deliveriesDelivered: deliveries.filter((d) => d.status === 'delivered').length,
    deliveriesDelayed: deliveries.filter((d) => d.status === 'delayed').length,
    deliveriesUnassigned: deliveries.filter(
      (d) =>
        (d.status === 'pending' || d.status === 'assigned' || d.status === 'delayed') &&
        d.assignedVehicleId === null
    ).length,

    loadByVehicle,
    totalAssignedKg: Object.values(loadByVehicle).reduce((sum, b) => sum + b.assignedKg, 0),
    totalDispatchableCapacityKg: dispatchable.reduce((sum, v) => sum + v.capacityKg, 0),
  };
};

export const FleetProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [vehicles, setVehicles] = useState<Vehicle[]>(INITIAL_VEHICLES);
  const [deliveries, setDeliveries] = useState<Delivery[]>(INITIAL_DELIVERIES);
  const [drivers, setDrivers] = useState<ApiDriver[]>([]);
  const [activities, setActivities] = useState<ActivityLog[]>(INITIAL_ACTIVITIES);

  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [selectedDeliveryId, setSelectedDeliveryId] = useState<string | null>(null);
  const [isTrackingModalOpen, setIsTrackingModalOpen] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [dataSource, setDataSource] = useState<DataSource>('mock');
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [readNotifications, setReadNotifications] = useState<string[]>([]);

  // ── Derived state ────────────────────────────────────────────────────────────

  const trackedVehicles = useMemo(() => vehicles.filter((v) => v.isTracked), [vehicles]);
  const untrackedVehicles = useMemo(() => vehicles.filter((v) => !v.isTracked), [vehicles]);
  const selectedVehicle = useMemo(
    () => vehicles.find((v) => v.id === selectedVehicleId) ?? null,
    [vehicles, selectedVehicleId]
  );
  const selectedDelivery = useMemo(
    () => deliveries.find((d) => d.id === selectedDeliveryId) ?? null,
    [deliveries, selectedDeliveryId]
  );

  const summary = useMemo(() => summarize(vehicles, deliveries), [vehicles, deliveries]);

  /**
   * Notifications are derived from real record state rather than seeded.
   *
   * Previously this was a hardcoded list describing events that never happened
   * ("V-104 is 18 minutes behind schedule"). Now every item corresponds to a
   * delivery or vehicle the backend actually reports as needing attention.
   */
  const notifications = useMemo<NotificationItem[]>(() => {
    const items: NotificationItem[] = [];

    for (const delivery of deliveries) {
      if (delivery.status !== 'delayed') continue;
      const vehicle = findVehicleByAnyId(vehicles, delivery.assignedVehicleId);
      items.push({
        id: `notif-delay-${delivery.id}`,
        title: `${delivery.trackingNumber} is marked delayed`,
        message: `${delivery.recipientName} — ${
          vehicle ? `assigned to ${vehicle.id}` : 'no vehicle assigned'
        }${delivery.timeWindowEnd ? `, window closed at ${formatClock(delivery.timeWindowEnd)}` : ''}.`,
        timestamp: delivery.updatedAt,
        read: readNotifications.includes(`notif-delay-${delivery.id}`),
        type: 'alert',
      });
    }

    for (const vehicle of vehicles) {
      if (vehicle.isTracked && vehicle.coordinates === null) {
        items.push({
          id: `notif-pos-${vehicle.id}`,
          title: `${vehicle.id} is tracked but has no position`,
          message:
            'Tracking is enabled but the backend has no coordinates for this vehicle, so it cannot be shown on the map.',
          timestamp: vehicle.updatedAt,
          read: readNotifications.includes(`notif-pos-${vehicle.id}`),
          type: 'warning',
        });
      }
    }

    return items;
  }, [deliveries, vehicles, readNotifications]);

  function formatClock(iso: string): string {
    return formatApiClock(iso);
  }

  // ── Activity log helper ───────────────────────────────────────────────────────

  const addActivity = useCallback(
    (
      title: string,
      description: string,
      type: ActivityLog['type'],
      vehicleId?: string
    ) => {
      const newLog: ActivityLog = {
        id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        timestamp: new Date().toISOString(),
        type,
        title,
        description,
        vehicleId,
      };
      setActivities((prev) => [newLog, ...prev].slice(0, 25));
    },
    []
  );

  // ── Backend data fetch ────────────────────────────────────────────────────────

  /**
   * Vehicle list mirrored into a ref.
   *
   * The CRUD callbacks resolve a delivery's `V-3` style vehicle alias against the
   * live fleet, but they must not re-create themselves every time a vehicle
   * changes. Reading the ref keeps those callbacks stable without serving stale
   * vehicles.
   */
  const vehiclesRef = useRef<Vehicle[]>(vehicles);
  vehiclesRef.current = vehicles;

  /** Backend primary key for a UI vehicle alias (`V-3` or a vehicle number). */
  const backendIdForAlias = useCallback((alias: string | null): number | null => {
    if (!alias) return null;
    const match = /^V-(\d+)$/.exec(alias);
    if (match) return Number(match[1]);
    const byNumber = vehiclesRef.current.find((v) => v.id === alias);
    return byNumber?._backendId ?? null;
  }, []);

  /** Re-read just the vehicle list, e.g. after a driver assignment changes. */
  const refreshVehicles = useCallback(async () => {
    const apiVehicles = await fetchVehicles();
    setVehicles(apiVehicles.map(mapApiVehicle));
    setSelectedVehicleId((prev) => {
      if (!prev) return prev;
      return apiVehicles.some((v) => v.vehicle_number === prev) ? prev : null;
    });
  }, []);

  const refreshData = useCallback(async () => {
    setLoadState('loading');
    setLoadError(null);

    try {
      const [apiVehicles, apiDeliveries, apiDrivers] = await Promise.all([
        fetchVehicles(),
        fetchDeliveries(),
        fetchDrivers(),
      ]);

      const mapped = apiVehicles.map(mapApiVehicle);
      const mappedDeliveries = apiDeliveries.map(mapApiDelivery);

      setVehicles(mapped);
      setDeliveries(mappedDeliveries);
      setDrivers(apiDrivers);
      setDataSource('backend');
      setLoadState('success');

      // Keep the selection valid across refreshes: drop it if the vehicle is gone,
      // otherwise fall back to the first tracked vehicle so the map has a focus.
      setSelectedVehicleId((prev) => {
        if (prev && mapped.some((v) => v.id === prev)) return prev;
        const firstTracked = mapped.find((v) => v.isTracked);
        return firstTracked?.id ?? null;
      });
    } catch (err) {
      const msg =
        err instanceof ApiRequestError
          ? `API error ${err.status}: ${err.message}`
          : err instanceof Error
          ? err.message
          : 'Unknown error loading fleet data';

      console.warn('[RouteIQ] Backend unavailable, showing development data.', msg);
      setLoadError(msg);
      setDataSource('mock');
      setLoadState('error');
    }
  }, []);

  // Load on mount
  useEffect(() => {
    refreshData();
  }, [refreshData]);

  // ── Tracking actions ─────────────────────────────────────────────────────────

  const startTrackingVehicle = useCallback(
    async (vehicleId: string) => {
      const target = vehicles.find((v) => v.id === vehicleId);
      if (!target) return;

      if (dataSource !== 'backend' || target._backendId === undefined) {
        setActionError(
          'Tracking can only be changed while the backend is connected. Start the API and retry.'
        );
        return;
      }

      try {
        // Always let the server be the authority on tracking state.
        const updated = await startTracking(target._backendId);
        setVehicles((prev) =>
          prev.map((v) =>
            v.id === vehicleId
              ? {
                  ...v,
                  isTracked: updated.tracking_enabled,
                    coordinates:
                      typeof updated.current_latitude === 'number' &&
                      typeof updated.current_longitude === 'number'
                        ? [updated.current_latitude, updated.current_longitude]
                        : v.coordinates,
                  }
              : v
          )
        );
        setActionError(null);
        addActivity(
          `Tracking started: ${target.name}`,
          `Tracking enabled for ${target.id}.`,
          'tracking_started',
          target.id
        );
        setSelectedVehicleId(vehicleId);
      } catch (err) {
        setActionError(
          err instanceof ApiRequestError
            ? `Could not start tracking ${target.id}: ${err.message}`
            : `Could not start tracking ${target.id}.`
        );
      }
    },
    [vehicles, dataSource, addActivity]
  );

  const stopTrackingVehicle = useCallback(
    async (vehicleId: string) => {
      const target = vehicles.find((v) => v.id === vehicleId);
      if (!target) return;

      if (dataSource !== 'backend' || target._backendId === undefined) {
        setActionError(
          'Tracking can only be changed while the backend is connected. Start the API and retry.'
        );
        return;
      }

      try {
        await stopTracking(target._backendId);
        setVehicles((prev) =>
          prev.map((v) => (v.id === vehicleId ? { ...v, isTracked: false } : v))
        );
        setActionError(null);
        addActivity(
          `Tracking stopped: ${target.name}`,
          `Tracking disabled for ${target.id}.`,
          'tracking_stopped',
          target.id
        );

        if (selectedVehicleId === vehicleId) {
          const remaining = trackedVehicles.filter((v) => v.id !== vehicleId);
          setSelectedVehicleId(remaining.length > 0 ? remaining[0].id : null);
        }
      } catch (err) {
        setActionError(
          err instanceof ApiRequestError
            ? `Could not stop tracking ${target.id}: ${err.message}`
            : `Could not stop tracking ${target.id}.`
        );
      }
    },
    [vehicles, dataSource, selectedVehicleId, trackedVehicles, addActivity]
  );

  const toggleVehicleTracking = useCallback(
    async (vehicleId: string) => {
      const target = vehicles.find((v) => v.id === vehicleId);
      if (!target) return;
      if (target.isTracked) {
        await stopTrackingVehicle(vehicleId);
      } else {
        await startTrackingVehicle(vehicleId);
      }
    },
    [vehicles, startTrackingVehicle, stopTrackingVehicle]
  );

  const clearAllTracking = useCallback(async () => {
    const tracked = trackedVehicles.filter((v) => v._backendId !== undefined);
    if (tracked.length === 0) return;

    const failures: string[] = [];
    for (const vehicle of tracked) {
      try {
        await stopTracking(vehicle._backendId as number);
      } catch {
        failures.push(vehicle.id);
      }
    }

    if (failures.length > 0) {
      setActionError(
        `Tracking could not be stopped for: ${failures.join(', ')}. Those vehicles are still marked as tracked.`
      );
    } else {
      setActionError(null);
    }

    // Only clear the vehicles the server actually accepted. Marking a failed
    // request as stopped would leave the UI disagreeing with the backend.
    const failed = new Set(failures);
    const stopped = new Set(
      tracked.filter((v) => !failed.has(v.id)).map((v) => v.id)
    );
    setVehicles((prev) =>
      prev.map((v) => (stopped.has(v.id) ? { ...v, isTracked: false } : v))
    );
    if (failures.length === 0) {
      setSelectedVehicleId(null);
      addActivity(
        'All tracking stopped',
        `Tracking disabled for ${stopped.size} vehicle(s).`,
        'tracking_stopped'
      );
    } else {
      const stillTracked = tracked.filter((v) => failed.has(v.id));
      setSelectedVehicleId((prev) =>
        prev && stillTracked.some((v) => v.id === prev) ? prev : stillTracked[0]?.id ?? null
      );
    }
  }, [trackedVehicles, addActivity]);

  // ── Delivery actions ──────────────────────────────────────────────────────────

  /** Message for a failed mutation, preserving the backend's own wording. */
  const describeFailure = (err: unknown, fallback: string): string =>
    err instanceof ApiRequestError
      ? `${fallback} (HTTP ${err.status}): ${err.message}`
      : err instanceof Error
      ? err.message
      : fallback;

  const requireBackend = (action: string): boolean => {
    if (dataSource === 'backend') return true;
    setActionError(
      `${action} needs the backend: start the FastAPI server and reload this page. No changes were made.`
    );
    return false;
  };

  /** Shape a delivery draft into the API payload. Shared by create and update. */
  const deliveryPayload = (draft: DeliveryDraft) => ({
    customer_name: draft.recipientName,
    phone: draft.phone || null,
    address: draft.address,
    latitude: draft.coordinates?.[0] ?? null,
    longitude: draft.coordinates?.[1] ?? null,
    package_weight: draft.weightKg,
    volume_m3: draft.volumeM3,
    // Explicitly null when the operator cleared the window, so an edit can
    // actually remove a window instead of leaving the old one behind.
    time_window_start: draft.timeWindowStart ?? null,
    time_window_end: draft.timeWindowEnd ?? null,
    priority: draft.priority,
    status: draft.status ?? 'pending',
    notes: draft.notes || null,
    assigned_vehicle_id: backendIdForAlias(draft.assignedVehicleId),
  });

  const addDelivery = useCallback(
    async (draft: DeliveryDraft) => {
      if (!requireBackend('Creating a delivery')) return;

      const apiResult = await createDelivery({
        tracking_number: buildTrackingNumber(deliveries.length),
        ...deliveryPayload(draft),
      });

      const fullDelivery = mapApiDelivery(apiResult);
      setDeliveries((prev) => [fullDelivery, ...prev]);
      setActionError(null);
      addActivity(
        `Delivery created: ${fullDelivery.trackingNumber}`,
        `${fullDelivery.recipientName} — ${fullDelivery.address}.`,
        'delivery_added'
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deliveries, dataSource, addActivity]
  );

  const saveDelivery = useCallback(
    async (id: string, draft: DeliveryDraft) => {
      if (!requireBackend('Saving a delivery')) return;

      const target = deliveries.find((d) => d.id === id);
      if (!target || target._backendId === undefined) {
        setActionError('This delivery has no backend record, so it cannot be saved.');
        return;
      }

      const updated = await updateDelivery(target._backendId, deliveryPayload(draft));
      const mapped = mapApiDelivery(updated);
      setDeliveries((prev) => prev.map((d) => (d.id === id ? mapped : d)));
      setActionError(null);
      addActivity(
        `Delivery updated: ${mapped.trackingNumber}`,
        `${mapped.recipientName} — ${mapped.address}.`,
        'delivery_added'
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deliveries, dataSource, addActivity]
  );

  const removeDelivery = useCallback(
    async (id: string) => {
      if (!requireBackend('Deleting a delivery')) return;

      const target = deliveries.find((d) => d.id === id);
      if (!target || target._backendId === undefined) {
        setActionError('This delivery has no backend record, so it cannot be deleted.');
        return;
      }

      await deleteDelivery(target._backendId);
      // Only drop it locally once the server confirmed the delete.
      setDeliveries((prev) => prev.filter((d) => d.id !== id));
      setActionError(null);
      addActivity(
        `Delivery deleted: ${target.trackingNumber}`,
        `${target.recipientName} — removed from the manifest.`,
        'delivery_added'
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deliveries, dataSource, addActivity]
  );

  const updateDeliveryStatus = useCallback(
    async (id: string, status: DeliveryStatus) => {
      const target = deliveries.find((d) => d.id === id);
      if (!target || target._backendId === undefined) {
        setActionError('Delivery status can only be changed while the backend is connected.');
        return;
      }

      const previous = target.status;
      // Optimistic: the dispatcher sees the change immediately, and we roll back
      // if the server disagrees.
      setDeliveries((prev) =>
        prev.map((d) => (d.id === id ? { ...d, status, rawStatus: status } : d))
      );

      try {
        const updated = await updateDelivery(target._backendId, {
          status,
        });
        const mapped = mapApiDelivery(updated);
        setDeliveries((prev) => prev.map((d) => (d.id === id ? mapped : d)));
        setActionError(null);
        addActivity(
          `${mapped.trackingNumber} marked ${status.replace('_', ' ')}`,
          `${mapped.recipientName} — ${mapped.address}.`,
          status === 'delivered' ? 'delivery_completed' : 'delivery_added'
        );
      } catch (err) {
        setDeliveries((prev) =>
          prev.map((d) => (d.id === id ? { ...d, status: previous, rawStatus: previous } : d))
        );
        setActionError(describeFailure(err, `Could not update ${target.trackingNumber}`));
      }
    },
    [deliveries, addActivity]
  );

  // ── Vehicle actions ───────────────────────────────────────────────────────────

  const vehiclePayload = (draft: VehicleDraft) => ({
    vehicle_number: draft.vehicleNumber,
    name: draft.name,
    license_plate: draft.licensePlate,
    vehicle_type: draft.vehicleType,
    capacity_kg: draft.capacityKg,
    capacity_volume_m3: draft.capacityVolumeM3,
    status: draft.status,
    driver_id: draft.driverId,
    current_latitude: draft.coordinates?.[0] ?? null,
    current_longitude: draft.coordinates?.[1] ?? null,
  });

  const addVehicle = useCallback(
    async (draft: VehicleDraft) => {
      if (!requireBackend('Adding a vehicle')) return;

      const created = await createVehicle(vehiclePayload(draft));
      const mapped = mapApiVehicle(created);
      setVehicles((prev) => [...prev, mapped]);
      setActionError(null);
      addActivity(
        `Vehicle added: ${mapped.id}`,
        `${mapped.name} — ${mapped.capacityKg} kg capacity${mapped.driver ? `, ${mapped.driver}` : ' (no driver assigned)'}.`,
        'vehicle_added'
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dataSource, addActivity]
  );

  const saveVehicle = useCallback(
    async (id: string, draft: VehicleDraft) => {
      if (!requireBackend('Saving a vehicle')) return;

      const target = vehicles.find((v) => v.id === id);
      if (!target || target._backendId === undefined) {
        setActionError('This vehicle has no backend record, so it cannot be saved.');
        return;
      }

      const updated = await updateVehicle(target._backendId, vehiclePayload(draft));
      const mapped = mapApiVehicle(updated);
      setVehicles((prev) => prev.map((v) => (v.id === id ? mapped : v)));
      setActionError(null);
      addActivity(
        `Vehicle updated: ${mapped.id}`,
        `${mapped.name} — capacity ${mapped.capacityKg} kg, status ${mapped.rawStatus}.`,
        'vehicle_added'
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [vehicles, dataSource, addActivity]
  );

  const removeVehicle = useCallback(
    async (id: string) => {
      if (!requireBackend('Deleting a vehicle')) return;

      const target = vehicles.find((v) => v.id === id);
      if (!target || target._backendId === undefined) {
        setActionError('This vehicle has no backend record, so it cannot be deleted.');
        return;
      }

      const released = deliveries.filter((d) => d.assignedVehicleId === id);

      await deleteVehicle(target._backendId);
      setVehicles((prev) => prev.filter((v) => v.id !== id));
      // The backend nulls the delivery's vehicle reference, so mirror that here
      // instead of leaving a stale assignment badge pointing at a deleted truck.
      setDeliveries((prev) =>
        prev.map((d) => (d.assignedVehicleId === id ? { ...d, assignedVehicleId: null } : d))
      );
      setSelectedVehicleId((prev) => (prev === id ? null : prev));
      setActionError(null);
      addActivity(
        `Vehicle deleted: ${target.id}`,
        released.length > 0
          ? `${released.length} delivery record(s) were left unassigned.`
          : `${target.name} removed from the fleet.`,
        'vehicle_added'
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [vehicles, deliveries, dataSource, addActivity]
  );

  // ── Driver actions ────────────────────────────────────────────────────────────

  const driverPayload = (draft: DriverDraft) => ({
    name: draft.name,
    phone: draft.phone || null,
    status: normalizeDriverStatus(draft.status),
  });

  const addDriver = useCallback(
    async (draft: DriverDraft) => {
      if (!requireBackend('Adding a driver')) return;

      const created = await createDriver(driverPayload(draft));
      setDrivers((prev) => [...prev, created]);
      setActionError(null);
      addActivity(
        `Driver added: ${created.name}`,
        `${created.phone || 'No phone on file'} — ${created.status.replace('_', ' ')}.`,
        'vehicle_added'
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dataSource, addActivity]
  );

  const saveDriver = useCallback(
    async (id: number, draft: DriverDraft) => {
      if (!requireBackend('Saving a driver')) return;

      const updated = await updateDriver(id, driverPayload(draft));
      setDrivers((prev) => prev.map((d) => (d.id === id ? updated : d)));
      // The vehicle list embeds the driver's name/status, so it must be
      // re-read from the server or the table would show stale details.
      await refreshVehicles();
      setActionError(null);
      addActivity(
        `Driver updated: ${updated.name}`,
        `Status set to ${updated.status.replace('_', ' ')}.`,
        'vehicle_added'
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dataSource, addActivity, refreshVehicles]
  );

  const removeDriver = useCallback(
    async (id: number) => {
      if (!requireBackend('Deleting a driver')) return;

      const target = drivers.find((d) => d.id === id);
      const driving = vehicles.filter((v) => v.driverId === id);

      await deleteDriver(id);
      setDrivers((prev) => prev.filter((d) => d.id !== id));
      await refreshVehicles();
      setActionError(null);
      addActivity(
        `Driver deleted: ${target?.name ?? id}`,
        driving.length > 0
          ? `${driving.length} vehicle(s) were released and are now unassigned.`
          : 'Driver removed from the roster.',
        'vehicle_added'
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [drivers, vehicles, dataSource, addActivity, refreshVehicles]
  );

  const markNotificationRead = useCallback((id: string) => {
    setReadNotifications((prev) => (prev.includes(id) ? prev : [...prev, id]));
  }, []);

  // ── Context value ─────────────────────────────────────────────────────────────

  const value: FleetContextType = {
    vehicles,
    deliveries,
    drivers,
    activities,
    summary,
    notifications,
    trackedVehicles,
    untrackedVehicles,
    selectedVehicle,
    selectedDelivery,
    selectedVehicleId,
    selectedDeliveryId,
    isTrackingModalOpen,
    searchQuery,
    dataSource,
    loadState,
    loadError,
    actionError,
    clearActionError: () => setActionError(null),

    toggleVehicleTracking,
    startTrackingVehicle,
    stopTrackingVehicle,
    setSelectedVehicleId,
    setSelectedDeliveryId,
    setIsTrackingModalOpen,
    setSearchQuery,
    addDelivery,
    updateDelivery: saveDelivery,
    deleteDelivery: removeDelivery,
    updateDeliveryStatus,
    addVehicle,
    updateVehicle: saveVehicle,
    deleteVehicle: removeVehicle,
    addDriver,
    updateDriver: saveDriver,
    deleteDriver: removeDriver,
    markNotificationRead,
    clearAllTracking,
    refreshData,
  };

  return <FleetContext.Provider value={value}>{children}</FleetContext.Provider>;
};

export const useFleet = () => {
  const context = useContext(FleetContext);
  if (!context) {
    throw new Error('useFleet must be used within a FleetProvider');
  }
  return context;
};
