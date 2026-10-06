import React from 'react';
import type { HealthStatus } from '../types';
import { CheckCircle2, AlertCircle } from 'lucide-react';

interface StatusCardProps {
  healthStatus: HealthStatus;
}

export const StatusCard: React.FC<StatusCardProps> = ({ healthStatus }) => {
  const isHealthy = healthStatus.status === 'ok';

  return (
    <div className="card" style={{ borderLeft: `4px solid ${isHealthy ? 'var(--status-success)' : 'var(--status-error)'}` }}>
      <div className="card-title">
        {isHealthy ? (
          <CheckCircle2 size={20} color="var(--status-success)" />
        ) : (
          <AlertCircle size={20} color="var(--status-error)" />
        )}
        <span>System Environment & Health Status</span>
      </div>
      <div className="card-subtitle">
        Real-time verification of backend API & database connection layer.
      </div>

      <div className="info-row">
        <span className="info-label">Product Name</span>
        <span className="info-value">{healthStatus.app}</span>
      </div>
      <div className="info-row">
        <span className="info-label">API Health Status</span>
        <span className="info-value" style={{ color: isHealthy ? 'var(--status-success)' : 'var(--status-error)' }}>
          {healthStatus.status.toUpperCase()}
        </span>
      </div>
      <div className="info-row">
        <span className="info-label">Database Connection</span>
        <span className="info-value">{healthStatus.database}</span>
      </div>
      <div className="info-row">
        <span className="info-label">Environment</span>
        <span className="info-value">{healthStatus.environment}</span>
      </div>
      <div className="info-row">
        <span className="info-label">Version</span>
        <span className="info-value">v{healthStatus.version}</span>
      </div>
      <div className="info-row">
        <span className="info-label">Last Health Ping</span>
        <span className="info-value">{healthStatus.lastChecked || 'N/A'}</span>
      </div>

      {healthStatus.error && (
        <div style={{ marginTop: '1rem', padding: '0.75rem', borderRadius: '6px', background: 'rgba(239, 68, 68, 0.1)', color: 'var(--status-error)', fontSize: '0.85rem' }}>
          <strong>Connection error:</strong> {healthStatus.error}
        </div>
      )}
    </div>
  );
};
