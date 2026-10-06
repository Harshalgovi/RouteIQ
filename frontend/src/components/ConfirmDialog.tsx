import React from 'react';
import { AlertTriangle, Loader2, X } from 'lucide-react';

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  /** What exactly is about to be removed, phrased for the operator. */
  description: string;
  /** Extra warning, e.g. what else will change. Omit when not relevant. */
  consequence?: string;
  confirmLabel?: string;
  isWorking: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Confirmation step before a destructive action.
 *
 * Deletes here are real API calls, so the dialog states plainly what will be
 * removed instead of asking a bare "are you sure?".
 */
export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  title,
  description,
  consequence,
  confirmLabel = 'Delete',
  isWorking,
  error,
  onConfirm,
  onCancel,
}) => {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay" role="presentation" onClick={onCancel}>
      <div
        className="modal-container confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div className="modal-title-area">
            <AlertTriangle size={20} className="modal-icon" style={{ color: 'var(--warning)' }} />
            <div>
              <h3 id="confirm-dialog-title">{title}</h3>
            </div>
          </div>
          <button className="modal-close-btn" onClick={onCancel} aria-label="Close dialog" disabled={isWorking}>
            <X size={18} />
          </button>
        </div>

        <div className="confirm-dialog-body">
          <p>{description}</p>
          {consequence && <p className="confirm-dialog-note">{consequence}</p>}
          {error && (
            <p className="map-notice error" role="alert">
              {error}
            </p>
          )}
        </div>

        <div className="modal-footer" style={{ padding: 0 }}>
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={isWorking}>
            Cancel
          </button>
          <button type="button" className="btn btn-danger" onClick={onConfirm} disabled={isWorking}>
            {isWorking ? <Loader2 size={14} className="spin" /> : <AlertTriangle size={14} />}
            {isWorking ? 'Deleting…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};