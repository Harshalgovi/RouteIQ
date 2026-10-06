/**
 * Read-only view of the live backend configuration.
 *
 * RouteIQ has no settings table and no endpoint that writes configuration: the
 * provider endpoints, solver and database come from the server's environment.
 * Rather than render editable fields that would silently discard input, this
 * page reports exactly what the running backend reports, and points at the
 * `.env` file that changes it.
 */
import React, { useEffect, useState } from 'react';
import {
  Settings as SettingsIcon,
  Building2,
  Truck,
  Package,
  Navigation,
  Bell,
  Map as MapIcon,
  Check,
  AlertTriangle,
  RefreshCw,
  Info,
} from 'lucide-react';
import { fetchProviderBundle, fetchOptimizationCapabilities, fetchHealthStatus } from '../services/api';
import type {
  MapProviderInfo,
  RoutingProviderInfo,
  GeocodingProviderInfo,
  OptimizationCapabilities,
  HealthStatus,
} from '../types';

type SubTab = 'providers' | 'routing' | 'system';

interface Loadable {
  loading: boolean;
  error: string | null;
}

const describe = (err: unknown): string =>
  err instanceof Error ? err.message : 'Could not reach the backend';

export const SettingsPage: React.FC = () => {
  const [activeSubTab, setActiveSubTab] = useState<SubTab>('providers');

  const [mapInfo, setMapInfo] = useState<MapProviderInfo | null>(null);
  const [routingInfo, setRoutingInfo] = useState<RoutingProviderInfo | null>(null);
  const [geocodingInfo, setGeocodingInfo] = useState<GeocodingProviderInfo | null>(null);
  const [capabilities, setCapabilities] = useState<OptimizationCapabilities | null>(null);
  const [health, setHealth] = useState<HealthStatus | null>(null);

  const [load, setLoad] = useState<Loadable>({ loading: true, error: null });
  const [lastChecked, setLastChecked] = useState<string | null>(null);

  const refresh = async () => {
    setLoad({ loading: true, error: null });
    try {
      const [bundle, caps, status] = await Promise.all([
        fetchProviderBundle(),
        fetchOptimizationCapabilities(),
        fetchHealthStatus(),
      ]);
      setMapInfo(bundle.map);
      setRoutingInfo(bundle.routing);
      setGeocodingInfo(bundle.geocoding);
      setCapabilities(caps);
      setHealth(status);
      setLastChecked(new Date().toLocaleTimeString());
      setLoad({ loading: false, error: null });
    } catch (err) {
      setLoad({ loading: false, error: describe(err) });
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const tabs: { key: SubTab; label: string; icon: React.ElementType }[] = [
    { key: 'providers', label: 'Map & Address Services', icon: MapIcon },
    { key: 'routing', label: 'Routing & Optimization', icon: Navigation },
    { key: 'system', label: 'System', icon: Building2 },
  ];

  const activeStyle = mapInfo?.styles.find((s) => s.id === mapInfo.default_style);

  return (
    <div className="settings-page">
      <div className="page-action-header">
        <div>
          <h2 className="section-title">
            <SettingsIcon size={20} /> Platform &amp; Routing Service Configuration
          </h2>
          <p className="section-subtitle">
            Live values reported by the running backend. RouteIQ stores no editable settings, so
            these read from the server environment.
          </p>
        </div>
        <button className="btn btn-secondary" onClick={refresh} disabled={load.loading}>
          <RefreshCw size={14} className={load.loading ? 'spin' : ''} /> Refresh
        </button>
      </div>

      <div className="settings-layout">
        <div className="card settings-nav-card">
          <ul className="settings-tab-list">
            {tabs.map((tab) => (
              <li key={tab.key}>
                <button
                  type="button"
                  className={`settings-tab-item ${activeSubTab === tab.key ? 'active' : ''}`}
                  onClick={() => setActiveSubTab(tab.key)}
                  aria-current={activeSubTab === tab.key ? 'page' : undefined}
                >
                  <tab.icon size={16} aria-hidden="true" /> {tab.label}
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="card settings-content-card">
          <div className="settings-form-section">
            {load.loading && (
              <p className="map-notice">
                <RefreshCw size={12} className="spin" aria-hidden="true" /> Reading configuration from
                the backend…
              </p>
            )}

            {load.error && (
              <p className="map-notice error" role="alert">
                {load.error}. The backend may be stopped; start it and press Refresh.
              </p>
            )}

            {activeSubTab === 'providers' && !load.loading && !load.error && (
              <>
                <h3 className="section-heading">Basemap Tiles</h3>
                <ProviderRow
                  label="Tile Provider"
                  name={mapInfo?.name}
                  endpoint={activeStyle?.url}
                  configured={mapInfo?.provider ? true : false}
                  requiresKey={mapInfo?.requires_api_key}
                  extra={
                    mapInfo
                      ? `${mapInfo.styles.length} style(s) available: ${mapInfo.styles
                          .map((s) => s.name)
                          .join(', ')}. Default: ${mapInfo.styles.find((s) => s.id === mapInfo.default_style)?.name ?? 'unknown'}.`
                      : undefined
                  }
                />
                {activeStyle && (
                  <p className="drawer-note">
                    <Info size={13} aria-hidden="true" />
                    Both the dark and light styles read the same keyless OpenStreetMap tiles; the dark
                    look is a client-side filter, so there is no second tile provider to configure.
                    Attribution shown on the map: {mapInfo?.attribution?.map((a) => a.label).join(', ')}
                  </p>
                )}

                <h3 className="section-heading" style={{ marginTop: '1.5rem' }}>
                  Address Geocoding
                </h3>
                <ProviderRow
                  label="Geocoding Provider"
                  name={geocodingInfo?.name}
                  configured={geocodingInfo ? true : false}
                  requiresKey={geocodingInfo?.requires_api_key}
                  extra={
                    geocodingInfo?.message ??
                    'Delivery addresses are geocoded server-side when a delivery is saved without coordinates.'
                  }
                />
              </>
            )}

            {activeSubTab === 'routing' && !load.loading && !load.error && (
              <>
                <h3 className="section-heading">Distance Matrix &amp; Routes</h3>
                <ProviderRow
                  label="Routing Provider"
                  name={routingInfo?.name}
                  configured={routingInfo?.configured}
                  requiresKey={routingInfo?.requires_api_key}
                  extra={
                    routingInfo
                      ? `Profiles: ${routingInfo.profiles.join(', ')}. Distance matrix: ${
                          routingInfo.supports_matrix ? 'supported' : 'not available'
                        }.`
                      : undefined
                  }
                />

                {capabilities && (
                  <>
                    <h3 className="section-heading" style={{ marginTop: '1.5rem' }}>
                      Route Optimizer
                    </h3>
                    <ProviderRow
                      label="Solver"
                      name={capabilities.solver}
                      extra={`Engine: ${capabilities.engine}. Objective: minimize ${capabilities.objective.replace(/_/g, ' ')}.`}
                    />

                    <div className="settings-capability-grid">
                      <div>
                        <h4 className="capability-heading">Constraints enforced</h4>
                        <ul className="capability-list">
                          {capabilities.constraints_enforced.map((constraint) => (
                            <li key={constraint}>
                              <Check size={12} aria-hidden="true" />
                              {constraint.replace(/_/g, ' ')}
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <h4 className="capability-heading">Not implemented</h4>
                        <ul className="capability-list is-muted">
                          {capabilities.constraints_not_yet_implemented.map((constraint) => (
                            <li key={constraint}>
                              <AlertTriangle size={12} aria-hidden="true" />
                              {constraint.replace(/_/g, ' ')}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>

                    <p className="drawer-note">
                      <Info size={13} aria-hidden="true" />
                      RouteIQ does not claim capabilities it does not have. Anything listed as not
                      implemented is not modelled in the solver.
                    </p>
                  </>
                )}
              </>
            )}

            {activeSubTab === 'system' && !load.loading && !load.error && (
              <>
                <h3 className="section-heading">Backend</h3>
                <div className="form-group">
                  <label>Application</label>
                  <div className="provider-readonly">
                    <div className="provider-readonly-text">
                      <strong>
                        {health?.app ?? 'RouteIQ'} v{health?.version ?? '—'}
                      </strong>
                      <span className="table-subtext">Environment: {health?.environment ?? '—'}</span>
                    </div>
                    <span className={`provider-chip ${health?.database === 'connected' ? 'is-ok' : 'is-warn'}`}>
                      {health?.database === 'connected' ? (
                        <>
                          <Check size={12} aria-hidden="true" /> Database connected
                        </>
                      ) : (
                        <>
                          <AlertTriangle size={12} aria-hidden="true" /> Database {health?.database ?? 'unknown'}
                        </>
                      )}
                    </span>
                  </div>
                </div>

                <h3 className="section-heading" style={{ marginTop: '1.5rem' }}>
                  Notifications
                </h3>
                <p className="section-subtitle">
                  RouteIQ generates in-app notifications from real record state — deliveries marked
                  delayed, and vehicles that are tracked but have no position. There is no email or SMS
                  delivery configured, so no notification channel settings exist to change.
                </p>

                <h3 className="section-heading" style={{ marginTop: '1.5rem' }}>
                  How configuration works
                </h3>
                <p className="section-subtitle">
                  Providers, the solver and the database URL are read from the backend{' '}
                  <code>.env</code> file or the environment. Change them there and restart the API; this
                  page then reflects the new values after a refresh.
                </p>
                <ul className="settings-help-list">
                  <li>
                    <Package size={13} aria-hidden="true" />
                    Vehicle capacity, delivery windows and priorities are edited in the app itself, not
                    here.
                  </li>
                  <li>
                    <Truck size={13} aria-hidden="true" />
                    Fleet and driver records live in the database and are managed from the Vehicles and
                    Drivers pages.
                  </li>
                  <li>
                    <Bell size={13} aria-hidden="true" />
                    Notification content is derived from delivery and vehicle state on every load.
                  </li>
                </ul>
              </>
            )}

            {lastChecked && !load.loading && (
              <p className="settings-last-checked">
                <Info size={12} aria-hidden="true" /> Configuration read from the backend at{' '}
                {lastChecked}.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * One read-only configuration row in the providers tab: a chip for connectivity
 * plus whatever details the backend reported. Declared at module level — any
 * component created inside the page render would be re-created on every render.
 */
const ProviderRow: React.FC<{
  label: string;
  name?: string;
  endpoint?: string;
  configured?: boolean;
  requiresKey?: boolean;
  extra?: string;
}> = ({ label, name, endpoint, configured, requiresKey, extra }) => (
  <div className="form-group">
    <label>{label}</label>
    <div className="provider-readonly">
      <div className="provider-readonly-text">
        {name && <strong>{name}</strong>}
        {endpoint && <code>{endpoint}</code>}
        {extra && <span className="table-subtext">{extra}</span>}
      </div>
      {configured !== undefined && (
        <span className={`provider-chip ${configured ? 'is-ok' : 'is-warn'}`}>
          {configured ? <Check size={12} aria-hidden="true" /> : <AlertTriangle size={12} aria-hidden="true" />}
          {configured ? 'Connected' : 'Not configured'}
        </span>
      )}
      {requiresKey !== undefined && (
        <span className={`provider-chip ${requiresKey ? 'is-warn' : 'is-ok'}`}>
          {requiresKey ? 'API key required' : 'No API key needed'}
        </span>
      )}
    </div>
  </div>
);