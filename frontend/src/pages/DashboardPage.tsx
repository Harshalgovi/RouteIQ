import React, { useCallback } from 'react';
import { useFleet } from '../context/FleetContext';
import { useLastOptimization } from '../context/OptimizationContext';
import { OperationsSummary } from '../components/OperationsSummary';
import { LiveFleetMap } from '../components/LiveFleetMap';
import { ActiveRoutes } from '../components/ActiveRoutes';
import { DelayAlerts } from '../components/DelayAlerts';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import { Activity, AlertTriangle, Package } from 'lucide-react';
import { parseApiDate } from '../utils/datetime';
import type { NavTab } from '../types';

interface DashboardPageProps {
  onNavigate: (tab: NavTab, filter?: string) => void;
}

const relativeTime = (iso: string): string => {
  const value = parseApiDate(iso);
  if (!value) return 'unknown time';
  const seconds = Math.round((Date.now() - value.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return value.toLocaleDateString();
};

/**
 * Dashboard — the operational home.
 *
 * Reading order answers, in this sequence:
 *   1. What is happening right now?   → Today's Operations
 *   2. Where are my vehicles?          → Live Fleet map
 *   3. What needs my attention?       → Delay Alerts
 *   4. What is the work?              → Active Routes
 *
 * The map is the largest element on the page by design. Everything above or
 * below it is either a count with a stated meaning or a list of specific things
 * that need a decision.
 */
export const DashboardPage: React.FC<DashboardPageProps> = ({ onNavigate }) => {
  const {
    vehicles,
    deliveries,
    activities,
    summary,
    trackedVehicles,
    selectedVehicleId,
    setSelectedVehicleId,
    setSelectedDeliveryId,
    dataSource,
    loadState,
    loadError,
    refreshData,
  } = useFleet();
  const { optimization } = useLastOptimization();

  const focusVehicle = useCallback(
    (vehicleId: string) => {
      const match =
        vehicles.find((v) => v.id === vehicleId) ??
        vehicles.find((v) => `V-${v._backendId}` === vehicleId);
      if (match) setSelectedVehicleId(match.id);
      onNavigate('tracking');
    },
    [vehicles, setSelectedVehicleId, onNavigate]
  );

  const viewDelivery = useCallback(
    (deliveryId: string) => {
      setSelectedDeliveryId(deliveryId);
      onNavigate('deliveries');
    },
    [setSelectedDeliveryId, onNavigate]
  );

  if (loadState === 'loading' && vehicles.length === 0) {
    return <LoadingState message="Loading fleet and deliveries from the backend…" />;
  }

  if (loadState === 'error' && vehicles.length === 0) {
    return (
      <ErrorState
        title="Cannot reach the backend"
        message={
          loadError ??
          'RouteIQ could not load vehicles and deliveries. Start the API server and retry.'
        }
        onRetry={refreshData}
      />
    );
  }

  return (
    <div className="dashboard-page">
      {loadState === 'error' && (
        <div className="inline-banner is-warning" role="status">
          <AlertTriangle size={14} aria-hidden="true" />
          <span>
            Showing development data — the backend is unreachable, so nothing below reflects live
            records.{loadError ? ` (${loadError})` : ''}
          </span>
          <button type="button" className="btn btn-ghost btn-xs" onClick={refreshData}>
            Retry
          </button>
        </div>
      )}

      <OperationsSummary
        summary={summary}
        isLive={dataSource === 'backend'}
        isLoading={loadState === 'loading'}
        onNavigate={onNavigate}
      />

      <LiveFleetMap
        deliveries={deliveries}
        height="clamp(380px, 52vh, 620px)"
        onNavigateToVehicles={() => onNavigate('vehicles')}
        onNavigateToTracking={() => onNavigate('tracking')}
      />

      <div className="dashboard-panels">
        <ActiveRoutes
          vehicles={vehicles}
          deliveries={deliveries}
          optimization={optimization}
          onFocusVehicle={focusVehicle}
        />
        <DelayAlerts deliveries={deliveries} vehicles={vehicles} onViewDelivery={viewDelivery} />
      </div>

      <div className="dashboard-secondary">
        <section className="card activity-stream-card" aria-labelledby="activity-heading">
          <div className="card-header-flex">
            <div>
              <h3 className="card-title-text" id="activity-heading">
                <Activity size={16} aria-hidden="true" /> Your Actions This Session
              </h3>
              <p className="card-subtitle-text">
                Changes you made in RouteIQ. RouteIQ does not keep an audit log of driver activity.
              </p>
            </div>
          </div>

          {activities.length === 0 ? (
            <p className="activity-empty">
              No actions yet this session. Tracking a vehicle or creating a delivery will appear
              here.
            </p>
          ) : (
            <ul className="activity-list">
              {activities.slice(0, 6).map((entry) => (
                <li key={entry.id} className="activity-item">
                  <span className="activity-icon-bullet" aria-hidden="true" />
                  <div className="activity-content">
                    <span className="activity-title">{entry.title}</span>
                    <span className="activity-desc">{entry.description}</span>
                    <span className="activity-time">{relativeTime(entry.timestamp)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card" aria-labelledby="quick-heading">
          <div className="card-header-flex">
            <div>
              <h3 className="card-title-text" id="quick-heading">
                <Package size={16} aria-hidden="true" /> Where To Next
              </h3>
              <p className="card-subtitle-text">Common follow-ups from the numbers above.</p>
            </div>
          </div>
          <div className="quick-actions">
            {summary.deliveriesUnassigned > 0 && (
              <button
                type="button"
                className="quick-action"
                onClick={() => onNavigate('planner')}
              >
                <span className="quick-action-title">
                  Plan a route for {summary.deliveriesUnassigned} unassigned deliver
                  {summary.deliveriesUnassigned === 1 ? 'y' : 'ies'}
                </span>
                <span className="quick-action-desc">
                  The solver needs vehicles with an available or active status.
                </span>
              </button>
            )}
            {summary.vehiclesTracked === 0 && summary.vehiclesTotal > 0 && (
              <button
                type="button"
                className="quick-action"
                onClick={() => onNavigate('tracking')}
              >
                <span className="quick-action-title">Start tracking a vehicle</span>
                <span className="quick-action-desc">
                  Nothing is on the map until a vehicle is tracked and reports a position.
                </span>
              </button>
            )}
            {summary.vehiclesWithoutDriver > 0 && (
              <button
                type="button"
                className="quick-action"
                onClick={() => onNavigate('vehicles', 'no-driver')}
              >
                <span className="quick-action-title">
                  Assign {summary.vehiclesWithoutDriver} driver
                  {summary.vehiclesWithoutDriver === 1 ? '' : 's'}
                </span>
                <span className="quick-action-desc">
                  A vehicle without a driver can still be planned, but nobody is assigned to drive it.
                </span>
              </button>
            )}
            {summary.deliveriesPending > 0 && (
              <button
                type="button"
                className="quick-action"
                onClick={() => onNavigate('deliveries', 'pending')}
              >
                <span className="quick-action-title">
                  Review {summary.deliveriesPending} pending deliver
                  {summary.deliveriesPending === 1 ? 'y' : 'ies'}
                </span>
                <span className="quick-action-desc">
                  Check addresses are geocoded before planning.
                </span>
              </button>
            )}
            {summary.deliveriesUnassigned === 0 &&
              summary.vehiclesTracked > 0 &&
              summary.vehiclesWithoutDriver === 0 &&
              summary.deliveriesPending === 0 && (
                <p className="activity-empty">
                  Nothing outstanding. {trackedVehicles.length} vehicle
                  {trackedVehicles.length === 1 ? '' : 's'} tracked
                  {selectedVehicleId ? `, ${selectedVehicleId} selected` : ''}.
                </p>
              )}
          </div>
        </section>
      </div>
    </div>
  );
};
