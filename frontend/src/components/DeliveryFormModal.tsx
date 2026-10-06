import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, MapPin, Package, X, Crosshair } from 'lucide-react';
import { FleetMap } from './map/FleetMap';
import type { MapMarker } from './map/FleetMap';
import { ErrorState } from './ErrorState';
import { geocodeAddress, reverseGeocode, ApiRequestError } from '../services/api';
import type { Delivery, DeliveryPriority, DeliveryStatus, LatLng, Vehicle } from '../types';
import { useMapConfig } from '../context/MapContext';
import { fieldsToWindow, windowToFields } from '../utils/timeWindow';
import type { TimeWindowFields } from '../utils/timeWindow';
import type { DeliveryDraft } from '../context/FleetContext';

interface DeliveryFormState {
  recipientName: string;
  phone: string;
  address: string;
  weightKg: string;
  volumeM3: string;
  window: TimeWindowFields;
  priority: DeliveryPriority;
  status: DeliveryStatus;
  notes: string;
  assignedVehicleId: string;
}

const todayIso = (): string => {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

/**
 * Defaults to a sensible window: today, 2:00 PM–5:00 PM.
 *
 * An operator adding a delivery almost always means "this afternoon", and the
 * optimizer needs a window to plan against. The value is still fully editable,
 * and clearing the date removes the window entirely.
 */
const defaultFormState = (): DeliveryFormState => ({
  recipientName: '',
  phone: '',
  address: '',
  weightKg: '10',
  volumeM3: '0.2',
  window: { date: todayIso(), from: '14:00', to: '17:00' },
  priority: 'normal',
  status: 'pending',
  notes: '',
  assignedVehicleId: '',
});

const formStateFromDelivery = (delivery: Delivery): DeliveryFormState => ({
  recipientName: delivery.recipientName ?? '',
  phone: delivery.phone ?? '',
  address: delivery.address ?? '',
  weightKg: String(delivery.weightKg),
  volumeM3: String(delivery.volumeM3),
  window: windowToFields(delivery.timeWindowStart, delivery.timeWindowEnd),
  priority: delivery.priority,
  status: delivery.status,
  notes: delivery.notes ?? '',
  assignedVehicleId: delivery.assignedVehicleId ?? '',
});

const DELIVERY_STATUSES: { value: DeliveryStatus; label: string }[] = [
  { value: 'pending', label: 'Pending' },
  { value: 'assigned', label: 'Assigned' },
  { value: 'in_transit', label: 'In transit' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'delayed', label: 'Delayed' },
  { value: 'failed', label: 'Failed' },
  { value: 'cancelled', label: 'Cancelled' },
];

interface DeliveryFormModalProps {
  /** Omit to create a new delivery. */
  editing?: Delivery | null;
  vehicles: Vehicle[];
  isOpen: boolean;
  isSubmitting: boolean;
  submitError: string | null;
  onSubmit: (draft: DeliveryDraft) => Promise<void>;
  onClose: () => void;
}

/**
 * Single form for creating and editing a delivery.
 *
 * Time windows are entered as a date plus from/to clock times — the shape a
 * dispatcher actually thinks in — and converted to the API's UTC ISO strings on
 * submit by `fieldsToWindow`.
 */
export const DeliveryFormModal: React.FC<DeliveryFormModalProps> = ({
  editing = null,
  vehicles,
  isOpen,
  isSubmitting,
  submitError,
  onSubmit,
  onClose,
}) => {
  const { defaultCenter, defaultZoom } = useMapConfig();
  const [form, setForm] = useState<DeliveryFormState>(defaultFormState);
  const [picked, setPicked] = useState<{ position: LatLng; label: string } | null>(null);
  const [isLocating, setIsLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);

  // Re-seed the fields whenever the dialog opens, so an edit shows the stored
  // values instead of whatever was typed last.
  useEffect(() => {
    if (!isOpen) return;
    setForm(editing ? formStateFromDelivery(editing) : defaultFormState());
    setPicked(editing?.coordinates ? { position: editing.coordinates, label: editing.address } : null);
    setLocateError(null);
  }, [isOpen, editing]);

  const patch = (changes: Partial<DeliveryFormState>) =>
    setForm((prev) => ({ ...prev, ...changes }));

  const patchWindow = (changes: Partial<TimeWindowFields>) =>
    setForm((prev) => ({ ...prev, window: { ...prev.window, ...changes } }));

  const handleLocateAddress = async () => {
    const address = form.address.trim();
    if (!address) return;

    setIsLocating(true);
    setLocateError(null);
    try {
      const result = await geocodeAddress(address);
      setPicked({
        position: [result.latitude, result.longitude],
        label: result.display_name ?? result.formatted_address ?? address,
      });
    } catch (err) {
      setPicked(null);
      setLocateError(
        err instanceof ApiRequestError
          ? `Could not locate that address (HTTP ${err.status}): ${err.message}`
          : 'Could not locate that address'
      );
    } finally {
      setIsLocating(false);
    }
  };

  const handleMapClick = async (position: LatLng) => {
    setIsLocating(true);
    setLocateError(null);
    try {
      const result = await reverseGeocode(position[0], position[1]);
      const label = result.address ?? `${position[0].toFixed(5)}, ${position[1].toFixed(5)}`;
      setPicked({ position: [result.latitude, result.longitude], label });
      patch({ address: result.address || form.address });
    } catch (err) {
      setPicked({ position, label: `${position[0].toFixed(5)}, ${position[1].toFixed(5)}` });
      setLocateError(
        err instanceof ApiRequestError
          ? `Address lookup failed (HTTP ${err.status}) — pin kept, address unchanged.`
          : 'Address lookup failed — pin kept, address unchanged.'
      );
    } finally {
      setIsLocating(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const window = fieldsToWindow(form.window);
    await onSubmit({
      recipientName: form.recipientName.trim(),
      phone: form.phone.trim(),
      address: form.address.trim(),
      coordinates: picked?.position ?? null,
      weightKg: parseFloat(form.weightKg) || 0,
      volumeM3: parseFloat(form.volumeM3) || 0,
      timeWindowStart: window.time_window_start,
      timeWindowEnd: window.time_window_end,
      priority: form.priority,
      status: form.status,
      notes: form.notes.trim(),
      assignedVehicleId: form.assignedVehicleId || null,
    });
  };

  const pickMarkers: MapMarker[] = useMemo(
    () =>
      picked
        ? [
            {
              id: 'picked',
              position: picked.position,
              label: '📍',
              kind: 'pin',
              selected: true,
              title: picked.label,
            },
          ]
        : [],
    [picked]
  );

  /** True when the operator set a date but left the times blank. */
  const windowIncomplete = Boolean(form.window.date) && !form.window.from && !form.window.to;

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-container delivery-modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '860px' }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="delivery-form-title"
      >
        <div className="modal-header">
          <div className="modal-title-area">
            <Package size={20} className="modal-icon" />
            <div>
              <h3 id="delivery-form-title">
                {editing ? `Edit ${editing.trackingNumber}` : 'Add New Delivery Order'}
              </h3>
              <p>Recipient address, package size, and the time window the driver must hit.</p>
            </div>
          </div>
          <button className="modal-close-btn" onClick={onClose} aria-label="Close dialog">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="delivery-modal-body">
          <div className="delivery-modal-form">
            <div className="form-group">
              <label htmlFor="delivery-recipient">Recipient Name</label>
              <input
                id="delivery-recipient"
                type="text"
                required
                placeholder="e.g. Apex Tech Hub"
                value={form.recipientName}
                onChange={(e) => patch({ recipientName: e.target.value })}
              />
            </div>

            <div className="form-row-2">
              <div className="form-group">
                <label htmlFor="delivery-phone">Contact Phone</label>
                <input
                  id="delivery-phone"
                  type="text"
                  placeholder="e.g. +1 (312) 555-0192"
                  value={form.phone}
                  onChange={(e) => patch({ phone: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label htmlFor="delivery-priority">Priority</label>
                <select
                  id="delivery-priority"
                  value={form.priority}
                  onChange={(e) => patch({ priority: e.target.value as DeliveryPriority })}
                >
                  <option value="urgent">Urgent</option>
                  <option value="high">High</option>
                  <option value="normal">Normal</option>
                  <option value="low">Low</option>
                </select>
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="delivery-address">Destination Address</label>
              <div className="input-with-action">
                <input
                  id="delivery-address"
                  type="text"
                  required
                  placeholder="e.g. 100 Feet Road, Indiranagar, Bengaluru"
                  value={form.address}
                  onChange={(e) => patch({ address: e.target.value })}
                />
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={handleLocateAddress}
                  disabled={isLocating || !form.address.trim()}
                  title="Look up this address on the map"
                >
                  {isLocating ? <Loader2 size={13} className="spin" /> : <MapPin size={13} />}
                  <span>Locate</span>
                </button>
              </div>
            </div>

            <div className="form-row-2">
              <div className="form-group">
                <label htmlFor="delivery-weight">Package Weight (kg)</label>
                <input
                  id="delivery-weight"
                  type="number"
                  required
                  step="0.5"
                  min="0"
                  value={form.weightKg}
                  onChange={(e) => patch({ weightKg: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label htmlFor="delivery-volume">Volume (m³)</label>
                <input
                  id="delivery-volume"
                  type="number"
                  required
                  step="0.05"
                  min="0"
                  value={form.volumeM3}
                  onChange={(e) => patch({ volumeM3: e.target.value })}
                />
              </div>
            </div>

            {/*
              Time window as date + from/to clock times.
              Leaving the date blank means "no window", which the optimizer treats
              as unconstrained rather than as a default 9-to-5.
            */}
            <fieldset className="form-window-fieldset">
              <legend>Delivery Time Window</legend>
              <p className="hint-text">
                Times are in your local timezone and saved as UTC. Leave the date empty for no window.
              </p>
              <div className="form-row-3">
                <div className="form-group">
                  <label htmlFor="delivery-window-date">Date</label>
                  <input
                    id="delivery-window-date"
                    type="date"
                    value={form.window.date}
                    onChange={(e) => patchWindow({ date: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="delivery-window-from">From</label>
                  <input
                    id="delivery-window-from"
                    type="time"
                    disabled={!form.window.date}
                    value={form.window.from}
                    onChange={(e) => patchWindow({ from: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="delivery-window-to">To</label>
                  <input
                    id="delivery-window-to"
                    type="time"
                    disabled={!form.window.date}
                    value={form.window.to}
                    onChange={(e) => patchWindow({ to: e.target.value })}
                  />
                </div>
              </div>
              {windowIncomplete && (
                <p className="map-notice" role="status">
                  Date set but no times chosen — the delivery will be treated as having no window.
                </p>
              )}
              {form.window.from && form.window.to && form.window.to <= form.window.from && (
                <p className="map-notice" role="status">
                  End time is not later than the start, so the window rolls past midnight.
                </p>
              )}
            </fieldset>

            <div className="form-row-2">
              <div className="form-group">
                <label htmlFor="delivery-status">Status</label>
                <select
                  id="delivery-status"
                  value={form.status}
                  onChange={(e) => patch({ status: e.target.value as DeliveryStatus })}
                >
                  {DELIVERY_STATUSES.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label htmlFor="delivery-vehicle">Assigned Vehicle</label>
                <select
                  id="delivery-vehicle"
                  value={form.assignedVehicleId}
                  onChange={(e) => patch({ assignedVehicleId: e.target.value })}
                >
                  <option value="">Unassigned</option>
                  {vehicles.map((vehicle) => (
                    <option key={vehicle.id} value={vehicle.id}>
                      {vehicle.id} — {vehicle.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="delivery-notes">Dispatcher Instructions / Notes</label>
              <textarea
                id="delivery-notes"
                rows={2}
                placeholder="Special dock instructions, gate code, contact person..."
                value={form.notes}
                onChange={(e) => patch({ notes: e.target.value })}
              />
            </div>

            {submitError && <ErrorState title="Delivery not saved" message={submitError} />}

            <div className="modal-footer" style={{ padding: 0, marginTop: '1.25rem' }}>
              <button type="button" className="btn btn-secondary" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
                {isSubmitting ? <Loader2 size={14} className="spin" /> : <Package size={14} />}
                {isSubmitting
                  ? 'Saving…'
                  : editing
                  ? 'Save Changes'
                  : 'Create Shipment Order'}
              </button>
            </div>
          </div>

          <div className="delivery-modal-map">
            <div className="delivery-map-header">
              <span className="param-label">Pick the drop-off point</span>
              <span className="hint-text">Click the map to drop a pin</span>
            </div>

            <FleetMap
              markers={pickMarkers}
              height="260px"
              center={defaultCenter}
              zoom={defaultZoom}
              onMapClick={handleMapClick}
              autoFit={Boolean(picked)}
              ariaLabel="Map for choosing the delivery location"
            />

            {isLocating && (
              <p className="map-notice">
                <Loader2 size={12} className="spin" /> Contacting the geocoding provider…
              </p>
            )}

            {locateError && (
              <p className="map-notice error" role="alert">
                {locateError}
              </p>
            )}

            {picked ? (
              <div className="picked-location">
                <MapPin size={13} />
                <span>
                  <span className="font-mono">
                    {picked.position[0].toFixed(5)}, {picked.position[1].toFixed(5)}
                  </span>
                  <em>{picked.label}</em>
                </span>
                <button
                  type="button"
                  className="map-control-icon-btn"
                  onClick={() => setPicked(null)}
                  aria-label="Clear picked location"
                >
                  <X size={13} />
                </button>
              </div>
            ) : (
              <p className="hint-text">
                <Crosshair size={12} /> No pin yet. The backend geocodes the address when you save, so
                a pin is optional.
              </p>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};