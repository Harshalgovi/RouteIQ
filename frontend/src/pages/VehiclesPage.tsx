import React, { useState } from 'react';
import { useFleet } from '../context/FleetContext';
import { VehicleTable } from '../components/VehicleTable';
import { VehicleDetailDrawer } from '../components/VehicleDetailDrawer';
import { VehicleFormModal } from '../components/VehicleFormModal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import type { VehicleDraft } from '../context/FleetContext';
import type { Vehicle } from '../types';
import { Truck, Radio, RotateCcw, Plus } from 'lucide-react';

interface VehiclesPageProps {
  /** Filter requested by another page, e.g. "no-driver". */
  pendingFilter?: { value: string; nonce: number } | null;
}

/**
 * Next sequential fleet number, e.g. VAN-07.
 *
 * Offered as a placeholder only — the dispatcher still has to accept it, because
 * vehicle numbers are human-facing identifiers rather than generated keys.
 */
const suggestVehicleNumber = (vehicles: Vehicle[]): string => {
  const numbers = vehicles
    .map((v) => /^([A-Z]+)-(\d+)$/.exec(v.id))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({ prefix: match[1], serial: Number(match[2]) }));

  if (numbers.length === 0) return 'VAN-01';

  const prefix = numbers[0].prefix;
  const highest = Math.max(
    ...numbers.filter((n) => n.prefix === prefix).map((n) => n.serial)
  );
  return `${prefix}-${String(highest + 1).padStart(2, '0')}`;
};

export const VehiclesPage: React.FC<VehiclesPageProps> = ({ pendingFilter }) => {
  const {
    vehicles,
    deliveries,
    drivers,
    trackedVehicles,
    setIsTrackingModalOpen,
    clearAllTracking,
    addVehicle,
    updateVehicle,
    deleteVehicle,
  } = useFleet();

  const [selectedDrawerVehicle, setSelectedDrawerVehicle] = useState<Vehicle | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editing, setEditing] = useState<Vehicle | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [pendingDelete, setPendingDelete] = useState<Vehicle | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const openAdd = () => {
    setEditing(null);
    setSubmitError(null);
    setIsFormOpen(true);
  };

  const openEdit = (vehicle: Vehicle) => {
    setEditing(vehicle);
    setSubmitError(null);
    setIsFormOpen(true);
  };

  const closeForm = () => {
    if (isSubmitting) return;
    setIsFormOpen(false);
    setEditing(null);
    setSubmitError(null);
  };

  const handleSubmit = async (draft: VehicleDraft) => {
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      if (editing) {
        await updateVehicle(editing.id, draft);
      } else {
        await addVehicle(draft);
      }
      setIsFormOpen(false);
      setEditing(null);
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : 'Could not save the vehicle. Nothing was changed.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!pendingDelete) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await deleteVehicle(pendingDelete.id);
      if (selectedDrawerVehicle?.id === pendingDelete.id) {
        setSelectedDrawerVehicle(null);
      }
      setPendingDelete(null);
    } catch (err) {
      setDeleteError(
        err instanceof Error ? err.message : 'Could not delete the vehicle. Nothing was changed.'
      );
    } finally {
      setIsDeleting(false);
    }
  };

  // Open deliveries on board, so the confirm dialog can be specific about what
  // happens to them rather than deleting silently.
  const openDeliveriesOnVehicle = pendingDelete
    ? deliveries.filter(
        (d) =>
          d.assignedVehicleId === pendingDelete.id &&
          d.status !== 'delivered' &&
          d.status !== 'cancelled'
      )
    : [];

  const isTracked = pendingDelete?.isTracked ?? false;

  return (
    <div className="vehicles-page">
      <div className="page-action-header">
        <div>
          <h2 className="section-title">
            <Truck size={20} /> Fleet Vehicles & Drivers
          </h2>
          <p className="section-subtitle">
            Configure vehicle capacity, driver contact, route assignment, and live tracking status.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem' }}>
          {trackedVehicles.length > 0 && (
            <button className="btn btn-secondary" onClick={clearAllTracking} title="Suspend all active tracking">
              <RotateCcw size={14} /> Clear All Tracking
            </button>
          )}
          <button className="btn btn-secondary" onClick={() => setIsTrackingModalOpen(true)}>
            <Radio size={15} /> Track a Vehicle
          </button>
          <button className="btn btn-primary" onClick={openAdd}>
            <Plus size={16} /> Add Vehicle
          </button>
        </div>
      </div>

      {pendingFilter && (
        <p className="inline-banner" role="status">
          Filtered to <strong>{pendingFilter.value.replace('-', ' ')}</strong> from the dashboard.
        </p>
      )}

      {/* Fleet Table */}
      <VehicleTable
        onSelectVehicle={(v) => setSelectedDrawerVehicle(v)}
        pendingFilter={pendingFilter}
        onEditVehicle={openEdit}
        onDeleteVehicle={(vehicle) => {
          setDeleteError(null);
          setPendingDelete(vehicle);
        }}
      />

      {/* Slide-over Vehicle Detail Drawer */}
      <VehicleDetailDrawer
        vehicle={selectedDrawerVehicle}
        onClose={() => setSelectedDrawerVehicle(null)}
        onEdit={selectedDrawerVehicle ? () => openEdit(selectedDrawerVehicle) : undefined}
        onDelete={
          selectedDrawerVehicle
            ? () => {
                setDeleteError(null);
                setPendingDelete(selectedDrawerVehicle);
              }
            : undefined
        }
      />

      <VehicleFormModal
        editing={editing}
        suggestedNumber={suggestVehicleNumber(vehicles)}
        drivers={drivers}
        isOpen={isFormOpen}
        isSubmitting={isSubmitting}
        submitError={submitError}
        onSubmit={handleSubmit}
        onClose={closeForm}
      />

      <ConfirmDialog
        isOpen={Boolean(pendingDelete)}
        title="Delete this vehicle?"
        description={
          pendingDelete
            ? `${pendingDelete.id} — ${pendingDelete.name} (${pendingDelete.licensePlate}) will be permanently removed from the fleet.`
            : ''
        }
        consequence={
          [
            isTracked ? 'Tracking is currently enabled for this vehicle and will stop.' : null,
            openDeliveriesOnVehicle.length > 0
              ? `${openDeliveriesOnVehicle.length} delivery record(s) are assigned to it and will become unassigned. Those deliveries are kept.`
              : null,
          ]
            .filter(Boolean)
            .join(' ') || undefined
        }
        isWorking={isDeleting}
        error={deleteError}
        onConfirm={handleDelete}
        onCancel={() => {
          if (!isDeleting) {
            setPendingDelete(null);
            setDeleteError(null);
          }
        }}
      />
    </div>
  );
};