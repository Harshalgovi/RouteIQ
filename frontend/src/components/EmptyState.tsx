import React from 'react';

interface EmptyStateProps {
  icon?: React.ComponentType<{ size?: number | string; className?: string }>;
  title: string;
  description: string;
  primaryActionLabel?: string;
  onPrimaryAction?: () => void;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
  /** Optional inline content, e.g. a vehicle picker, rendered under the copy. */
  children?: React.ReactNode;
  /** A single call-to-action, rendered as a button. */
  action?: React.ReactNode;
  tone?: 'default' | 'warning' | 'danger';
}

/**
 * Honest empty state.
 *
 * Always says what is missing and what to do about it. Never used to paper over
 * a failed request — that is `ErrorState`.
 */
export const EmptyState: React.FC<EmptyStateProps> = ({
  icon: Icon,
  title,
  description,
  primaryActionLabel,
  onPrimaryAction,
  secondaryActionLabel,
  onSecondaryAction,
  children,
  action,
  tone = 'default',
}) => {
  return (
    <div className={`empty-state-container empty-tone-${tone}`}>
      {Icon && (
        <div className="empty-state-icon" aria-hidden="true">
          <Icon size={30} />
        </div>
      )}
      <h3 className="empty-state-title">{title}</h3>
      <p className="empty-state-desc">{description}</p>

      {children}

      {action && <div className="empty-state-actions">{action}</div>}

      {(primaryActionLabel || secondaryActionLabel) && (
        <div className="empty-state-actions">
          {primaryActionLabel && onPrimaryAction && (
            <button type="button" className="btn btn-primary" onClick={onPrimaryAction}>
              {primaryActionLabel}
            </button>
          )}
          {secondaryActionLabel && onSecondaryAction && (
            <button type="button" className="btn btn-secondary" onClick={onSecondaryAction}>
              {secondaryActionLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

/**
 * Shown when a dataset exists but has not been collected yet.
 *
 * Used for anything that would require historical records RouteIQ does not
 * store. It never substitutes a trend line or an average — an invented trend is
 * harder to notice than an honest gap.
 */
export const NoHistoryState: React.FC<{
  icon?: React.ComponentType<{ size?: number | string; className?: string }>;
  what: string;
  action?: { label: string; onClick: () => void };
}> = ({ icon: Icon, what, action }) => (
  <EmptyState
    icon={Icon}
    title="Not enough route history yet"
    description={`RouteIQ will show ${what} once it has collected real delivery and route records. Nothing is estimated in the meantime.`}
    primaryActionLabel={action?.label}
    onPrimaryAction={action?.onClick}
  />
);
