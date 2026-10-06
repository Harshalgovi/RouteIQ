import React, { useEffect, useState } from 'react';
import { Loader2, User, X } from 'lucide-react';
import { ErrorState } from './ErrorState';
import { StatusBadge } from './StatusBadge';
import { EmptyState } from './EmptyState';
import type { ApiDriver, DriverStatus } from '../services/api';
import type { DriverDraft } from '../context/FleetContext';
import type { Vehicle } from '../types';
import { Search, Pencil, Trash2, ShieldAlert, PauseCircle, CheckCircle2 } from 'lucide-react';

/** Statuses the backend stores for a driver. */
const DRIVER_STATUSES: { value: DriverStatus; label: string; hint: string }[] = [
  { value: 'active', label: 'Active', hint: 'Available to be assigned to a vehicle' },
  { value: 'off_duty', label: 'Off duty', hint: 'Not driving right now' },
  { value: 'suspended', label: 'Suspended', hint: 'Blocked from assignments' },
];

interface DriverFormState {
  name: string;
  phone: string;
  status: DriverStatus;
}

const emptyForm = (): DriverFormState => ({
  name: '',
  phone: '',
  status: 'active',
});

const formFromDriver = (driver: ApiDriver): DriverFormState => ({
  name: driver.name,
  phone: driver.phone ?? '',
  status: (DRIVER_STATUSES.find((s) => s.value === driver.status)?.value ??
    'active') as DriverStatus,
});

interface DriverFormModalProps {
  editing?: ApiDriver | null;
  isOpen: boolean;
  isSubmitting: boolean;
  submitError: string | null;
  onSubmit: (draft: DriverDraft) => Promise<void>;
  onClose: () => void;
}

/**
 * Create / edit form for a driver.
 *
 * Only name, phone and duty status are collected — that is exactly what the
 * `drivers` table stores. No licence number or certification field is invented,
 * because none is recorded.
 */
export const DriverFormModal: React.FC<DriverFormModalProps> = ({
  editing = null,
  isOpen,
  isSubmitting,
  submitError,
  onSubmit,
  onClose,
}) => {
  const [form, setForm] = useState<DriverFormState>(emptyForm);

  useEffect(() => {
    if (!isOpen) return;
    setForm(editing ? formFromDriver(editing) : emptyForm());
  }, [isOpen, editing]);

  const patch = (changes: Partial<DriverFormState>) => setForm((prev) => ({ ...prev, ...changes }));
  const statusHint = DRIVER_STATUSES.find((option) => option.value === form.status)?.hint ?? '';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSubmit({
      name: form.name.trim(),
      phone: form.phone.trim(),
      status: form.status,
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
        aria-labelledby="driver-form-title"
      >
        <div className="modal-header">
          <div className="modal-title-area">
            <User size={20} className="modal-icon" />
            <div>
              <h3 id="driver-form-title">{editing ? 'Edit Driver' : 'Add Driver'}</h3>
              <p>Drivers are assigned to vehicles from the vehicle form or the fleet table.</p>
            </div>
          </div>
          <button className="modal-close-btn" onClick={onClose} aria-label="Close dialog">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="entity-modal-body">
          <div className="form-group">
            <label htmlFor="driver-name">Full Name</label>
            <input
              id="driver-name"
              type="text"
              required
              placeholder="e.g. Dana Whitfield"
              value={form.name}
              onChange={(e) => patch({ name: e.target.value })}
            />
          </div>

          <div className="form-group">
            <label htmlFor="driver-phone">Contact Phone</label>
            <input
              id="driver-phone"
              type="text"
              placeholder="e.g. +1 (312) 555-0142"
              value={form.phone}
              onChange={(e) => patch({ phone: e.target.value })}
            />
          </div>

          <div className="form-group">
            <label htmlFor="driver-status">Duty Status</label>
            <select
              id="driver-status"
              value={form.status}
              onChange={(e) => patch({ status: e.target.value as DriverStatus })}
            >
              {DRIVER_STATUSES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <span className="field-hint">{statusHint}</span>
          </div>

          {submitError && <ErrorState title="Driver not saved" message={submitError} />}

          <div className="modal-footer" style={{ padding: 0, marginTop: '1.25rem' }}>
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
              {isSubmitting ? <Loader2 size={14} className="spin" /> : <User size={14} />}
              {isSubmitting ? 'Saving…' : editing ? 'Save Changes' : 'Add Driver'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

interface DriversTableProps {
  drivers: ApiDriver[];
  vehicles: Vehicle[];
  onSelect: (driver: ApiDriver) => void;
  onEdit: (driver: ApiDriver) => void;
  onDelete: (driver: ApiDriver) => void;
}

/** Roster table: each driver plus the vehicle currently driving, if any. */
export const DriversTable: React.FC<DriversTableProps> = ({
  drivers,
  vehicles,
  onSelect,
  onEdit,
  onDelete,
}) => {
  const [search, setSearch] = useState('');

  const filtered = drivers.filter((driver) => {
    const term = search.trim().toLowerCase();
    if (!term) return true;
    return (
      driver.name.toLowerCase().includes(term) ||
      (driver.phone ?? '').toLowerCase().includes(term) ||
      driver.status.toLowerCase().includes(term)
    );
  });

  const vehicleFor = (driver: ApiDriver): Vehicle | undefined =>
    vehicles.find((v) => v.driverId === driver.id);

  const statusIcon = (status: string) => {
    if (status === 'suspended') return <ShieldAlert size={13} aria-hidden="true" />;
    if (status === 'off_duty') return <PauseCircle size={13} aria-hidden="true" />;
    return <CheckCircle2 size={13} aria-hidden="true" />;
  };

  return (
    <div className="card entity-card">
      <div className="table-toolbar">
        <div className="table-search">
          <Search size={15} aria-hidden="true" />
          <label className="visually-hidden" htmlFor="driver-search">
            Search drivers
          </label>
          <input
            id="driver-search"
            type="text"
            placeholder="Search drivers by name, phone or status..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={User}
          title={drivers.length === 0 ? 'No drivers on the roster' : 'No drivers match your search'}
          description={
            drivers.length === 0
              ? 'Add a driver to start assigning them to vehicles.'
              : 'Try a different name, phone number or status.'
          }
        />
      ) : (
        <div className="table-responsive">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Driver</th>
                <th scope="col">Phone</th>
                <th scope="col">Status</th>
                <th scope="col">Assigned Vehicle</th>
                <th scope="col" style={{ textAlign: 'right' }}>
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((driver) => {
                const vehicle = vehicleFor(driver);
                return (
                  <tr key={driver.id} className="table-row hoverable">
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                        <span className="driver-avatar" aria-hidden="true">
                          {driver.name.trim().charAt(0).toUpperCase() || '?'}
                        </span>
                        <div>
                          <div style={{ fontWeight: 500 }}>{driver.name}</div>
                          <div className="table-subtext">ID {driver.id}</div>
                        </div>
                      </div>
                    </td>
                    <td className="table-subtext">{driver.phone || 'No phone on file'}</td>
                    <td>
                      <span className="driver-status-cell">
                        {statusIcon(driver.status)}
                        <StatusBadge
                          status={
                            driver.status === 'active'
                              ? 'available'
                              : driver.status === 'off_duty'
                              ? 'offline'
                              : 'maintenance'
                          }
                          size="sm"
                        />
                        <span className="table-subtext">
                          {driver.status.replace('_', ' ')}
                        </span>
                      </span>
                    </td>
                    <td>
                      {vehicle ? (
                        <span className="badge-assigned font-mono">{vehicle.id}</span>
                      ) : (
                        <span className="badge-unassigned">Not assigned</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div className="row-actions">
                        <button
                          type="button"
                          className="btn-icon"
                          onClick={() => onSelect(driver)}
                          title={`View ${driver.name}`}
                          aria-label={`View ${driver.name}`}
                        >
                          <User size={15} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className="btn-icon"
                          onClick={() => onEdit(driver)}
                          title={`Edit ${driver.name}`}
                          aria-label={`Edit ${driver.name}`}
                        >
                          <Pencil size={15} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className="btn-icon danger"
                          onClick={() => onDelete(driver)}
                          title={`Delete ${driver.name}`}
                          aria-label={`Delete ${driver.name}`}
                        >
                          <Trash2 size={15} aria-hidden="true" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};