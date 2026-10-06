import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
}

/**
 * Error state for a failed request.
 *
 * Distinct from `EmptyState` on purpose: "the request failed" and "there is no
 * data" are different situations and must never look the same to an operator.
 */
export const ErrorState: React.FC<ErrorStateProps> = ({
  title = 'Could not load this data',
  message,
  onRetry,
}) => {
  return (
    <div className="error-state" role="alert">
      <AlertTriangle className="error-icon" size={22} aria-hidden="true" />
      <div className="error-content">
        <h4>{title}</h4>
        <p>{message}</p>
      </div>
      {onRetry && (
        <button type="button" className="btn btn-secondary" onClick={onRetry}>
          <RefreshCw size={14} aria-hidden="true" /> Retry
        </button>
      )}
    </div>
  );
};
