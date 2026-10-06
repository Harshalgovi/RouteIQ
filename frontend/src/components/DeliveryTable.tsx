import React, { useState } from 'react';
import type { Delivery } from '../types';
import { StatusBadge } from './StatusBadge';
import { Search, Filter, Eye, Clock, Weight, MapPin, Package, Pencil, Trash2 } from 'lucide-react';
import { formatWindow } from '../utils/timeWindow';

/** A filter requested by another page, e.g. "delayed" or "pending". */
export interface PendingTableFilter {
  value: string;
  nonce: number;
}

interface DeliveryTableProps {
  deliveries: Delivery[];
  onSelectDelivery: (delivery: Delivery) => void;
  onAddDeliveryClick?: () => void;
  /** Open the edit form for a delivery. Omit to hide the edit action. */
  onEditDelivery?: (delivery: Delivery) => void;
  /** Ask for confirmation before removing a delivery. Omit to hide the action. */
  onDeleteDelivery?: (delivery: Delivery) => void;
  /** Status to filter by when arriving from a dashboard count or alert. */
  pendingFilter?: PendingTableFilter | null;
}

export const DeliveryTable: React.FC<DeliveryTableProps> = ({
  deliveries,
  onSelectDelivery,
  onAddDeliveryClick,
  onEditDelivery,
  onDeleteDelivery,
  pendingFilter,
}) => {
  // Manual filters live in state; a dashboard request arrives as new props.
  // `nonce` records which request the manual values belong to, so a new request
  // takes effect once and the user's own edits then take over again. Deriving
  // this during render avoids an extra pass and keeps the row set consistent.
  const [manualFilters, setManualFilters] = useState({
    nonce: -1,
    searchTerm: '',
    statusFilter: 'all',
    priorityFilter: 'all',
  });

  const effective =
    pendingFilter && pendingFilter.nonce !== manualFilters.nonce
      ? { searchTerm: '', statusFilter: pendingFilter.value, priorityFilter: 'all' }
      : manualFilters;

  const claimFilterChange = (
    patch: Partial<{ searchTerm: string; statusFilter: string; priorityFilter: string }>
  ) => {
    const status = patch.statusFilter ?? effective.statusFilter;
    // Switching status resets the priority filter so a combination that matches
    // nothing cannot silently hide every row.
    setManualFilters({
      nonce: pendingFilter?.nonce ?? -1,
      searchTerm: patch.searchTerm ?? '',
      statusFilter: status,
      priorityFilter: patch.priorityFilter ?? (patch.statusFilter ? 'all' : effective.priorityFilter),
    });
  };

  const filteredDeliveries = deliveries.filter(d => {
    const needle = effective.searchTerm.trim().toLowerCase();
    const matchesSearch =
      needle === '' ||
      d.trackingNumber.toLowerCase().includes(needle) ||
      d.recipientName.toLowerCase().includes(needle) ||
      d.address.toLowerCase().includes(needle);

    const matchesStatus =
      effective.statusFilter === 'all' || d.status === effective.statusFilter;
    const matchesPriority =
      effective.priorityFilter === 'all' || d.priority === effective.priorityFilter;

    return matchesSearch && matchesStatus && matchesPriority;
  });

  return (
    <div className="delivery-table-card card">
      {/* Table Filter Toolbar */}
      <div className="table-toolbar">
        <div className="table-search">
          <Search size={15} aria-hidden="true" />
          <label className="visually-hidden" htmlFor="delivery-search">
            Search deliveries
          </label>
          <input
            id="delivery-search"
            type="text"
            placeholder="Filter deliveries by tracking #, recipient, or address..."
            value={effective.searchTerm}
            onChange={(e) => claimFilterChange({ searchTerm: e.target.value })}
          />
        </div>

        <div className="table-filters">
          <div className="filter-select-wrapper">
            <Filter size={14} className="filter-icon" aria-hidden="true" />
            <label className="visually-hidden" htmlFor="delivery-status-filter">
              Delivery status
            </label>
            <select
              id="delivery-status-filter"
              value={effective.statusFilter}
              onChange={(e) => claimFilterChange({ statusFilter: e.target.value })}
              className="table-select"
            >
              <option value="all">All Statuses</option>
              <option value="pending">Pending</option>
              <option value="assigned">Assigned</option>
              <option value="in_transit">In Transit</option>
              <option value="delivered">Delivered</option>
              <option value="delayed">Delayed</option>
              <option value="cancelled">Cancelled</option>
              <option value="failed">Failed</option>
            </select>
          </div>

          <div className="filter-select-wrapper">
            <label className="visually-hidden" htmlFor="delivery-priority-filter">
              Priority
            </label>
            <select
              id="delivery-priority-filter"
              value={effective.priorityFilter}
              onChange={(e) => claimFilterChange({ priorityFilter: e.target.value })}
              className="table-select"
            >
              <option value="all">All Priorities</option>
              <option value="urgent">Urgent</option>
              <option value="high">High</option>
              <option value="normal">Normal</option>
              <option value="low">Low</option>
            </select>
          </div>

          {onAddDeliveryClick && (
            <button className="btn btn-primary btn-sm" onClick={onAddDeliveryClick}>
              + Add Delivery
            </button>
          )}
        </div>
      </div>

      {/* Main Data Table */}
      <div className="table-responsive">
        <table className="data-table">
          <thead>
            <tr>
              <th>Tracking #</th>
              <th>Recipient</th>
              <th>Destination Address</th>
              <th>Status</th>
              <th>Priority</th>
              <th>Time Window</th>
              <th>Weight / Vol</th>
              <th>Assigned Fleet</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredDeliveries.length === 0 ? (
              <tr>
                <td colSpan={9} style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-muted)' }}>
                  <Package size={28} style={{ margin: '0 auto 0.5rem', opacity: 0.5 }} />
                  <div>No deliveries found matching the specified criteria.</div>
                </td>
              </tr>
            ) : (
              filteredDeliveries.map(delivery => (
                <tr 
                  key={delivery.id} 
                  className="table-row hoverable"
                  onClick={() => onSelectDelivery(delivery)}
                >
                  <td className="font-mono" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                    {delivery.trackingNumber}
                  </td>
                  <td>
                    <div style={{ fontWeight: 500 }}>{delivery.recipientName}</div>
                    <div className="table-subtext">{delivery.phone}</div>
                  </td>
                  <td className="table-address-cell">
                    <div className="text-truncate">
                      <MapPin size={12} style={{ display: 'inline', marginRight: '4px', color: 'var(--text-muted)' }} />
                      {delivery.address}
                    </div>
                    <div className="table-subtext">
                      Added {formatWindow(delivery.createdAt, null, '')}
                    </div>
                  </td>
                  <td>
                    <StatusBadge status={delivery.status} size="sm" />
                  </td>
                  <td>
                    <StatusBadge priority={delivery.priority} size="sm" />
                  </td>
                  <td className="table-window-cell">
                    <Clock size={12} style={{ display: 'inline', marginRight: '4px' }} />
                    {delivery.timeWindowStart || delivery.timeWindowEnd
                      ? formatWindow(delivery.timeWindowStart, delivery.timeWindowEnd)
                      : 'No window'}
                  </td>
                  <td className="font-mono table-subtext">
                    <Weight size={12} style={{ display: 'inline', marginRight: '4px' }} />
                    {delivery.weightKg} kg / {delivery.volumeM3} m³
                  </td>
                  <td>
                    {delivery.assignedVehicleId ? (
                      <span className="badge-assigned font-mono">{delivery.assignedVehicleId}</span>
                    ) : (
                      <span className="badge-unassigned">Unassigned</span>
                    )}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <div className="row-actions">
                      <button
                        className="btn-icon"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectDelivery(delivery);
                        }}
                        title="View delivery details"
                        aria-label={`View ${delivery.trackingNumber}`}
                      >
                        <Eye size={15} />
                      </button>
                      {onEditDelivery && (
                        <button
                          className="btn-icon"
                          onClick={(e) => {
                            e.stopPropagation();
                            onEditDelivery(delivery);
                          }}
                          title="Edit delivery"
                          aria-label={`Edit ${delivery.trackingNumber}`}
                        >
                          <Pencil size={15} />
                        </button>
                      )}
                      {onDeleteDelivery && (
                        <button
                          className="btn-icon danger"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteDelivery(delivery);
                          }}
                          title="Delete delivery"
                          aria-label={`Delete ${delivery.trackingNumber}`}
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="table-footer">
        Showing {filteredDeliveries.length} of {deliveries.length} total deliveries
      </div>
    </div>
  );
};
