import React, { useEffect, useState } from 'react';
import { Loader2, Truck, X } from 'lucide-react';
import { ErrorState } from './ErrorState';
import type { ApiDriver } from '../services/api';
import type { Vehicle, VehicleStatus } from '../types';
import type { VehicleDraft } from '../context/FleetContext';

/** Statuses the optimizer treats as dispatchable. */
const STATUS_OPTIONS: { value: VehicleStatus; label: string; hint: string }[] = [
  { value: 'available', label: 'Available', hint: 'Ready for dispatch — can be assigned routes' },
  { value: 'active', label: 'Active', hint: 'On duty and dispatchable' },
  { value: 'in_transit', label: 'In transit', hint: 'Currently carrying deliveries' },
  { value: 'delivering', label: 'Delivering', hint: 'Making deliveries' },
  { value: 'delayed', label: 'Delayed', hint: 'Behind schedule' },
  { value: 'offline', label: 'Offline', hint: 'Not dispatchable' },
  { value: 'maintenance', label: 'Maintenance', hint: 'Out of service' },
];

const VEHICLE_TYPES: { value: Vehicle['type']; label: string }[] = [
  { value: 'van', label: 'Cargo van' },
  { value: 'truck', label: 'Box truck' },
  { value: 'bike', label: 'Cargo bike' },
  { value: 'refrigerated', label: 'Refrigerated' },
];

interface VehicleFormState {
  vehicleNumber: string;
  name: string;
  licensePlate: string;
  vehicleType: Vehicle['type'];
  capacityKg: string;
  capacityVolumeM3: string;
  status: VehicleStatus;
  driverId: string;
  latitude: string;
  longitude: string;
}

const emptyForm = (): VehicleFormState => ({
  vehicleNumber: '',
  name: '',
  licensePlate: '',
  vehicleType: 'van',
  capacityKg: '1200',
  capacityVolumeM3: '12',
  status: 'available',
  driverId: '',
  latitude: '',
  longitude: '',
});

const formFromVehicle = (vehicle: Vehicle): VehicleFormState => ({
  vehicleNumber: vehicle.id,
  name: vehicle.name,
  licensePlate: vehicle.licensePlate,
  vehicleType: vehicle.type,
  capacityKg: String(vehicle.capacityKg),
  capacityVolumeM3: String(vehicle.capacityVolumeM3),
  status: vehicle.status,
  driverId: vehicle.driverId !== null ? String(vehicle.driverId) : '',
  latitude: vehicle.coordinates ? String(vehicle.coordinates[0]) : '',
  longitude: vehicle.coordinates ? String(vehicle.coordinates[1]) : '',
});

interface VehicleFormModalProps {
  editing?: Vehicle | null;
  /** Next fleet number offered as a placeholder, e.g. "VAN-07". */
  suggestedNumber: string;
  drivers: ApiDriver[];
  isOpen: boolean;
  isSubmitting: boolean;
  submitError: string | null;
  onSubmit: (draft: VehicleDraft) => Promise<void>;
  onClose: () => void;
}

/**
 * Create / edit form for a vehicle.
 *
 * Capacity, plate, driver and position are all real columns the optimizer and the
 * fleet map read, so editing them here changes actual planning behaviour rather
 * than just how the row looks.
 */
export const VehicleFormModal: React.FC<VehicleFormModalProps> = ({
  editing = null,
  suggestedNumber,
  drivers,
  isOpen,
  isSubmitting,
  submitError,
  onSubmit,
  onClose,
}) => {
  const [form, setForm] = useState<VehicleFormState>(emptyForm);

  useEffect(() => {
    if (!isOpen) return;
    setForm(editing ? formFromVehicle(editing) : emptyForm());
  }, [isOpen, editing]);

  const patch = (changes: Partial<VehicleFormState>) => setForm((prev) => ({ ...prev, ...changes }));

  const statusHint = STATUS_OPTIONS.find((option) => option.value === form.status)?.hint ?? '';

  // A coordinate needs both halves; half a pair would silently drop the position.
  const hasPartialPosition = Boolean(form.latitude) !== Boolean(form.longitude);
  const capacityInvalid =
    parseFloat(form.capacityKg) <= 0 || parseFloat(form.capacityVolumeM3) <= 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    await onSubmit({
      vehicleNumber: form.vehicleNumber.trim(),
      name: form.name.trim(),
      licensePlate: form.licensePlate.trim(),
      vehicleType: form.vehicleType,
      capacityKg: parseFloat(form.capacityKg) || 0,
      capacityVolumeM3: parseFloat(form.capacityVolumeM3) || 0,
      status: form.status,
      driverId: form.driverId ? Number(form.driverId) : null,
      coordinates:
        form.latitude && form.longitude
          ? [parseFloat(form.latitude), parseFloat(form.longitude)]
          : null,
    });
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-container entity-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="vehicle-form-title"
      >
        <div className="modal-header">
          <div className="modal-title-area">
            <Truck size={20} className="modal-icon" />
            <div>
              <h3 id="vehicle-form-title">
                {editing ? `Edit ${editing.id}` : 'Add Vehicle'}
              </h3>
              <p>Capacity drives what the optimizer can load; the driver decides whether it can be dispatched.</p>
            </div>
          </div>
          <button className="modal-close-btn" onClick={onClose} aria-label="Close dialog">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="entity-modal-body">
          <div className="form-row-2">
            <div className="form-group">
              <label htmlFor="vehicle-number">Vehicle ID</label>
              <input
                id="vehicle-number"
                type="text"
                required
                placeholder={suggestedNumber}
                value={form.vehicleNumber}
                onChange={(e) => patch({ vehicleNumber: e.target.value })}
              />
              <span className="field-hint">
                The short code dispatchers use, e.g. {suggestedNumber}. Must be unique.
              </span>
            </div>
            <div className="form-group">
              <label htmlFor="vehicle-name">Display Name</label>
              <input
                id="vehicle-name"
                type="text"
                required
                placeholder="e.g. Northside Cargo Van"
                value={form.name}
                onChange={(e) => patch({ name: e.target.value })}
              />
            </div>
          </div>

          <div className="form-row-2">
            <div className="form-group">
              <label htmlFor="vehicle-plate">License Plate</label>
              <input
                id="vehicle-plate"
                type="text"
                required
                placeholder="e.g. IL 47-KQX"
                value={form.licensePlate}
                onChange={(e) => patch({ licensePlate: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label htmlFor="vehicle-type">Vehicle Type</label>
              <select
                id="vehicle-type"
                value={form.vehicleType}
                onChange={(e) => patch({ vehicleType: e.target.value as Vehicle['type'] })}
              >
                {VEHICLE_TYPES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="form-row-2">
            <div className="form-group">
              <label htmlFor="vehicle-capacity-kg">Weight Capacity (kg)</label>
              <input
                id="vehicle-capacity-kg"
                type="number"
                required
                min="1"
                step="1"
                value={form.capacityKg}
                onChange={(e) => patch({ capacityKg: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label htmlFor="vehicle-capacity-m3">Volume Capacity (m³)</label>
              <input
                id="vehicle-capacity-m3"
                type="number"
                required
                min="0.1"
                step="0.1"
                value={form.capacityVolumeM3}
                onChange={(e) => patch({ capacityVolumeM3: e.target.value })}
              />
            </div>
          </div>

          <div className="form-row-2">
            <div className="form-group">
              <label htmlFor="vehicle-status">Status</label>
              <select
                id="vehicle-status"
                value={form.status}
                onChange={(e) => patch({ status: e.target.value as VehicleStatus })}
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <span className="field-hint">{statusHint}</span>
            </div>
            <div className="form-group">
              <label htmlFor="vehicle-driver">Assigned Driver</label>
              <select
                id="vehicle-driver"
                value={form.driverId}
                onChange={(e) => patch({ driverId: e.target.value })}
              >
                <option value="">No driver</option>
                {drivers.map((driver) => (
                  <option key={driver.id} value={driver.id}>
                    {driver.name}
                    {driver.phone ? ` — ${driver.phone}` : ''}
                    {driver.status !== 'active' ? ` (${driver.status.replace('_', ' ')})` : ''}
                  </option>
                ))}
              </select>
              <span className="field-hint">
                Only available and active vehicles are offered to the optimizer.
              </span>
            </div>
          </div>

          <fieldset className="form-window-fieldset">
            <legend>Current Location</legend>
            <p className="hint-text">
              Optional. Without coordinates the vehicle is still dispatchable, but it will not appear on
              the live map and the planner will use the depot as its start point.
            </p>
            <div className="form-row-2">
              <div className="form-group">
                <label htmlFor="vehicle-latitude">Latitude</label>
                <input
                  id="vehicle-latitude"
                  type="number"
                  step="0.00001"
                  min="-90"
                  max="90"
                  placeholder="12.97160"
                  value={form.latitude}
                  onChange={(e) => patch({ latitude: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label htmlFor="vehicle-longitude">Longitude</label>
                <input
                  id="vehicle-longitude"
                  type="number"
                  step="0.00001"
                  min="-180"
                  max="180"
                  placeholder="77.59460"
                  value={form.longitude}
                  onChange={(e) => patch({ longitude: e.target.value })}
                />
              </div>
            </div>
            {hasPartialPosition && (
              <p className="map-notice" role="alert">
                Both latitude and longitude are needed. The position will be left empty.
              </p>
            )}
          </fieldset>

          {capacityInvalid && (
            <p className="map-notice" role="alert">
              Capacity must be greater than zero — a vehicle with no capacity cannot be loaded.
            </p>
          )}

          {submitError && <ErrorState title="Vehicle not saved" message={submitError} />}

          <div className="modal-footer" style={{ padding: 0, marginTop: '1.25rem' }}>
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={isSubmitting || capacityInvalid}>
              {isSubmitting ? <Loader2 size={14} className="spin" /> : <Truck size={14} />}
              {isSubmitting ? 'Saving…' : editing ? 'Save Changes' : 'Add Vehicle'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};