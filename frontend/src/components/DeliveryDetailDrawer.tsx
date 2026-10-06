import React from 'react';
import type { Delivery, DeliveryStatus } from '../types';
import { StatusBadge } from './StatusBadge';
import {
  X,
  Package,
  MapPin,
  Clock,
  Weight,
  Phone,
  Truck,
  CheckCircle2,
  AlertCircle,
  Info,
  Pencil,
  Trash2,
} from 'lucide-react';
import { useFleet } from '../context/FleetContext';
import { findVehicleByAnyId } from '../utils/assignment';
import { formatHumanDate, formatWindow } from '../utils/timeWindow';

interface DeliveryDetailDrawerProps {
  delivery: Delivery | null;
  onClose: () => void;
  /** Open the edit form. Omit when the caller does not support editing. */
  onEdit?: () => void;
  /** Ask for confirmation before deleting. Omit when not supported. */
  onDelete?: () => void;
}

export const DeliveryDetailDrawer: React.FC<DeliveryDetailDrawerProps> = ({
  delivery,
  onClose,
  onEdit,
  onDelete,
}) => {
  const { updateDeliveryStatus, vehicles } = useFleet();

  if (!delivery) return null;

  const assignedVehicle = findVehicleByAnyId(vehicles, delivery.assignedVehicleId);

  const handleStatusChange = (newStatus: DeliveryStatus) => {
    updateDeliveryStatus(delivery.id, newStatus);
  };

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer-container" onClick={e => e.stopPropagation()}>
        <div className="drawer-header">
          <div className="drawer-title-area">
            <Package size={20} className="drawer-icon" />
            <div>
              <h3>Delivery Details</h3>
              <span className="font-mono">{delivery.trackingNumber}</span>
            </div>
          </div>
          <button className="drawer-close-btn" onClick={onClose} aria-label="Close drawer">
            <X size={18} />
          </button>
        </div>

        {/*
          Record management actions. They operate on the whole record, so they sit
          above the fold rather than being buried at the end of the detail list.
        */}
        {(onEdit || onDelete) && (
          <div className="drawer-actions-bar">
            {onEdit && (
              <button className="btn btn-secondary btn-sm" onClick={onEdit}>
                <Pencil size={13} /> Edit Delivery
              </button>
            )}
            {onDelete && (
              <button className="btn btn-danger btn-sm" onClick={onDelete}>
                <Trash2 size={13} /> Delete
              </button>
            )}
          </div>
        )}

        <div className="drawer-body">
          <div className="drawer-status-bar">
            <StatusBadge status={delivery.status} />
            <StatusBadge priority={delivery.priority} />
          </div>

          <div className="drawer-section">
            <h4 className="drawer-section-title">Recipient & Destination</h4>
            <div className="drawer-info-grid">
              <div className="info-item">
                <span className="info-item-label">Recipient Name</span>
                <span className="info-item-value">{delivery.recipientName}</span>
              </div>
              <div className="info-item">
                <span className="info-item-label">Contact Phone</span>
                <span className="info-item-value">
                  <Phone size={12} style={{ display: 'inline', marginRight: '4px' }} />
                  {delivery.phone}
                </span>
              </div>
              <div className="info-item full-width">
                <span className="info-item-label">Destination Address</span>
                <span className="info-item-value">
                  <MapPin size={12} style={{ display: 'inline', marginRight: '4px' }} />
                  {delivery.address}
                </span>
              </div>
            </div>
          </div>

          <div className="drawer-section">
            <h4 className="drawer-section-title">Shipment Parameters</h4>
            <div className="drawer-info-grid">
              <div className="info-item">
                <span className="info-item-label">Delivery Window</span>
                <span className="info-item-value">
                  <Clock size={12} style={{ display: 'inline', marginRight: '4px' }} />
                  {formatWindow(delivery.timeWindowStart, delivery.timeWindowEnd, 'No window set')}
                </span>
              </div>
              <div className="info-item">
                <span className="info-item-label">Created</span>
                <span className="info-item-value">
                  {formatHumanDate(delivery.createdAt, 'Unknown')}
                </span>
              </div>
              <div className="info-item">
                <span className="info-item-label">Package Weight</span>
                <span className="info-item-value font-mono">
                  <Weight size={12} style={{ display: 'inline', marginRight: '4px' }} />
                  {delivery.weightKg} kg
                </span>
              </div>
              <div className="info-item">
                <span className="info-item-label">Cubic Volume</span>
                <span className="info-item-value font-mono">{delivery.volumeM3} m³</span>
              </div>
              </div>
            <p className="drawer-note">
              <Info size={13} aria-hidden="true" />
              RouteIQ does not forecast an arrival time for a delivery. Run the Route Planner to get
              a plan with real travel times.
            </p>
          </div>

          <div className="drawer-section">
            <h4 className="drawer-section-title">Assigned Fleet Vehicle</h4>
            {assignedVehicle ? (
              <div className="assigned-vehicle-card">
                <Truck size={20} />
                <div>
                  <div style={{ fontWeight: 600 }}>{assignedVehicle.name} ({assignedVehicle.id})</div>
                  <div className="table-subtext">
                    Driver: {assignedVehicle.driver ?? 'Not assigned'}
                    {assignedVehicle.driverPhone ? ` • ${assignedVehicle.driverPhone}` : ''}
                  </div>
                </div>
              </div>
            ) : (
              <div className="unassigned-notice">
                <AlertCircle size={16} />
                <span>Not currently assigned to any route. Run Route Planner to allocate.</span>
              </div>
            )}
          </div>

          {delivery.notes && (
            <div className="drawer-section">
              <h4 className="drawer-section-title">Dispatcher Instructions</h4>
              <p className="drawer-notes">{delivery.notes}</p>
            </div>
          )}

          <div className="drawer-section">
            <h4 className="drawer-section-title">Update Delivery Status</h4>
            <div className="status-update-buttons">
              <button 
                className={`btn btn-sm ${delivery.status === 'in_transit' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => handleStatusChange('in_transit')}
              >
                In Transit
              </button>
              <button 
                className={`btn btn-sm ${delivery.status === 'delivered' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => handleStatusChange('delivered')}
              >
                <CheckCircle2 size={13} /> Mark Delivered
              </button>
              <button 
                className={`btn btn-sm ${delivery.status === 'delayed' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => handleStatusChange('delayed')}
              >
                Mark Delayed
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
