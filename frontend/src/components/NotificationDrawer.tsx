import React from 'react';
import { useFleet } from '../context/FleetContext';
import { Bell, AlertTriangle, Info, CheckCircle2 } from 'lucide-react';

interface NotificationDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

export const NotificationDrawer: React.FC<NotificationDrawerProps> = ({ isOpen, onClose }) => {
  const { notifications, markNotificationRead } = useFleet();

  if (!isOpen) return null;

  const unreadCount = notifications.filter(n => !n.read).length;

  const getIcon = (type: string) => {
    switch (type) {
      case 'warning':
      case 'alert':
        return <AlertTriangle size={16} color="var(--status-warning)" />;
      case 'success':
        return <CheckCircle2 size={16} color="var(--status-success)" />;
      default:
        return <Info size={16} color="var(--accent-primary)" />;
    }
  };

  return (
    <div className="notification-dropdown">
      <div className="notif-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600 }}>
          <Bell size={16} /> Notifications
          {unreadCount > 0 && <span className="notif-badge-pill">{unreadCount} new</span>}
        </div>
        <button className="notif-close-text" onClick={onClose}>Close</button>
      </div>

      <div className="notif-list">
        {notifications.length === 0 ? (
          <div className="notif-empty">No unread notifications</div>
        ) : (
          notifications.map(n => (
            <div 
              key={n.id} 
              className={`notif-item ${n.read ? 'read' : 'unread'}`}
              onClick={() => markNotificationRead(n.id)}
            >
              <div className="notif-icon-wrapper">{getIcon(n.type)}</div>
              <div className="notif-content">
                <div className="notif-item-title">{n.title}</div>
                <div className="notif-item-msg">{n.message}</div>
                <div className="notif-item-time">{n.timestamp}</div>
              </div>
              {!n.read && <span className="unread-dot" title="Unread" />}
            </div>
          ))
        )}
      </div>
    </div>
  );
};
