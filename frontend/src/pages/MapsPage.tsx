import React, { useEffect, useMemo, useState } from 'react';
import { Map as MapIcon, Navigation, Globe, Layers, Loader2, Search } from 'lucide-react';
import { useFleet } from '../context/FleetContext';
import { useMapConfig } from '../context/MapContext';
import { FleetMap } from '../components/map/FleetMap';
import type { MapMarker } from '../components/map/FleetMap';
import { EmptyState } from '../components/EmptyState';
import { fetchProviderBundle, geocodeAddress } from '../services/api';
import type { GeocodingProviderInfo, RoutingProviderInfo } from '../types';
import type { LatLng } from '../types';
import { isValidLatLng } from '../utils/geo';

export const MapsPage: React.FC = () => {
  const { vehicles, deliveries, dataSource } = useFleet();
  const { styles, activeStyle, provider, providerName, error: configError, reload } = useMapConfig();

  const [showVehicles, setShowVehicles] = useState(true);
  const [showDeliveries, setShowDeliveries] = useState(true);
  const [search, setSearch] = useState('');
  const [searchResult, setSearchResult] = useState<{ position: LatLng; label: string } | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);

  const [routing, setRouting] = useState<RoutingProviderInfo | null>(null);
  const [geocoding, setGeocoding] = useState<GeocodingProviderInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchProviderBundle()
      .then((bundle) => {
        if (cancelled) return;
        setRouting(bundle.routing ?? null);
        setGeocoding(bundle.geocoding ?? null);
      })
      .catch(() => {
        /* provider metadata is informational only */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const markers = useMemo<MapMarker[]>(() => {
    const result: MapMarker[] = [];

    if (showVehicles) {
      vehicles.forEach((vehicle) => {
        if (!isValidLatLng(vehicle.coordinates)) return;
        result.push({
          id: vehicle.id,
          position: vehicle.coordinates,
          label: vehicle.id.replace(/^V-?/, ''),
          kind: 'vehicle',
          title: `${vehicle.id} — ${vehicle.name}`,
        });
      });
    }

    if (showDeliveries) {
      deliveries.forEach((delivery) => {
        if (!isValidLatLng(delivery.coordinates)) return;
        result.push({
          id: delivery.id,
          position: delivery.coordinates,
          label: '•',
          kind: 'delivery',
          title: `${delivery.trackingNumber} — ${delivery.address}`,
        });
      });
    }

    if (searchResult) {
      result.push({
        id: 'search',
        position: searchResult.position,
        label: '🔍',
        kind: 'pin',
        color: '#a855f7',
        selected: true,
        title: searchResult.label,
      });
    }

    return result;
  }, [vehicles, deliveries, showVehicles, showDeliveries, searchResult]);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const address = search.trim();
    if (!address) return;

    setIsSearching(true);
    setSearchError(null);
    try {
      const result = await geocodeAddress(address);
      setSearchResult({
        position: [result.latitude, result.longitude],
        label: result.display_name ?? result.formatted_address ?? address,
      });
    } catch (err) {
      setSearchResult(null);
      setSearchError(err instanceof Error ? err.message : 'Address could not be resolved');
    } finally {
      setIsSearching(false);
    }
  };

  const unlocatedDeliveries = deliveries.filter((d) => !isValidLatLng(d.coordinates)).length;
  const unlocatedVehicles = vehicles.filter((v) => !isValidLatLng(v.coordinates)).length;

  return (
    <div className="maps-page">
      <div className="page-action-header">
        <div>
          <h2 className="section-title">
            <MapIcon size={20} /> Map & Routing Services
          </h2>
          <p className="section-subtitle">
            Live OpenStreetMap view of the fleet. Basemap, geocoding and routing providers are served
            by the backend.
          </p>
        </div>
      </div>

      <div className="maps-layout">
        <div className="card map-card maps-main-card">
          <div className="maps-toolbar">
            <form className="maps-search" onSubmit={handleSearch}>
              <label className="sr-only" htmlFor="maps-search-input">
                Search for an address
              </label>
              <Search size={14} aria-hidden="true" />
              <input
                id="maps-search-input"
                type="text"
                placeholder="Find an address…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <button type="submit" className="btn btn-secondary btn-sm" disabled={isSearching}>
                {isSearching ? <Loader2 size={13} className="spin" /> : <Search size={13} />}
                <span>Locate</span>
              </button>
            </form>

            <div className="maps-layer-toggles" role="group" aria-label="Map layers">
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={showVehicles}
                  onChange={(e) => setShowVehicles(e.target.checked)}
                />
                <span>Vehicles</span>
              </label>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={showDeliveries}
                  onChange={(e) => setShowDeliveries(e.target.checked)}
                />
                <span>Deliveries</span>
              </label>
            </div>
          </div>

          {searchError && (
            <p className="map-notice error" role="alert">
              {searchError}
            </p>
          )}

          <div className="maps-canvas-wrap">
            <FleetMap
              markers={markers}
              height="100%"
              ariaLabel="Map of all fleet vehicles and delivery locations"
              showStyleSwitcher
            />
          </div>

          {markers.length === 0 && (
            <div className="map-empty-overlay">
              <EmptyState
                icon={MapIcon}
                title="Nothing to show on the map yet"
                description={
                  dataSource === 'backend'
                    ? 'No vehicle or delivery in the database has coordinates. Add a delivery with an address — the backend geocodes it — or search for an address above.'
                    : 'The backend is unavailable, so only local fallback data is shown.'
                }
              />
            </div>
          )}
        </div>

        <div className="maps-side-column">
          <div className="card planner-card">
            <h3 className="card-title-sm">
              <Layers size={16} /> Layers on this map
            </h3>
            <div className="solver-meta-box">
              <div className="meta-row">
                <span className="meta-label">Vehicles shown</span>
                <span className="meta-val font-mono">
                  {markers.filter((m) => m.kind === 'vehicle').length}
                </span>
              </div>
              <div className="meta-row">
                <span className="meta-label">Deliveries shown</span>
                <span className="meta-val font-mono">
                  {markers.filter((m) => m.kind === 'delivery').length}
                </span>
              </div>
              {unlocatedVehicles > 0 && (
                <div className="meta-row">
                  <span className="meta-label">Vehicles without position</span>
                  <span className="meta-val font-mono">{unlocatedVehicles}</span>
                </div>
              )}
              {unlocatedDeliveries > 0 && (
                <div className="meta-row">
                  <span className="meta-label">Deliveries not geocoded</span>
                  <span className="meta-val font-mono">{unlocatedDeliveries}</span>
                </div>
              )}
            </div>

            {(unlocatedVehicles > 0 || unlocatedDeliveries > 0) && (
              <p className="hint-text">
                Items without stored coordinates are not drawn — RouteIQ never invents a position.
              </p>
            )}
          </div>

          <div className="card planner-card">
            <h3 className="card-title-sm">
              <Globe size={16} /> Active providers
            </h3>

            {configError && (
              <p className="hint-text error">
                Map configuration unavailable ({configError}). Using the built-in OpenStreetMap
                fallback.{' '}
                <button type="button" className="text-btn" onClick={reload}>
                  Retry
                </button>
              </p>
            )}

            <div className="solver-meta-box">
              <div className="meta-row">
                <span className="meta-label">Basemap</span>
                <span className="meta-val">
                  {activeStyle.name}
                  {provider ? ` (${provider.provider})` : ''}
                </span>
              </div>
              <div className="meta-row">
                <span className="meta-label">Provider</span>
                <span className="meta-val">{providerName}</span>
              </div>
              <div className="meta-row">
                <span className="meta-label">Available styles</span>
                <span className="meta-val">{styles.length}</span>
              </div>
              {routing && (
                <div className="meta-row">
                  <span className="meta-label">Routing provider</span>
                  <span className="meta-val">{routing.name}</span>
                </div>
              )}
              {routing && (
                <div className="meta-row">
                  <span className="meta-label">Routing profiles</span>
                  <span className="meta-val">{routing.profiles.join(', ')}</span>
                </div>
              )}
              {geocoding && (
                <div className="meta-row">
                  <span className="meta-label">Geocoding provider</span>
                  <span className="meta-val">{geocoding.name}</span>
                </div>
              )}
            </div>

            {(routing?.requires_api_key || geocoding?.requires_api_key) && (
              <p className="hint-text">
                Some providers require an API key. Set it in the backend environment to enable them.
              </p>
            )}
          </div>

          {searchResult && (
            <div className="card planner-card">
              <h3 className="card-title-sm">
                <Navigation size={16} /> Geocoding result
              </h3>
              <p className="search-result-label">{searchResult.label}</p>
              <p className="hint-text font-mono">
                {searchResult.position[0].toFixed(5)}, {searchResult.position[1].toFixed(5)}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
