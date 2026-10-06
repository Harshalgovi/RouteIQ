import React, { useState } from 'react';
import type { NavTab, HealthStatus } from '../types';
import { useFleet } from '../context/FleetContext';
import { NotificationDrawer } from './NotificationDrawer';
import { 
  Search, 
  Bell, 
  User, 
  RefreshCw, 
  Menu
} from 'lucide-react';

interface HeaderProps {
  activeTab: NavTab;
  healthStatus: HealthStatus;
  onRefreshHealth: () => void;
  onMobileMenuToggle: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  healthStatus,
  onRefreshHealth,
  onMobileMenuToggle,
}) => {
  const { searchQuery, setSearchQuery, notifications } = useFleet();
  const [isNotifOpen, setIsNotifOpen] = useState(false);

  const unreadCount = notifications.filter(n => !n.read).length;

  const pageTitleMap: { [key in NavTab]: { title: string; subtitle: string } } = {
    dashboard: {
      title: 'Operational Control Center',
      subtitle: 'Real-time vehicle tracking map & fleet dispatch metrics',
    },
    deliveries: {
      title: 'Deliveries Management',
      subtitle: 'Order manifests, time windows, weight/volume & delivery status',
    },
    vehicles: {
      title: 'Vehicle Fleet Management',
      subtitle: 'Vehicle capacity specifications, driver assignments & telemetry',
    },
    drivers: {
      title: 'Driver Roster',
      subtitle: 'Driver records, availability status & vehicle assignments',
    },
    planner: {
      title: 'Route Planner',
      subtitle: 'Real OpenStreetMap route preview with distance, duration and road path',
    },
    maps: {
      title: 'Map & Routing Services',
      subtitle: 'OpenStreetMap fleet map, address search and active map providers',
    },
    tracking: {
      title: 'Live GPS Fleet Tracking',
      subtitle: 'High-precision vehicle map monitoring & driver route progress',
    },
    analytics: {
      title: 'Route Performance Analytics',
      subtitle: 'Fleet efficiency, total distance savings, and delivery fulfillment KPIs',
    },
    settings: {
      title: 'Platform System Settings',
      subtitle: 'Live provider, routing and database configuration reported by the backend',
    },
  };

  const currentMeta = pageTitleMap[activeTab] || pageTitleMap.dashboard;

  const isHealthy = healthStatus.status === 'ok';

  return (
    <header className="app-topbar">
      <div className="topbar-left">
        <button className="mobile-menu-btn" onClick={onMobileMenuToggle} aria-label="Toggle menu">
          <Menu size={20} />
        </button>
        <div>
          <h1 className="topbar-title">{currentMeta.title}</h1>
          <p className="topbar-subtitle">{currentMeta.subtitle}</p>
        </div>
      </div>

      <div className="topbar-right">
        {/* Global Search Bar */}
        <div className="topbar-search">
          <Search size={15} className="search-icon" />
          <input
            type="text"
            placeholder="Search deliveries, vehicles, routes..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>

        {/* Backend Health Badge */}
        <div 
          className={`health-pill ${isHealthy ? 'healthy' : 'degraded'}`}
          title={healthStatus.error || `Connected to ${healthStatus.app} REST Backend`}
        >
          <span className={`pill-dot ${isHealthy ? 'ok' : 'error'}`} />
          <span className="pill-text">{isHealthy ? 'API Online' : 'API Offline'}</span>
          <button 
            className="pill-refresh-btn" 
            onClick={onRefreshHealth}
            title="Refresh backend status"
          >
            <RefreshCw size={11} className={healthStatus.status === 'loading' ? 'spin' : ''} />
          </button>
        </div>

        {/* Notification Bell */}
        <div className="notif-wrapper">
          <button 
            className="topbar-icon-btn"
            onClick={() => setIsNotifOpen(!isNotifOpen)}
            title="Notifications"
          >
            <Bell size={18} />
            {unreadCount > 0 && <span className="notif-dot" />}
          </button>

          <NotificationDrawer 
            isOpen={isNotifOpen} 
            onClose={() => setIsNotifOpen(false)} 
          />
        </div>

        {/* User Profile Badge */}
        <div className="user-profile-badge">
          <div className="user-avatar">
            <User size={16} />
          </div>
          <div className="user-info">
            <span className="user-name">Dispatch Control</span>
            <span className="user-role">Operations Manager</span>
          </div>
        </div>
      </div>
    </header>
  );
};
