import React from 'react';

interface LoadingStateProps {
  message?: string;
  /** Announced to assistive tech; defaults to the visible message. */
  srMessage?: string;
}

/**
 * Loading state.
 *
 * Announces itself to screen readers and never leaves a bare spinner with no
 * explanation of what is being waited on.
 */
export const LoadingState: React.FC<LoadingStateProps> = ({
  message = 'Loading…',
  srMessage,
}) => {
  return (
    <div className="loading-state" role="status" aria-live="polite">
      <div className="spinner" aria-hidden="true" />
      <div className="loading-text">{message}</div>
      <span className="visually-hidden">{srMessage ?? message}</span>
    </div>
  );
};
