import React from 'react';
import type { VehicleStatus, DeliveryStatus, DeliveryPriority } from '../types';
import { describeStatus, describePriority, toneClass } from '../utils/status';

interface StatusBadgeProps {
  status?: VehicleStatus | DeliveryStatus;
  priority?: DeliveryPriority;
  /** Overrides the vocabulary label, e.g. to show a raw backend value. */
  label?: string;
  size?: 'sm' | 'md';
}

/**
 * Status pill.
 *
 * Always renders a dot *and* a text label: the badge is never communicated by
 * colour alone. `title` carries the operational meaning so an unfamiliar status
 * can be understood without leaving the screen.
 */
export const StatusBadge: React.FC<StatusBadgeProps> = ({
  status,
  priority,
  label,
  size = 'md',
}) => {
  const descriptor = status ? describeStatus(status) : priority ? describePriority(priority) : null;

  if (!descriptor) {
    return <span className="status-badge badge-muted">No status</span>;
  }

  const displayLabel = label ?? descriptor.label;

  return (
    <span
      className={`status-badge badge-${size} ${toneClass(descriptor.tone)}`}
      title={`${displayLabel} — ${descriptor.meaning}`}
    >
      <span className="badge-dot" aria-hidden="true" />
      <span>{displayLabel}</span>
    </span>
  );
};
