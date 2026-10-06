import React from 'react';

interface CapacityBarProps {
  label: string;
  /** 0–100+; values above 100 are rendered as overloaded, not clamped away. */
  percent: number;
  detail: string;
  /** Secondary figure, e.g. volume, when it is the binding constraint. */
  secondary?: { label: string; percent: number };
}

/**
 * Load bar for one vehicle or vehicle class.
 *
 * Shows the underlying numbers next to the bar ("120 / 150 kg") so the
 * percentage is never the only thing on screen — a bar labelled "78%" with no
 * units is exactly the kind of metric this redesign removes.
 */
export const CapacityBar: React.FC<CapacityBarProps> = ({
  label,
  percent,
  detail,
  secondary,
}) => {
  // Over-capacity is a real and important state, so it is shown honestly rather
  // than clamped to 100 which would hide the problem.
  const clamped = Math.min(Math.max(percent, 0), 100);
  const overloaded = percent > 100;
  const nearlyFull = percent >= 90 && !overloaded;
  const idle = percent <= 0;

  const state = overloaded
    ? 'is-overloaded'
    : nearlyFull
    ? 'is-nearly-full'
    : idle
    ? 'is-idle'
    : 'is-loaded';

  const stateText = overloaded
    ? 'over capacity'
    : nearlyFull
    ? 'nearly full'
    : idle
    ? 'empty'
    : 'loaded';

  return (
    <div className="capacity-bar-row">
      <div className="capacity-bar-head">
        <span className="capacity-bar-label">{label}</span>
        <span className={`capacity-bar-value ${state}`}>
          {Math.round(percent)}% <span className="capacity-bar-state">{stateText}</span>
        </span>
      </div>

      <div
        className="capacity-bar-track"
        role="meter"
        aria-valuenow={Math.round(percent)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${label}: ${detail}, ${Math.round(percent)}% ${stateText}`}
      >
        <div className={`capacity-bar-fill ${state}`} style={{ width: `${clamped}%` }} />
      </div>

      <div className="capacity-bar-detail">
        <span>{detail}</span>
        {secondary && (
          <span>
            {secondary.label}: {Math.round(secondary.percent)}%
          </span>
        )}
      </div>
    </div>
  );
};
