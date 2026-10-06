import React, { useState, useEffect, useCallback } from 'react';
import { FleetProvider } from './context/FleetContext';
import { MapProvider } from './context/MapContext';
import { OptimizationProvider } from './context/OptimizationContext';
import { Layout } from './components/Layout';
import { DashboardPage } from './pages/DashboardPage';
import { DeliveriesPage } from './pages/DeliveriesPage';
import { VehiclesPage } from './pages/VehiclesPage';
import { DriversPage } from './pages/DriversPage';
import { OptimizationPage } from './pages/OptimizationPage';
import { MapsPage } from './pages/MapsPage';
import { LiveTrackingPage } from './pages/LiveTrackingPage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { SettingsPage } from './pages/SettingsPage';
import type { NavTab, HealthStatus } from './types';
import { fetchHealthStatus } from './services/api';

/**
 * A filter handed to the page we are navigating to, e.g. "delayed" for
 * deliveries or "no-driver" for vehicles. Held in state rather than passed as a
 * prop so the tables can react to a repeated request for the same filter.
 */
interface NavRequest {
  tab: NavTab;
  filter: string | null;
  /** Increments per request so an identical filter can be re-applied. */
  nonce: number;
}

const MainContent: React.FC = () => {
  const [activeTab, setActiveTab] = useState<NavTab>('dashboard');
  const [navRequest, setNavRequest] = useState<NavRequest>({
    tab: 'dashboard',
    filter: null,
    nonce: 0,
  });
  const [healthStatus, setHealthStatus] = useState<HealthStatus>({
    status: 'loading',
    app: 'RouteIQ',
    version: '0.1.0',
    environment: 'development',
    database: 'connecting',
  });
  const [pendingFilter, setPendingFilter] = useState<{ value: string; nonce: number } | null>(null);

  const loadHealth = useCallback(async () => {
    setHealthStatus(prev => ({ ...prev, status: 'loading' }));
    const result = await fetchHealthStatus();
    setHealthStatus(result);
  }, []);

  useEffect(() => {
    loadHealth();
    const interval = setInterval(loadHealth, 30000);
    return () => clearInterval(interval);
  }, [loadHealth]);

  /**
   * Navigate, optionally asking the destination page to apply a filter.
   *
   * Clears the filter on plain tab switches so arriving at Deliveries by hand
   * shows the full manifest rather than whatever the last filtered view was.
   */
  const navigate = useCallback((tab: NavTab, filter?: string) => {
    setActiveTab(tab);
    setNavRequest((prev) => ({ tab, filter: filter ?? null, nonce: prev.nonce + 1 }));

    if (filter) {
      setPendingFilter({ value: filter, nonce: navRequest.nonce + 1 });
    } else {
      setPendingFilter(null);
    }
  }, [navRequest.nonce]);

  /** Plain tab switch from the sidebar: never carries a filter. */
  const selectTab = useCallback((tab: NavTab) => navigate(tab), [navigate]);

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return <DashboardPage onNavigate={navigate} />;
      case 'deliveries':
        return <DeliveriesPage pendingFilter={pendingFilter} />;
      case 'vehicles':
        return <VehiclesPage pendingFilter={pendingFilter} />;
      case 'drivers':
        return <DriversPage />;
      case 'planner':
        return <OptimizationPage />;
      case 'maps':
        return <MapsPage />;
      case 'tracking':
        return <LiveTrackingPage onNavigate={navigate} />;
      case 'analytics':
        return <AnalyticsPage onNavigate={navigate} />;
      case 'settings':
        return <SettingsPage />;
      default:
        return <DashboardPage onNavigate={navigate} />;
    }
  };

  return (
    <Layout
      activeTab={activeTab}
      setActiveTab={selectTab}
      healthStatus={healthStatus}
      onRefreshHealth={loadHealth}
    >
      {renderContent()}
    </Layout>
  );
};

export const App: React.FC = () => {
  return (
    <MapProvider>
      <FleetProvider>
        <OptimizationProvider>
          <MainContent />
        </OptimizationProvider>
      </FleetProvider>
    </MapProvider>
  );
};

export default App;