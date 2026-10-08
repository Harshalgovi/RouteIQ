import React, { useMemo } from 'react';
import { useFleet } from '../context/FleetContext';
import { useLastOptimization } from '../context/OptimizationContext';
import { AnalyticsMetric } from '../components/AnalyticsMetric';
import { RouteOptimizationImpact } from '../components/RouteOptimizationImpact';
import { FleetCapacity } from '../components/FleetCapacity';
import { RoutePerformance } from '../components/RoutePerformance';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import {
  BarChart3,
  Package,
  CheckCircle2,
  AlertTriangle,
  Inbox,
  Truck,
  Navigation,
  Clock,
  Info,
} from 'lucide-react';
import { apiTimestampMs } from '../utils/datetime';
import type { NavTab } from '../types';

interface AnalyticsPageProps {
  onNavigate: (tab: NavTab, filter?: string) => void;
}

/**
 * Analytics — answers four operator questions.
 *
 *   1. How is today going?          → Today's Operations KPI cards
 *   2. Did optimization help?       → Route Optimization Impact
 *   3. How full are the vehicles?   → Fleet Capacity
 *   4. Who is carrying the work?    → Route Performance
 *
 * Everything is computed from the vehicle and delivery records the backend
 * returns, or comes from a real optimization run. RouteIQ stores no delivery or
 * route history, so there is no trend chart, no week-over-week comparison and no
 * invented average delivery time — those tiles are shown as "Not available" with
 * the reason, because a plausible-looking trend from nothing is worse than a gap.
 */
export const AnalyticsPage: React.FC<AnalyticsPageProps> = ({ onNavigate }) => {
  const { vehicles, deliveries, summary, dataSource, loadState, loadError, refreshData } = useFleet();
  const { optimization } = useLastOptimization();

  const windowStats = useMemo(() => {
    const withWindows = deliveries.filter((d) => d.timeWindowEnd !== null);
    const now = Date.now();
    return {
      total: deliveries.length,
      constrained: withWindows.length,
      overdue: withWindows.filter(
        (d) => (apiTimestampMs(d.timeWindowEnd) ?? Infinity) < now
      ).length,
    };
  }, [deliveries]);

  const plannedDistanceKm = optimization?.summary.total_distance_km ?? null;

  if (loadState === 'loading' && vehicles.length === 0 && deliveries.length === 0) {
    return <LoadingState message="Loading delivery records…" />;
  }

  if (loadState === 'error' && vehicles.length === 0 && deliveries.length === 0) {
    return (
      <ErrorState
        title="Cannot load analytics"
        message={
          loadError ??
          'RouteIQ could not read deliveries or vehicles, so there is nothing to analyse.'
        }
        onRetry={refreshData}
      />
    );
  }

  const openWork = summary.deliveriesPending + summary.deliveriesAssigned + summary.deliveriesInTransit;

  return (
    <div className="analytics-page">
      {/* ── Page header ── */}
      <div className="page-action-header">
        <div>
          <h2 className="section-title">
            <BarChart3 size={20} aria-hidden="true" /> Analytics
          </h2>
          <p className="section-subtitle">
            Delivery performance from live records, and measured route optimization impact.
          </p>
        </div>
        {dataSource === 'mock' && (
          <span className="ops-summary-source">Development data — not connected</span>
        )}
      </div>

      {/* ── 1. Today's Operations KPI cards ── */}
      <section className="analytics-section" aria-labelledby="today-heading">
        <div className="analytics-section-head">
          <h3 id="today-heading" className="analytics-section-title">
            Today&rsquo;s Operations
          </h3>
          <p className="analytics-section-subtitle">
            Counts from the live database. Click any card to see the filtered list.
          </p>
        </div>

        <div className="analytics-metrics-grid">
          <AnalyticsMetric
            icon={Package}
            label="Deliveries today"
            value={summary.deliveriesToday}
            explanation={`Created today · ${summary.deliveriesTotal} total`}
            onClick={() => onNavigate('deliveries')}
            actionHint="Opens the deliveries list"
          />
          <AnalyticsMetric
            icon={CheckCircle2}
            label="Completed"
            value={summary.deliveriesDelivered}
            explanation="Successfully delivered"
            tone={summary.deliveriesDelivered > 0 ? 'success' : 'default'}
            onClick={() => onNavigate('deliveries', 'delivered')}
          />
          <AnalyticsMetric
            icon={AlertTriangle}
            label="Delayed"
            value={summary.deliveriesDelayed}
            explanation="Need attention now"
            tone={summary.deliveriesDelayed > 0 ? 'danger' : 'success'}
            onClick={() => onNavigate('deliveries', 'delayed')}
          />
          <AnalyticsMetric
            icon={Inbox}
            label="Open work"
            value={openWork}
            explanation="Pending, assigned, or in transit"
          />
          <AnalyticsMetric
            icon={Navigation}
            label="Not on a vehicle"
            value={summary.deliveriesUnassigned}
            explanation="Unassigned open deliveries"
            tone={summary.deliveriesUnassigned > 0 ? 'warning' : 'success'}
            onClick={() => onNavigate('planner')}
            actionHint="Opens Route Planner"
          />
          <AnalyticsMetric
            icon={Truck}
            label="Active vehicles"
            value={summary.vehiclesDispatchable}
            explanation="Available or active status"
            onClick={() => onNavigate('vehicles', 'dispatchable')}
          />
          <AnalyticsMetric
            icon={Navigation}
            label="Total route distance"
            value={plannedDistanceKm !== null ? `${plannedDistanceKm.toFixed(1)} km` : null}
            unavailableLabel="Not available"
            unavailableReason="Run Route Planner to generate a plan."
            explanation={
              plannedDistanceKm !== null
                ? 'Distance of the last optimization plan, on real roads.'
                : 'Real driving distance for the last optimization plan.'
            }
            onClick={() => onNavigate('planner')}
          />
          <AnalyticsMetric
            icon={Clock}
            label="Average delivery time"
            value={null}
            unavailableLabel="Not available"
            unavailableReason="Requires completed delivery history."
            explanation="Time from dispatch to completion, averaged across deliveries."
          />
        </div>
      </section>

      {/* ── 2. Optimization impact ── */}
      <section className="analytics-section" aria-labelledby="impact-section-heading">
        <div className="analytics-section-head">
          <h3 id="impact-section-heading" className="analytics-section-title">
            Route Optimization Impact
          </h3>
          <p className="analytics-section-subtitle">
            Answers &ldquo;did RouteIQ actually improve my routes?&rdquo; using a measured baseline.
          </p>
        </div>
        <RouteOptimizationImpact
          optimization={optimization}
          onOpenPlanner={() => onNavigate('planner')}
        />
      </section>

      {/* ── 3 + 4. Capacity and per-vehicle performance ── */}
      <section className="analytics-section" aria-labelledby="efficiency-heading">
        <div className="analytics-section-head">
          <h3 id="efficiency-heading" className="analytics-section-title">
            Are vehicles being used efficiently?
          </h3>
          <p className="analytics-section-subtitle">
            Real load per vehicle against rated capacity, and who is carrying the work.
          </p>
        </div>

        <div className="analytics-split">
          <FleetCapacity vehicles={vehicles} deliveries={deliveries} groupByType />
          <RoutePerformance
            vehicles={vehicles}
            deliveries={deliveries}
            optimization={optimization}
          />
        </div>
      </section>

      {/* ── 5. What cannot be shown, stated plainly ── */}
      <section className="card analytics-limits" aria-labelledby="limits-heading">
        <div className="card-header-flex">
          <div>
            <h3 className="card-title-text" id="limits-heading">
              <Info size={16} aria-hidden="true" /> Not Yet Available
            </h3>
            <p className="card-subtitle-text">
              Listed so it is clear these are gaps in stored data, not missing analysis.
            </p>
          </div>
        </div>
        <ul className="limits-list">
          <li>
            <strong>Route distance — last 7 days.</strong> RouteIQ does not store completed route
            history, so there is no daily distance series to chart. A single plan&rsquo;s distance is
            shown above once you run the planner.
          </li>
          <li>
            <strong>Average delivery time.</strong> Requires a completion timestamp per delivery.
            Only the status is stored today.
          </li>
          <li>
            <strong>Cost or fuel savings.</strong> RouteIQ has no fuel price, driver rate or vehicle
            cost data, so it will not convert distance into money.
          </li>
          <li>
            <strong>On-time percentage.</strong> {windowStats.constrained} of {windowStats.total}{' '}
            deliveries have a closing time window
            {windowStats.overdue > 0 && `, and ${windowStats.overdue} of those windows have already passed`}
            . A meaningful on-time rate also needs completion times.
          </li>
          <li>
            <strong>Historical optimization impact.</strong> The comparison above covers the last
            run in this session only; RouteIQ does not persist past plans.
          </li>
        </ul>
      </section>
    </div>
  );
};
