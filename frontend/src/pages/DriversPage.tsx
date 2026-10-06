import React, { useState } from 'react';
import { useFleet } from '../context/FleetContext';
import { DriverFormModal, DriversTable } from '../components/DriverComponents';
import { ConfirmDialog } from '../components/ConfirmDialog';
import type { DriverDraft } from '../context/FleetContext';
import type { ApiDriver } from '../services/api';
import { User, Plus } from 'lucide-react';

export const DriversPage: React.FC = () => {
  const { drivers, vehicles, addDriver, updateDriver, deleteDriver } = useFleet();

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editing, setEditing] = useState<ApiDriver | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [pendingDelete, setPendingDelete] = useState<ApiDriver | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const openAdd = () => {
    setEditing(null);
    setSubmitError(null);
    setIsFormOpen(true);
  };

  const openEdit = (driver: ApiDriver) => {
    setEditing(driver);
    setSubmitError(null);
    setIsFormOpen(true);
  };

  const closeForm = () => {
    if (isSubmitting) return;
    setIsFormOpen(false);
    setEditing(null);
    setSubmitError(null);
  };

  const handleSubmit = async (draft: DriverDraft) => {
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      if (editing) {
        await updateDriver(editing.id, draft);
      } else {
        await addDriver(draft);
      }
      setIsFormOpen(false);
      setEditing(null);
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : 'Could not save the driver. Nothing was changed.'
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
      await deleteDriver(pendingDelete.id);
      setPendingDelete(null);
    } catch (err) {
      setDeleteError(
        err instanceof Error ? err.message : 'Could not delete the driver. Nothing was changed.'
      );
    } finally {
      setIsDeleting(false);
    }
  };

  const activeCount = drivers.filter((d) => d.status === 'active').length;
  const offDutyCount = drivers.filter((d) => d.status === 'off_duty').length;
  const suspendedCount = drivers.filter((d) => d.status === 'suspended').length;
  const assignedCount = drivers.filter((d) => vehicles.some((v) => v.driverId === d.id)).length;

  /** Vehicles that will be released if this driver is removed. */
  const releasingVehicles = pendingDelete
    ? vehicles.filter((v) => v.driverId === pendingDelete.id)
    : [];

  return (
    <div className="drivers-page">
      <div className="page-action-header">
        <div>
          <h2 className="section-title">
            <User size={20} /> Driver Roster
          </h2>
          <p className="section-subtitle">
            Manage driver contacts and duty status. Assign a driver to a vehicle from the Fleet page.
          </p>
        </div>
        <button className="btn btn-primary" onClick={openAdd}>
          <Plus size={16} /> Add Driver
        </button>
      </div>

      <div className="driver-summary-row">
        <div className="driver-summary-card">
          <span className="driver-summary-label">On roster</span>
          <span className="driver-summary-value">{drivers.length}</span>
        </div>
        <div className="driver-summary-card">
          <span className="driver-summary-label">Active</span>
          <span className="driver-summary-value">{activeCount}</span>
        </div>
        <div className="driver-summary-card">
          <span className="driver-summary-label">Off duty</span>
          <span className="driver-summary-value">{offDutyCount}</span>
        </div>
        <div className="driver-summary-card">
          <span className="driver-summary-label">Suspended</span>
          <span className="driver-summary-value">{suspendedCount}</span>
        </div>
        <div className="driver-summary-card">
          <span className="driver-summary-label">Assigned to a vehicle</span>
          <span className="driver-summary-value">{assignedCount}</span>
        </div>
      </div>

      <DriversTable
        drivers={drivers}
        vehicles={vehicles}
        onSelect={() => {}}
        onEdit={openEdit}
        onDelete={(driver) => {
          setDeleteError(null);
          setPendingDelete(driver);
        }}
      />

      <DriverFormModal
        editing={editing}
        isOpen={isFormOpen}
        isSubmitting={isSubmitting}
        submitError={submitError}
        onSubmit={handleSubmit}
        onClose={closeForm}
      />

      <ConfirmDialog
        isOpen={Boolean(pendingDelete)}
        title="Delete this driver?"
        description={
          pendingDelete
            ? `${pendingDelete.name}${
                pendingDelete.phone ? ` (${pendingDelete.phone})` : ''
              } will be permanently removed from the roster.`
            : ''
        }
        consequence={
          releasingVehicles.length > 0
            ? `${releasingVehicles
                .map((v) => v.id)
                .join(', ')} ${releasingVehicles.length === 1 ? 'is' : 'are'} currently assigned to this driver and will become unassigned. The vehicles themselves are kept.`
            : undefined
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