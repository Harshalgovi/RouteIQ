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
 * Uses the existing RouteIQ `.metric-card` CSS classes so it inherits the
 * dark-card design from the rest of the application automatically.
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

  // Tone class applied to the card so the CSS rules
  // `.metric-card.is-success .metric-card-value` etc. take effect.
  const toneClass = tone !== 'default' ? `is-${tone}` : '';
  const staticClass = !onClick ? 'is-static' : '';

  const ariaLabel = onClick
    ? `${label}: ${isAvailable ? value : unavailableLabel}. ${explanation}${actionHint ? `. ${actionHint}` : ''}`
    : undefined;

  const content = (
    <>
      {/* Label row — icon + text on the same line */}
      <div className="metric-card-label-row">
        {Icon && (
          <span className="metric-card-icon" aria-hidden="true">
            <Icon size={14} />
          </span>
        )}
        <span className="metric-card-label">{label}</span>
      </div>

      {/* Value — large and prominent, clearly separated from the label */}
      {isAvailable ? (
        <>
          <span className="metric-card-value">{value}</span>
          {comparison && (
            <span className="metric-card-reason">{comparison}</span>
          )}
        </>
      ) : (
        <>
          <span className="metric-card-value is-unavailable">{unavailableLabel}</span>
          {unavailableReason && (
            <span className="metric-card-reason">{unavailableReason}</span>
          )}
        </>
      )}

      {/* Explanation — always shown below the value */}
      <span className="metric-card-explanation">{explanation}</span>
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        className={`metric-card ${toneClass}`.trim()}
        onClick={onClick}
        aria-label={ariaLabel}
      >
        {content}
      </button>
    );
  }

  return (
    <div className={`metric-card ${toneClass} ${staticClass}`.trim()}>
      {content}
    </div>
  );
};
