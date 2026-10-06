import React from 'react';
import type { LucideIcon } from 'lucide-react';

interface DashboardMetricProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: LucideIcon;
  trend?: {
    value: string;
    isPositive: boolean;
  };
  accentColor?: string;
  onClick?: () => void;
}

export const DashboardMetric: React.FC<DashboardMetricProps> = ({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
  accentColor = 'var(--accent-primary)',
  onClick,
}) => {
  return (
    <div 
      className={`card metric-card ${onClick ? 'clickable' : ''}`}
      onClick={onClick}
    >
      <div className="metric-header">
        <span className="metric-title">{title}</span>
        <div className="metric-icon" style={{ color: accentColor, background: `rgba(56, 189, 248, 0.08)` }}>
          <Icon size={18} />
        </div>
      </div>
      <div className="metric-value-row">
        <span className="metric-value">{value}</span>
        {trend && (
          <span className={`metric-trend ${trend.isPositive ? 'positive' : 'negative'}`}>
            {trend.isPositive ? '↑' : '↓'} {trend.value}
          </span>
        )}
      </div>
      {subtitle && <div className="metric-subtitle">{subtitle}</div>}
    </div>
  );
};
