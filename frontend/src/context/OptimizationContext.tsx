/**
 * OptimizationContext — the last real optimization result, shared app-wide.
 *
 * The backend does not persist optimization runs, so this holds the most recent
 * result in memory for the session. That is enough for the planner and for the
 * dashboard and analytics pages to talk about a plan that genuinely exists, and
 * it is explicitly *not* a history: reloading the page clears it, and every
 * consumer labels the data as "last run" rather than as a trend.
 */

import React, { createContext, useContext, useMemo, useState } from 'react';
import type { OptimizationResult } from '../types';

interface OptimizationContextValue {
  /** Last solved plan, or null if the planner has not produced one this session. */
  optimization: OptimizationResult | null;
  setOptimization: (result: OptimizationResult | null) => void;
  clearOptimization: () => void;
  /** True when a real baseline comparison is available. */
  hasBaseline: boolean;
}

const OptimizationContext = createContext<OptimizationContextValue | undefined>(undefined);

export const OptimizationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [optimization, setOptimization] = useState<OptimizationResult | null>(null);

  const value = useMemo<OptimizationContextValue>(
    () => ({
      optimization,
      setOptimization,
      clearOptimization: () => setOptimization(null),
      hasBaseline: optimization?.baseline !== null && optimization?.baseline !== undefined,
    }),
    [optimization]
  );

  return (
    <OptimizationContext.Provider value={value}>{children}</OptimizationContext.Provider>
  );
};

export const useLastOptimization = () => {
  const context = useContext(OptimizationContext);
  if (!context) {
    throw new Error('useLastOptimization must be used within an OptimizationProvider');
  }
  return context;
};
