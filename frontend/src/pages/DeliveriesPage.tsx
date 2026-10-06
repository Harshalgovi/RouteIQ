import React, { useState } from 'react';
import { useFleet } from '../context/FleetContext';
import { DeliveryTable } from '../components/DeliveryTable';
import { DeliveryDetailDrawer } from '../components/DeliveryDetailDrawer';
import { DeliveryFormModal } from '../components/DeliveryFormModal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import type { DeliveryDraft } from '../context/FleetContext';
import type { Delivery } from '../types';
import { Package, Plus } from 'lucide-react';

interface DeliveriesPageProps {
  /** Status filter requested by another page, e.g. from a dashboard count. */
  pendingFilter?: { value: string; nonce: number } | null;
}

export const DeliveriesPage: React.FC<DeliveriesPageProps> = ({ pendingFilter }) => {
  const {
    deliveries,
    vehicles,
    addDelivery,
    updateDelivery,
    deleteDelivery,
    selectedDelivery,
    setSelectedDeliveryId,
  } = useFleet();

  /** null = adding; a Delivery = editing that record. */
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editing, setEditing] = useState<Delivery | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [pendingDelete, setPendingDelete] = useState<Delivery | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const openAdd = () => {
    setEditing(null);
    setSubmitError(null);
    setIsFormOpen(true);
  };

  const openEdit = (delivery: Delivery) => {
    setEditing(delivery);
    setSubmitError(null);
    setIsFormOpen(true);
  };

  const closeForm = () => {
    if (isSubmitting) return;
    setIsFormOpen(false);
    setEditing(null);
    setSubmitError(null);
  };

  const handleSubmit = async (draft: DeliveryDraft) => {
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      if (editing) {
        await updateDelivery(editing.id, draft);
      } else {
        await addDelivery(draft);
      }
      setIsFormOpen(false);
      setEditing(null);
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : 'Could not save the delivery. Nothing was changed.'
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
      await deleteDelivery(pendingDelete.id);
      // Close the detail drawer if it was showing the record just removed.
      if (selectedDelivery?.id === pendingDelete.id) {
        setSelectedDeliveryId(null);
      }
      setPendingDelete(null);
    } catch (err) {
      setDeleteError(
        err instanceof Error ? err.message : 'Could not delete the delivery. Nothing was changed.'
      );
    } finally {
      setIsDeleting(false);
    }
  };

  const deliveriesForDelete = pendingDelete
    ? vehicles.filter((v) => pendingDelete.assignedVehicleId === v.id)
    : [];

  return (
    <div className="deliveries-page">
      <div className="page-action-header">
        <div>
          <h2 className="section-title">
            <Package size={20} /> Manifest & Shipment Deliveries
          </h2>
          <p className="section-subtitle">
            Manage delivery locations, time windows, package weight, and volume constraints. Addresses
            are geocoded by the backend.
          </p>
        </div>
        <button className="btn btn-primary" onClick={openAdd}>
          <Plus size={16} /> Add Delivery Order
        </button>
      </div>

      {pendingFilter && (
        <p className="inline-banner" role="status">
          Filtered to <strong>{pendingFilter.value.replace('_', ' ')}</strong> from the dashboard.
        </p>
      )}

      <DeliveryTable
        deliveries={deliveries}
        onSelectDelivery={(delivery) => setSelectedDeliveryId(delivery.id)}
        onEditDelivery={openEdit}
        onDeleteDelivery={(delivery) => {
          setDeleteError(null);
          setPendingDelete(delivery);
        }}
        onAddDeliveryClick={openAdd}
        pendingFilter={pendingFilter}
      />

      <DeliveryDetailDrawer
        delivery={selectedDelivery}
        onClose={() => setSelectedDeliveryId(null)}
        onEdit={selectedDelivery ? () => openEdit(selectedDelivery) : undefined}
        onDelete={
          selectedDelivery
            ? () => {
                setDeleteError(null);
                setPendingDelete(selectedDelivery);
              }
            : undefined
        }
      />

      <DeliveryFormModal
        editing={editing}
        vehicles={vehicles}
        isOpen={isFormOpen}
        isSubmitting={isSubmitting}
        submitError={submitError}
        onSubmit={handleSubmit}
        onClose={closeForm}
      />

      <ConfirmDialog
        isOpen={Boolean(pendingDelete)}
        title="Delete this delivery?"
        description={
          pendingDelete
            ? `${pendingDelete.trackingNumber} — ${pendingDelete.recipientName} at ${pendingDelete.address} will be permanently removed from the manifest.`
            : ''
        }
        consequence={
          deliveriesForDelete.length > 0
            ? `This is the same record shown as assigned to ${deliveriesForDelete[0].id}. Route plans already generated by the optimizer are not stored, so they are unaffected.`
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