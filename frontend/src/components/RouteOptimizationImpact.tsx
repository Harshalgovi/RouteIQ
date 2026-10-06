import React from 'react';
import type { OptimizationResult } from '../types';
import { EmptyState } from './EmptyState';
import { TrendingDown, Route as RouteIcon, Clock, AlertTriangle } from 'lucide-react';

interface RouteOptimizationImpactProps {
  /** Last result from the real optimizer, if the planner has been run. */
  optimization: OptimizationResult | null;
  onOpenPlanner: () => void;
}

/**
 * Route optimization impact.
 *
 * Every figure here comes from the optimizer's own `baseline` comparison, which
 * measures the same deliveries in database order against the solved plan on the
 * same live travel matrix. Nothing is modelled or assumed.
 *
* Notably absent: a money figure. RouteIQ has no fuel price, rate card or cost
 * model, so it cannot state a cost saving and does not pretend to. Converting a
 * distance number into "you saved this much money" is the single most misleading
 * thing a logistics dashboard can do.
 */
export const RouteOptimizationImpact: React.FC<RouteOptimizationImpactProps> = ({
  optimization,
  onOpenPlanner,
}) => {
  const baseline = optimization?.baseline ?? null;

  if (!baseline) {
    return (
      <section className="card impact-card" aria-labelledby="impact-heading">
        <h3 className="card-title-text" id="impact-heading">
          <RouteIcon size={16} aria-hidden="true" /> Route Optimization Impact
        </h3>
        <EmptyState
          icon={RouteIcon}
          title="Optimization savings will appear after a baseline route is available"
          description="Run the Route Planner. RouteIQ compares your plan against the same deliveries in their existing order, measured on the same live road network, and reports the real difference."
          primaryActionLabel="Open Route Planner"
          onPrimaryAction={onOpenPlanner}
        />
      </section>
    );
  }

  const savedKm = baseline.distance_saved_km;
  const savedMinutes = baseline.duration_saved_minutes;
  const isPartial = optimization?.status === 'partial';

  return (
    <section className="card impact-card" aria-labelledby="impact-heading">
      <div className="card-header-flex">
        <div>
          <h3 className="card-title-text" id="impact-heading">
            <TrendingDown size={16} aria-hidden="true" /> Route Optimization Impact
          </h3>
          <p className="card-subtitle-text">
            {baseline.baseline.label} vs the optimized plan, on the same live road network.
          </p>
        </div>
      </div>

      {isPartial && (
        <p className="impact-warning">
          <AlertTriangle size={13} aria-hidden="true" /> This was a partial plan —{' '}
          {optimization?.summary.deliveries_unassigned} deliver
          {optimization?.summary.deliveries_unassigned === 1 ? 'y was' : 'ies were'} left unassigned,
          so the comparison covers a smaller set of work than a full plan.
        </p>
      )}

      <div className="impact-comparison">
        <div className="impact-side">
          <span className="impact-side-label">Before optimization</span>
          <span className="impact-side-value">{baseline.baseline.distance_km.toFixed(1)} km</span>
          <span className="impact-side-note">
            {baseline.baseline.duration_minutes.toFixed(0)} min driving ·{' '}
            {baseline.baseline.vehicles_used} vehicle
            {baseline.baseline.vehicles_used === 1 ? '' : 's'}
          </span>
        </div>

        <div className="impact-divider" aria-hidden="true" />

        <div className="impact-side is-after">
          <span className="impact-side-label">After optimization</span>
          <span className="impact-side-value">
            {baseline.optimized_distance_km.toFixed(1)} km
          </span>
          <span className="impact-side-note">
            {baseline.optimized_duration_minutes.toFixed(0)} min driving ·{' '}
            {optimization?.summary.vehicles_used} vehicle
            {optimization?.summary.vehicles_used === 1 ? '' : 's'}
          </span>
        </div>
      </div>

      <div className="impact-savings">
        <div className="impact-saving">
          <span className="impact-saving-label">Distance saved</span>
          <span className="impact-saving-value">
            {savedKm > 0 ? `${savedKm.toFixed(1)} km` : savedKm === 0 ? '0 km' : 'None'}
          </span>
          <span className="impact-saving-note">
            {savedKm > 0
              ? `${baseline.distance_saved_percent.toFixed(1)}% shorter than the original order`
              : 'The optimized order is the same length as the original'}
          </span>
        </div>

        <div className="impact-saving">
          <span className="impact-saving-label">
            <Clock size={12} aria-hidden="true" /> Driving time saved
          </span>
          <span className="impact-saving-value">
            {savedMinutes > 0 ? `${savedMinutes.toFixed(0)} min` : savedMinutes === 0 ? '0 min' : 'None'}
          </span>
          <span className="impact-saving-note">
            {savedMinutes > 0
              ? 'Estimated from the same travel matrix'
              : 'No change in driving time'}
          </span>
        </div>
      </div>

      <p className="impact-cost-note">
        A cost saving is not shown because RouteIQ has no fuel price, driver rate or vehicle cost
        data. Distance and time are measured; money would be a guess.
      </p>
    </section>
  );
};
