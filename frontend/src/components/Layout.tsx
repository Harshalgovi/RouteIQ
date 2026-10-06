import React, { useState } from 'react';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { VehicleSelectorModal } from './VehicleSelectorModal';
import { useFleet } from '../context/FleetContext';
import { AlertTriangle, X } from 'lucide-react';
import type { NavTab, HealthStatus } from '../types';

interface LayoutProps {
  activeTab: NavTab;
  setActiveTab: (tab: NavTab) => void;
  healthStatus: HealthStatus;
  onRefreshHealth: () => void;
  children: React.ReactNode;
}

export const Layout: React.FC<LayoutProps> = ({
  activeTab,
  setActiveTab,
  healthStatus,
  onRefreshHealth,
  children,
}) => {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const { actionError, clearActionError } = useFleet();

  return (
    <div className={`app-shell ${isSidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        isCollapsed={isSidebarCollapsed}
        setIsCollapsed={setIsSidebarCollapsed}
      />

      <div className="shell-main">
        <Header
          activeTab={activeTab}
          healthStatus={healthStatus}
          onRefreshHealth={onRefreshHealth}
          onMobileMenuToggle={() => setIsMobileOpen(!isMobileOpen)}
        />

        <main className="shell-content">
          {/*
            Action failures are reported here, once, for the whole app.

            They used to be rendered only inside the tracking modal and the Live
            Tracking page. Every other entry point — the map's inline "Track"
            buttons on the dashboard, the vehicle table, the detail drawer — set
            the same error and showed nothing, so a rejected request looked
            exactly like a click that never registered.
          */}
          {actionError && (
            <div className="inline-banner is-danger app-action-error" role="alert">
              <AlertTriangle size={14} aria-hidden="true" />
              <span>{actionError}</span>
              <button
                type="button"
                className="btn btn-ghost btn-xs"
                onClick={clearActionError}
                aria-label="Dismiss error"
              >
                <X size={14} aria-hidden="true" />
              </button>
            </div>
          )}
          <div className="content-inner">{children}</div>
        </main>
      </div>

      {/* Global Vehicle Selection Modal */}
      <VehicleSelectorModal />
    </div>
  );
};
