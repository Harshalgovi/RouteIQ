/**
 * MapContext — basemap configuration for every map in the app.
 *
 * Tile styles, the default viewport and the active provider all come from
 * `GET /api/v1/maps/config`, so adding or swapping a map provider is a
 * backend-only change. A single OSM raster fallback is used only when the
 * backend cannot be reached, so maps still render in an offline dev session.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { LatLng, MapProviderInfo, TileStyle } from '../types';
import { fetchMapConfig } from '../services/api';

const FALLBACK_STYLE: TileStyle = {
  id: 'openstreetmap',
  name: 'OpenStreetMap',
  url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: '&copy; OpenStreetMap contributors',
  max_zoom: 19,
  min_zoom: 1,
  subdomains: 'abc',
  scheme: 'light',
};

// Bengaluru, Karnataka, India — RouteIQ's default geography. Used only when the
// backend map config cannot be reached.
const FALLBACK_CENTER: LatLng = [12.9716, 77.5946];
const FALLBACK_ZOOM = 11;

interface MapContextType {
  styles: TileStyle[];
  activeStyleId: string;
  activeStyle: TileStyle;
  setActiveStyleId: (id: string) => void;
  defaultCenter: LatLng;
  defaultZoom: number;
  provider: MapProviderInfo | null;
  providerName: string;
  isLoading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

const MapContext = createContext<MapContextType | undefined>(undefined);

export const MapProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [config, setConfig] = useState<MapProviderInfo | null>(null);
  const [activeStyleId, setActiveStyleId] = useState<string>(FALLBACK_STYLE.id);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setIsLoading(true);
    try {
      const next = await fetchMapConfig();
      setConfig(next);
      setActiveStyleId(next.default_style);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Map configuration unavailable');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const value = useMemo<MapContextType>(() => {
    const styles = config?.styles?.length ? config.styles : [FALLBACK_STYLE];
    const activeStyle = styles.find((s) => s.id === activeStyleId) ?? styles[0];

    return {
      styles,
      activeStyleId: activeStyle.id,
      activeStyle,
      setActiveStyleId,
      defaultCenter: config
        ? [config.default_view.latitude, config.default_view.longitude]
        : FALLBACK_CENTER,
      defaultZoom: config?.default_view.zoom ?? FALLBACK_ZOOM,
      provider: config,
      providerName: config?.name ?? 'OpenStreetMap (fallback)',
      isLoading,
      error,
      reload,
    };
  }, [config, activeStyleId, isLoading, error, reload]);

  return <MapContext.Provider value={value}>{children}</MapContext.Provider>;
};

export const useMapConfig = () => {
  const context = useContext(MapContext);
  if (!context) {
    throw new Error('useMapConfig must be used within a MapProvider');
  }
  return context;
};

export { FALLBACK_CENTER, FALLBACK_ZOOM };
