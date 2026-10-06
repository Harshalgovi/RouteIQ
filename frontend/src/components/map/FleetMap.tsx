/**
 * FleetMap — the single reusable Leaflet surface for the whole app.
 *
 * It renders markers and an optional route polyline on top of the basemap
 * advertised by `GET /api/v1/maps/config`. Every control is a real focusable
 * `<button>` with an accessible name, and every marker carries an aria-label so
 * the map is usable by keyboard and screen reader.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import type { LatLng } from '../../types';
import { useMapConfig } from '../../context/MapContext';
import { isValidLatLng } from '../../utils/geo';

export type MapMarkerKind =
  | 'vehicle'
  | 'delivery'
  | 'origin'
  | 'destination'
  | 'stop'
  | 'pin';

export interface MapMarker {
  id: string;
  position: LatLng;
  /** Short text drawn inside/next to the marker (e.g. "1" or "V-101"). */
  label?: string;
  kind?: MapMarkerKind;
  color?: string;
  selected?: boolean;
  title?: string;
  onClick?: () => void;
}

export interface MapRoute {
  id: string;
  /** Route path as [lat, lng] pairs — already converted from provider GeoJSON. */
  path: LatLng[];
  color?: string;
  /** Drawn thicker and fully opaque; the rest are dimmed for context. */
  selected?: boolean;
  label?: string;
}

export interface FleetMapProps {
  markers?: MapMarker[];
  /** Route path as [lat, lng] pairs — already converted from provider GeoJSON. */
  route?: LatLng[] | null;
  routeColor?: string;
  /** Several routes at once, e.g. one per vehicle in an optimized plan. */
  routes?: MapRoute[];
  onMapClick?: (position: LatLng) => void;
  /** Ignores map clicks; use for read-only maps. */
  clickable?: boolean;
  height?: string;
  center?: LatLng;
  zoom?: number;
  /** Re-fit the viewport whenever markers/route change. */
  autoFit?: boolean;
  /** Increment to force a refit from the parent (e.g. a "fit" button). */
  fitSignal?: number;
  showStyleSwitcher?: boolean;
  showZoomControls?: boolean;
  className?: string;
  ariaLabel?: string;
  children?: React.ReactNode;
}

const KIND_COLORS: Record<MapMarkerKind, string> = {
  vehicle: '#10b981',
  delivery: '#f59e0b',
  origin: '#22c55e',
  destination: '#ef4444',
  stop: '#38bdf8',
  pin: '#a855f7',
};

/**
 * Stable per-vehicle route colours. Chosen to stay distinguishable on both the
 * light and dark basemaps, and reused by the route list swatches.
 */
export const ROUTE_COLORS = [
  '#38bdf8',
  '#f472b6',
  '#a3e635',
  '#fbbf24',
  '#c084fc',
  '#34d399',
  '#fb7185',
  '#60a5fa',
] as const;

/** Colour for a vehicle's route, stable for a given index. */
export function routeColorAt(index: number): string {
  return ROUTE_COLORS[index % ROUTE_COLORS.length];
}

function markerIcon(marker: MapMarker, selected: boolean): L.DivIcon {
  const color = marker.color ?? KIND_COLORS[marker.kind ?? 'pin'];
  const size = selected ? 40 : 32;

  const html = `
    <div class="fleet-map-marker ${selected ? 'selected' : ''}" style="--marker-color:${color}; width:${size}px; height:${size}px;">
      <span class="fleet-map-marker-core">${marker.label ?? ''}</span>
    </div>
  `;

  return L.divIcon({
    html,
    className: 'fleet-map-marker-wrapper',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  });
}

export const FleetMap: React.FC<FleetMapProps> = ({
  markers = [],
  route = null,
  routeColor = '#38bdf8',
  routes = [],
  onMapClick,
  clickable = true,
  height = '500px',
  center,
  zoom,
  autoFit = true,
  fitSignal,
  showStyleSwitcher = false,
  showZoomControls = true,
  className = '',
  ariaLabel = 'Fleet map',
  children,
}) => {
  const { activeStyle, styles, setActiveStyleId, defaultCenter, defaultZoom } = useMapConfig();

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileRef = useRef<L.TileLayer | null>(null);
  const markerLayerRef = useRef<L.LayerGroup | null>(null);
  const routeLayerRef = useRef<L.LayerGroup | null>(null);
  const clickHandlerRef = useRef<((position: LatLng) => void) | undefined>(onMapClick);
  const fitPendingRef = useRef(true);

  const [isReady, setIsReady] = useState(false);
  const [hasFitted, setHasFitted] = useState(false);

  clickHandlerRef.current = onMapClick;

  const initialCenter = useMemo<LatLng>(
    () => center ?? defaultCenter,
    [center, defaultCenter]
  );
  const initialZoom = zoom ?? defaultZoom;

  // ── Create the map once ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: initialCenter,
      zoom: initialZoom,
      zoomControl: false,
      keyboard: true,
      worldCopyJump: true,
    });

    tileRef.current = L.tileLayer(activeStyle.url, {
      maxZoom: activeStyle.max_zoom ?? 19,
      minZoom: activeStyle.min_zoom ?? 1,
      subdomains: activeStyle.subdomains || 'abc',
      attribution: activeStyle.attribution,
      className: activeStyle.css_class ?? 'tiles-light',
    }).addTo(map);

    markerLayerRef.current = L.layerGroup().addTo(map);
    routeLayerRef.current = L.layerGroup().addTo(map);

    map.on('click', (event: L.LeafletMouseEvent) => {
      clickHandlerRef.current?.([event.latlng.lat, event.latlng.lng]);
    });

    mapRef.current = map;
    setIsReady(true);

    // Leaflet mis-measures inside hidden/flex containers; refresh once mounted.
    const resizeTimer = window.setTimeout(() => map.invalidateSize(), 120);

    return () => {
      window.clearTimeout(resizeTimer);
      map.remove();
      mapRef.current = null;
      tileRef.current = null;
      markerLayerRef.current = null;
      routeLayerRef.current = null;
      setIsReady(false);
    };
    // Intentionally created once — style/view changes are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Swap the basemap when the active style changes ───────────────────────────
  useEffect(() => {
    if (!mapRef.current || !isReady) return;
    if (tileRef.current) {
      mapRef.current.removeLayer(tileRef.current);
    }
    tileRef.current = L.tileLayer(activeStyle.url, {
      maxZoom: activeStyle.max_zoom ?? 19,
      minZoom: activeStyle.min_zoom ?? 1,
      subdomains: activeStyle.subdomains || 'abc',
      attribution: activeStyle.attribution,
      className: activeStyle.css_class ?? 'tiles-light',
    }).addTo(mapRef.current);
  }, [activeStyle, isReady]);

  // ── Draw the routes ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isReady || !routeLayerRef.current) return;
    routeLayerRef.current.clearLayers();

    // Normalise the single-route prop and the multi-route prop into one list so
    // existing single-route callers and multi-vehicle plans share this code path.
    const drawable: MapRoute[] = [];
    const single = (route ?? []).filter(isValidLatLng);
    if (single.length >= 2) {
      drawable.push({ id: '__single__', path: single, color: routeColor, selected: true });
    }
    routes.forEach((entry) => {
      const path = entry.path.filter(isValidLatLng);
      if (path.length >= 2) drawable.push({ ...entry, path });
    });

    // When nothing is selected every route is drawn at full strength; otherwise
    // the unselected ones are dimmed so the highlighted route stands out.
    const hasSelection = drawable.some((entry) => entry.selected);

    drawable.forEach((entry, index) => {
      const color = entry.color ?? ROUTE_COLORS[index % ROUTE_COLORS.length];
      const isActive = entry.selected || !hasSelection;
      const dimmed = hasSelection && !entry.selected;

      // Casing underneath for legibility on light tiles, colour line on top.
      L.polyline(entry.path, {
        color: '#0b1220',
        weight: isActive ? 8 : 5,
        opacity: dimmed ? 0.18 : 0.35,
        lineJoin: 'round',
      }).addTo(routeLayerRef.current as L.LayerGroup);

      const line = L.polyline(entry.path, {
        color,
        weight: isActive ? 5 : 3,
        opacity: dimmed ? 0.35 : 0.92,
        lineJoin: 'round',
      }).addTo(routeLayerRef.current as L.LayerGroup);

      if (entry.label) {
        line.bindTooltip(entry.label, { sticky: true });
      }
    });
  }, [route, routeColor, routes, isReady]);

  // ── Draw the markers ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isReady || !markerLayerRef.current) return;
    markerLayerRef.current.clearLayers();

    markers.forEach((marker) => {
      if (!isValidLatLng(marker.position)) return;

      const leafMarker = L.marker(marker.position, {
        icon: markerIcon(marker, Boolean(marker.selected)),
        keyboard: true,
        riseOnHover: true,
        title: marker.title ?? marker.label ?? '',
      });

      if (marker.onClick) {
        leafMarker.on('click', (event) => {
          L.DomEvent.stopPropagation(event);
          marker.onClick?.();
        });
      }

      leafMarker.addTo(markerLayerRef.current as L.LayerGroup);

      const element = leafMarker.getElement();
      if (element) {
        element.setAttribute('role', 'button');
        element.setAttribute(
          'aria-label',
          marker.title ?? `${marker.kind ?? 'Point'} ${marker.label ?? ''}`.trim()
        );
        element.setAttribute('tabindex', '0');
        if (marker.onClick) {
          element.addEventListener('keydown', (event) => {
            if ((event as KeyboardEvent).key === 'Enter' || (event as KeyboardEvent).key === ' ') {
              (event as KeyboardEvent).preventDefault();
              marker.onClick?.();
            }
          });
        }
      }
    });

    fitPendingRef.current = true;
  }, [markers, isReady]);

  // ── Fit the viewport to the data ─────────────────────────────────────────────
  const fitToContent = React.useCallback(() => {
    const map = mapRef.current;
    if (!map) return;

    const points: L.LatLngExpression[] = [];
    markers.forEach((m) => isValidLatLng(m.position) && points.push(m.position));
    (route ?? []).forEach((p) => isValidLatLng(p) && points.push(p));
    routes.forEach((entry) =>
      entry.path.forEach((p) => isValidLatLng(p) && points.push(p))
    );

    if (points.length === 0) {
      map.setView(initialCenter, initialZoom);
      return;
    }
    if (points.length === 1) {
      map.setView(points[0] as L.LatLngExpression, Math.max(initialZoom, 14));
      return;
    }
    map.fitBounds(L.latLngBounds(points), { padding: [56, 56], maxZoom: 16 });
  }, [markers, route, routes, initialCenter, initialZoom]);

  const routePointCount = useMemo(
    () => (route?.length ?? 0) + routes.reduce((sum, entry) => sum + entry.path.length, 0),
    [route, routes]
  );

  useEffect(() => {
    if (!isReady || !autoFit) return;
    if (!fitPendingRef.current) return;
    if (markers.length === 0 && routePointCount < 2) return;

    fitPendingRef.current = false;
    setHasFitted(true);
    fitToContent();
  }, [isReady, autoFit, markers.length, routePointCount, fitToContent]);

  // Parent-driven refit (the "fit" button increments fitSignal).
  useEffect(() => {
    if (!isReady || fitSignal === undefined) return;
    setHasFitted(true);
    fitToContent();
  }, [fitSignal, isReady, fitToContent]);

  // Track container resizes (sidebar collapse, panel open/close).
  useEffect(() => {
    if (!isReady || !containerRef.current) return;
    const observer = new ResizeObserver(() => mapRef.current?.invalidateSize());
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [isReady]);

  const mapPoints = markers.filter((m) => isValidLatLng(m.position));

  return (
    <div
      className={`fleet-map ${clickable && onMapClick ? 'is-clickable' : ''} ${className}`}
      style={{ height }}
    >
      <div ref={containerRef} className="fleet-map-canvas" role="application" aria-label={ariaLabel} />

      <div className="fleet-map-controls">
        {showZoomControls && (
          <>
            <button
              type="button"
              className="map-control-icon-btn"
              onClick={() => mapRef.current?.zoomIn()}
              aria-label="Zoom in"
              title="Zoom in"
            >
              +
            </button>
            <button
              type="button"
              className="map-control-icon-btn"
              onClick={() => mapRef.current?.zoomOut()}
              aria-label="Zoom out"
              title="Zoom out"
            >
              −
            </button>
            <button
              type="button"
              className="map-control-icon-btn"
              onClick={fitToContent}
              aria-label="Fit map to all points"
              title="Fit map to all points"
            >
              ⤢
            </button>
          </>
        )}

        {showStyleSwitcher && styles.length > 1 && (
          <div className="tile-toggle-group" role="group" aria-label="Basemap style">
            {styles.map((style) => (
              <button
                key={style.id}
                type="button"
                className={`tile-btn ${style.id === activeStyle.id ? 'active' : ''}`}
                onClick={() => setActiveStyleId(style.id)}
                aria-pressed={style.id === activeStyle.id}
                title={style.name}
              >
                {style.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <span className="sr-only">
        {mapPoints.length} point{mapPoints.length === 1 ? '' : 's'} on map.
        {hasFitted ? '' : ' Map has not been fitted to the data yet.'}
      </span>

      {children}
    </div>
  );
};

export default FleetMap;
