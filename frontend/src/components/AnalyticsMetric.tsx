import React from 'react';
import type { LucideIcon } from 'lucide-react';

export type MetricAvailability = 'available' | 'unavailable';

interface AnalyticsMetricProps {
  /**
   * What this number is, in the operator's words. "Deliveries completed" —
   * never "Fulfillment KPI".
   */
  label: string;
  value: string | number | null;
  /** One sentence on what the number counts and why it matters. */
  explanation: string;
  icon?: LucideIcon;
  /**
   * Real comparison, e.g. "3 fewer than yesterday". Only pass a value the app
   * actually has — never a decorative percentage.
   */
  comparison?: string;
  /** Shown when the value is null. Defaults to "Not available". */
  unavailableLabel?: string;
  /** Why it is unavailable, shown under the placeholder. */
  unavailableReason?: string;
  /** Tints the value only. Must always accompany a text label. */
  tone?: 'default' | 'success' | 'warning' | 'danger';
  onClick?: () => void;
  /** Extra context for screen readers when the tile is clickable. */
  actionHint?: string;
}

/**
 * A single explained metric.
 *
 * The contract for every number in RouteIQ: a name, a value, and one sentence
 * saying what it counts and why it matters. When the backend cannot supply the
 * value the component says so plainly instead of rendering a plausible-looking
 * placeholder — an unexplained number is worse than no number, because a
 * dispatcher will act on it.
 */
export const AnalyticsMetric: React.FC<AnalyticsMetricProps> = ({
  label,
  value,
  explanation,
  icon: Icon,
  comparison,
  unavailableLabel = 'Not available',
  unavailableReason,
  tone = 'default',
  onClick,
  actionHint,
}) => {
  const isAvailable = value !== null && value !== undefined;
  const Wrapper = onClick ? 'button' : 'div';

  return (
    <Wrapper
      className={`analytics-metric ${onClick ? 'is-clickable' : ''} ${isAvailable ? '' : 'is-unavailable'}`}
      {...(onClick
        ? {
            type: 'button' as const,
            onClick,
            'aria-label': `${label}: ${isAvailable ? value : unavailableLabel}. ${explanation}${
              actionHint ? `. ${actionHint}` : ''
            }`,
          }
        : {})}
    >
      <div className="analytics-metric-head">
        <span className="analytics-metric-label">{label}</span>
        {Icon && (
          <span className="analytics-metric-icon" aria-hidden="true">
            <Icon size={15} />
          </span>
        )}
      </div>

      {isAvailable ? (
        <>
          <span className={`analytics-metric-value tone-${tone}`}>{value}</span>
          {comparison && <span className="analytics-metric-comparison">{comparison}</span>}
        </>
      ) : (
        <>
          <span className="analytics-metric-value is-placeholder">{unavailableLabel}</span>
          {unavailableReason && (
            <span className="analytics-metric-comparison">{unavailableReason}</span>
          )}
        </>
      )}

      <span className="analytics-metric-explanation">{explanation}</span>
    </Wrapper>
  );
};
