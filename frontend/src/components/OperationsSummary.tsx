import React from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Truck,
  Package,
  CheckCircle2,
  AlertTriangle,
  Route as RouteIcon,
  Radio,
  UserX,
} from 'lucide-react';
import type { OperationsSummary as OperationsSummaryData } from '../types';

interface OperationsSummaryProps {
  summary: OperationsSummaryData;
  /** Set false while the backend is unreachable so nothing reads as live. */
  isLive: boolean;
  onNavigate: (tab: 'deliveries' | 'vehicles' | 'tracking' | 'planner', filter?: string) => void;
  isLoading: boolean;
}

interface SummaryItem {
  key: string;
  label: string;
  value: number;
  icon: LucideIcon;
  hint: string;
  tone: 'default' | 'success' | 'warning' | 'danger';
  /** Where clicking takes the operator. */
  target?: { tab: 'deliveries' | 'vehicles' | 'tracking' | 'planner'; filter?: string };
}

/**
 * "Today's Operations" — the first thing on the dashboard.
 *
 * Deliberately a single compact row of plain counts. Each number answers
 * "what is happening now" and, where it can, takes the operator straight to the
 * filtered list that explains it. No percentages, no scores, no derived indices.
 */
export const OperationsSummary: React.FC<OperationsSummaryProps> = ({
  summary,
  isLive,
  onNavigate,
  isLoading,
}) => {
  const items: SummaryItem[] = [
    {
      key: 'tracked',
      label: 'Vehicles tracked',
      value: summary.vehiclesTracked,
      icon: Radio,
      hint: `of ${summary.vehiclesTotal} in the fleet — live position on the map`,
      tone: 'default',
      target: { tab: 'tracking' },
    },
    {
      key: 'dispatchable',
      label: 'Ready for dispatch',
      value: summary.vehiclesDispatchable,
      icon: Truck,
      hint: 'status available or active — usable by the route optimizer',
      tone: 'default',
      target: { tab: 'vehicles', filter: 'dispatchable' },
    },
    {
      key: 'today',
      label: 'Deliveries today',
      value: summary.deliveriesToday,
      icon: Package,
      hint: `created today — ${summary.deliveriesTotal} in total`,
      tone: 'default',
      target: { tab: 'deliveries' },
    },
    {
      key: 'delivered',
      label: 'Completed',
      value: summary.deliveriesDelivered,
      icon: CheckCircle2,
      hint: 'marked delivered',
      tone: summary.deliveriesDelivered > 0 ? 'success' : 'default',
      target: { tab: 'deliveries', filter: 'delivered' },
    },
    {
      key: 'delayed',
      label: 'Delayed',
      value: summary.deliveriesDelayed,
      icon: AlertTriangle,
      hint: 'need attention now',
      tone: summary.deliveriesDelayed > 0 ? 'danger' : 'success',
      target: { tab: 'deliveries', filter: 'delayed' },
    },
    {
      key: 'unassigned',
      label: 'Not on a vehicle',
      value: summary.deliveriesUnassigned,
      icon: RouteIcon,
      hint: 'pending or assigned with no vehicle — plan a route',
      tone: summary.deliveriesUnassigned > 0 ? 'warning' : 'success',
      target: { tab: 'planner' },
    },
  ];

  // Gaps that silently waste capacity are worth surfacing in their own right.
  const gaps: SummaryItem[] = [];
  if (summary.vehiclesWithoutDriver > 0) {
    gaps.push({
      key: 'no-driver',
      label: 'No driver assigned',
      value: summary.vehiclesWithoutDriver,
      icon: UserX,
      hint: 'cannot be dispatched until a driver is assigned',
      tone: 'warning',
      target: { tab: 'vehicles', filter: 'no-driver' },
    });
  }

  const all = [...items, ...gaps];

  return (
    <section className="ops-summary" aria-labelledby="ops-summary-heading">
      <div className="ops-summary-head">
        <h2 id="ops-summary-heading" className="ops-summary-title">
          Today&rsquo;s Operations
        </h2>
        {!isLive && (
          <span className="ops-summary-source" title="The backend is unreachable, so these counts come from development data.">
            Development data — not connected
          </span>
        )}
        {isLive && isLoading && <span className="ops-summary-source">Refreshing…</span>}
      </div>

      <ul className="ops-summary-grid">
        {all.map((item) => {
          const Icon = item.icon;
          const content = (
            <>
              <span className="ops-summary-icon" aria-hidden="true">
                <Icon size={16} />
              </span>
              <span className="ops-summary-text">
                <span className="ops-summary-label">{item.label}</span>
                <span className="ops-summary-hint">{item.hint}</span>
              </span>
              <span className={`ops-summary-value tone-${item.tone}`}>{item.value}</span>
            </>
          );

          return (
            <li key={item.key} className="ops-summary-cell">
              {item.target ? (
                <button
                  type="button"
                  className="ops-summary-button"
                  onClick={() => onNavigate(item.target!.tab, item.target!.filter)}
                  aria-label={`${item.label}: ${item.value}. ${item.hint}. Opens the filtered list.`}
                >
                  {content}
                </button>
              ) : (
                <div className="ops-summary-button is-static">{content}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
};
