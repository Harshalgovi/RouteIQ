import React from 'react';
import type { Vehicle, Delivery } from '../types';
import { Truck, Navigation } from 'lucide-react';
import { formatApiClock } from '../utils/datetime';

interface RouteSummaryProps {
  vehicle: Vehicle;
  deliveries: Delivery[];
  totalDistanceKm: number;
  estDurationMinutes: number;
  onTrackRoute?: () => void;
}

export const RouteSummary: React.FC<RouteSummaryProps> = ({
  vehicle,
  deliveries,
  totalDistanceKm,
  estDurationMinutes,
  onTrackRoute,
}) => {
  const totalWeight = deliveries.reduce((acc, d) => acc + d.weightKg, 0);
  const weightUtilPercent = Math.min(100, Math.round((totalWeight / vehicle.capacityKg) * 100));

  return (
    <div className="card route-summary-card">
      <div className="summary-header">
        <div className="summary-title-area">
          <Truck size={18} className="summary-icon" />
          <div>
            <h4 className="summary-vehicle-name">{vehicle.name}</h4>
            <span className="font-mono text-subtext">{vehicle.id} • Driver: {vehicle.driver}</span>
          </div>
        </div>
        {onTrackRoute && (
          <button className="btn btn-secondary btn-sm" onClick={onTrackRoute}>
            <Navigation size={13} /> Focus Route
          </button>
        )}
      </div>

      <div className="summary-metrics-grid">
        <div className="sum-metric font-mono">
          <span className="sum-label">Stops</span>
          <span className="sum-val">{deliveries.length}</span>
        </div>
        <div className="sum-metric font-mono">
          <span className="sum-label">Distance</span>
          <span className="sum-val">{totalDistanceKm.toFixed(1)} km</span>
        </div>
        <div className="sum-metric font-mono">
          <span className="sum-label">Est Time</span>
          <span className="sum-val">{Math.floor(estDurationMinutes / 60)}h {estDurationMinutes % 60}m</span>
        </div>
        <div className="sum-metric font-mono">
          <span className="sum-label">Payload</span>
          <span className="sum-val">{totalWeight.toFixed(0)} / {vehicle.capacityKg} kg</span>
        </div>
      </div>

      <div className="progress-container" style={{ marginTop: '0.75rem' }}>
        <div className="progress-header">
          <span>Capacity Utilization</span>
          <span className="progress-percent font-mono">{weightUtilPercent}%</span>
        </div>
        <div className="progress-bar-bg">
          <div 
            className="progress-bar-fill" 
            style={{ 
              width: `${weightUtilPercent}%`, 
              backgroundColor: weightUtilPercent > 90 ? 'var(--status-warning)' : 'var(--accent-primary)' 
            }} 
          />
        </div>
      </div>

      <div className="summary-stops-list">
        <div className="stops-title">Delivery Sequence Stops:</div>
        {deliveries.slice(0, 4).map((d, index) => (
          <div key={d.id} className="stop-item">
            <span className="stop-index">{index + 1}</span>
            <div className="stop-info">
              <span className="stop-name">{d.recipientName}</span>
              <span className="stop-addr">{d.address}</span>
            </div>
            <span className="stop-time font-mono">{formatApiClock(d.timeWindowStart)}</span>
          </div>
        ))}
        {deliveries.length > 4 && (
          <div className="more-stops">+ {deliveries.length - 4} more stops on this route...</div>
        )}
      </div>
    </div>
  );
};
