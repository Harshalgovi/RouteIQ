import React from 'react';
import { 
  LayoutDashboard, 
  Package, 
  Truck, 
  User,
  Zap, 
  Radio, 
  BarChart3, 
  Settings,
  ChevronLeft,
  ChevronRight,
  Route,
  Map
} from 'lucide-react';
import type { NavTab } from '../types';

interface SidebarProps {
  activeTab: NavTab;
  setActiveTab: (tab: NavTab) => void;
  isCollapsed: boolean;
  setIsCollapsed: (collapsed: boolean) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  setActiveTab,
  isCollapsed,
  setIsCollapsed,
}) => {
  const navItems = [
    { key: 'dashboard' as NavTab, label: 'Dashboard', icon: LayoutDashboard },
    { key: 'deliveries' as NavTab, label: 'Deliveries', icon: Package },
    { key: 'vehicles' as NavTab, label: 'Vehicles', icon: Truck },
    { key: 'drivers' as NavTab, label: 'Drivers', icon: User },
    { key: 'planner' as NavTab, label: 'Route Planner', icon: Zap },
    { key: 'maps' as NavTab, label: 'Maps', icon: Map },
    { key: 'tracking' as NavTab, label: 'Live Tracking', icon: Radio },
    { key: 'analytics' as NavTab, label: 'Analytics', icon: BarChart3 },
    { key: 'settings' as NavTab, label: 'Settings', icon: Settings },
  ];

  return (
    <aside className={`app-sidebar ${isCollapsed ? 'collapsed' : ''}`}>
      {/* Brand Header */}
      <div className="sidebar-brand">
        <div className="logo-icon">
          <Route size={20} />
        </div>
        {!isCollapsed && (
          <div className="brand-text">
            <span className="brand-name">RouteIQ</span>
            <span className="brand-subtitle">Logistics Control</span>
          </div>
        )}
      </div>

      {/* Navigation List */}
      <div className="nav-section-title">
        {!isCollapsed ? 'OPERATIONAL MODULES' : '•'}
      </div>

      <ul className="nav-list">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.key;
          return (
            <li key={item.key}>
              <button
                type="button"
                className={`nav-item ${isActive ? 'active' : ''}`}
                onClick={() => setActiveTab(item.key)}
                aria-current={isActive ? 'page' : undefined}
                title={isCollapsed ? item.label : undefined}
              >
                <Icon size={18} className="nav-icon" />
                {!isCollapsed && <span className="nav-label">{item.label}</span>}
                {isActive && !isCollapsed && <span className="active-indicator" />}
              </button>
            </li>
          );
        })}
      </ul>

      {/* Collapse Toggle Footer */}
      <div className="sidebar-footer">
        <button
          className="collapse-toggle-btn"
          onClick={() => setIsCollapsed(!isCollapsed)}
          title={isCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
        >
          {isCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          {!isCollapsed && <span>Collapse Sidebar</span>}
        </button>
      </div>
    </aside>
  );
};
