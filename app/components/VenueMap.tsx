"use client";

/* Real interactive host-city map (Leaflet via react-leaflet).
 *
 * Loaded client-side only (next/dynamic, ssr: false, from tournament.tsx) —
 * Leaflet touches `window` at import time. The legacy SVG map remains in
 * MapView as the error fallback if this chunk fails to load.
 *
 * Tiles are keyless open providers chosen by the "Map style" setting:
 * CARTO dark/light (OSM data), Esri World Imagery, and OpenTopoMap — each
 * with its required attribution.
 */

import { useEffect, useMemo, useRef } from "react";
import { MapContainer, TileLayer, Marker, Polyline, useMap } from "react-leaflet";
import { divIcon, latLngBounds, type LeafletEvent, type Map as LeafletMap } from "leaflet";

export interface VenueMapMarker {
  venueId: string;
  stadiumName: string;
  city: string;
  country: string;
  latitude: number;
  longitude: number;
  live: boolean;
  active: boolean;
  /* true when the venue is excluded by the current filter — rendered dimmed */
  muted: boolean;
  matchesHosted: number;
  liveCount: number;
  upcomingCount: number;
  completedCount: number;
}

/* A one-shot "center this venue" request. `seq` forces the effect to re-run
   when the same venue is selected twice; the offsets shift the flown-to
   center so the marker stays visible above the bottom sheet (offsetY) or
   left of the desktop side panel (offsetX). */
export interface VenueFocusRequest {
  venueId: string;
  offsetX: number;
  offsetY: number;
  seq: number;
}

/* A one-shot "show every venue" request. The parent owns the counter so the
   same button can be pressed repeatedly without depending on object identity. */
export interface VenueFitRequest {
  seq: number;
}

interface VenueMapProps {
  markers: VenueMapMarker[];
  /* Team travel path as [lat, lng] stops, in match order */
  routePoints: [number, number][];
  mapStyle: "Light" | "Dark" | "Satellite" | "Terrain";
  initialCenter: [number, number];
  initialZoom: number;
  focusRequest: VenueFocusRequest | null;
  fitRequest: VenueFitRequest | null;
  /* Restored views can point to an old ocean/empty tile area after settings
     changes or viewport changes; when true, the controller checks once and
     recovers to all venues if no marker is visible. */
  autoFitIfEmpty: boolean;
  /* Changes whenever the surrounding layout changes size (sheet state,
     panel collapse) so Leaflet re-measures its container. */
  layoutKey: string;
  onSelect: (venueId: string) => void;
  /* Fired on moveend for "remember last viewed map location" persistence */
  onViewChange?: (center: [number, number], zoom: number) => void;
}

/* Keyless tile providers per map style, each with required attribution */
const TILE_STYLES: Record<VenueMapProps["mapStyle"], { url: string; attribution: string }> = {
  Dark: {
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
  },
  Light: {
    url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
  },
  Satellite: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics",
  },
  Terrain: {
    url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://opentopomap.org">OpenTopoMap</a>',
  },
};

function markerAriaLabel(m: VenueMapMarker): string {
  return `${m.stadiumName}, ${m.city}, ${m.country}. ` +
    `${m.matchesHosted} matches: ${m.liveCount} live, ${m.upcomingCount} upcoming, ${m.completedCount} completed.` +
    (m.live ? " Live now." : "");
}

function validVenuePoints(markers: VenueMapMarker[]): [number, number][] {
  return markers
    .filter(m => Number.isFinite(m.latitude) && Number.isFinite(m.longitude) && !(m.latitude === 0 && m.longitude === 0))
    .map(m => [m.latitude, m.longitude] as [number, number]);
}

function fitMapToVenues(map: LeafletMap, markers: VenueMapMarker[], animate: boolean) {
  const points = validVenuePoints(markers);
  if (points.length === 0) return;
  if (points.length === 1) {
    map.flyTo(points[0], Math.max(map.getZoom(), 5), { duration: animate ? 0.45 : 0 });
    return;
  }
  map.fitBounds(latLngBounds(points), {
    animate,
    duration: animate ? 0.55 : undefined,
    maxZoom: 5,
    padding: [46, 46],
  });
}

/* Imperative map behaviors that need the Leaflet instance */
function MapController({ markers, focusRequest, fitRequest, autoFitIfEmpty, layoutKey, onViewChange }: {
  markers: VenueMapMarker[];
  focusRequest: VenueFocusRequest | null;
  fitRequest: VenueFitRequest | null;
  autoFitIfEmpty: boolean;
  layoutKey: string;
  onViewChange?: (center: [number, number], zoom: number) => void;
}) {
  const map = useMap();
  const handledFitSeqRef = useRef(0);
  const checkedEmptyRestoreRef = useRef(false);

  /* Re-measure when the surrounding layout (sheet/panel) changes size —
     otherwise Leaflet keeps rendering into the stale viewport box. */
  useEffect(() => {
    const id = window.setTimeout(() => map.invalidateSize(), 220);
    return () => window.clearTimeout(id);
  }, [map, layoutKey]);

  /* Fly to the selected venue, offset so the marker stays clear of the
     bottom sheet / side panel. Pixel math: shifting the CENTER down/right
     by the offset moves the MARKER up/left in the viewport. */
  useEffect(() => {
    if (!focusRequest) return;
    const marker = markers.find(m => m.venueId === focusRequest.venueId);
    if (!marker) return;
    const zoom = Math.max(map.getZoom(), 5);
    const point = map
      .project([marker.latitude, marker.longitude], zoom)
      .add([focusRequest.offsetX, focusRequest.offsetY]);
    map.flyTo(map.unproject(point, zoom), zoom, { duration: 0.55 });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest?.seq]);

  /* Fit every host venue on explicit request. `handledFitSeqRef` prevents a
     marker array refresh from replaying the same one-shot request. */
  useEffect(() => {
    if (!fitRequest || handledFitSeqRef.current === fitRequest.seq) return;
    handledFitSeqRef.current = fitRequest.seq;
    fitMapToVenues(map, markers, true);
  }, [fitRequest, map, markers]);

  /* If a remembered/restored viewport opens with zero venues visible, recover
     to the continental view once. This guards users from being stranded over
     empty map tiles after a device-size or saved-state change. */
  useEffect(() => {
    if (!autoFitIfEmpty || checkedEmptyRestoreRef.current || markers.length === 0) return;
    checkedEmptyRestoreRef.current = true;
    const id = window.setTimeout(() => {
      map.invalidateSize();
      const bounds = map.getBounds();
      const visibleVenueCount = validVenuePoints(markers).filter(point => bounds.contains(point)).length;
      if (visibleVenueCount === 0) fitMapToVenues(map, markers, false);
    }, 260);
    return () => window.clearTimeout(id);
  }, [autoFitIfEmpty, map, markers]);

  useEffect(() => {
    if (!onViewChange) return;
    const handler = () => {
      const center = map.getCenter();
      onViewChange([center.lat, center.lng], map.getZoom());
    };
    map.on("moveend", handler);
    return () => { map.off("moveend", handler); };
  }, [map, onViewChange]);

  return null;
}

export default function VenueMap({
  markers, routePoints, mapStyle, initialCenter, initialZoom,
  focusRequest, fitRequest, autoFitIfEmpty, layoutKey, onSelect, onViewChange,
}: VenueMapProps) {
  const tiles = TILE_STYLES[mapStyle] || TILE_STYLES.Dark;

  /* divIcon per marker state — CSS-styled dot + city label + live pulse.
     Custom icons avoid Leaflet's bundler-hostile default marker images and
     keep the app's visual language. */
  const icons = useMemo(() => markers.map(m => divIcon({
    className: "vm-marker-wrap",
    iconSize: [44, 44],
    iconAnchor: [22, 22],
    html:
      `<span class="vm-marker${m.live ? " vm-marker--live" : ""}${m.active ? " vm-marker--active" : ""}${m.muted ? " vm-marker--muted" : ""}">` +
      '<span class="vm-marker__hit"></span>' +
      (m.live ? '<span class="vm-marker__pulse"></span>' : "") +
      '<span class="vm-marker__dot"></span>' +
      `<span class="vm-marker__label">${m.city.replace(/</g, "&lt;")}</span>` +
      "</span>",
  })), [markers]);

  return (
    <MapContainer
      center={initialCenter}
      zoom={initialZoom}
      minZoom={3}
      maxZoom={12}
      className={`venue-leaflet venue-leaflet--${mapStyle.toLowerCase()}`}
      scrollWheelZoom
      doubleClickZoom={false}
      attributionControl
    >
      <TileLayer key={mapStyle} url={tiles.url} attribution={tiles.attribution} />
      {routePoints.length > 1 && (
        <Polyline
          positions={routePoints}
          pathOptions={{ color: "#fbbf24", weight: 3, opacity: 0.85, dashArray: "1 8", lineCap: "round" }}
        />
      )}
      {markers.map((m, i) => (
        <Marker
          key={m.venueId}
          position={[m.latitude, m.longitude]}
          icon={icons[i]}
          keyboard
          zIndexOffset={m.active ? 1000 : m.live ? 500 : 0}
          eventHandlers={{
            click: () => onSelect(m.venueId),
            /* Leaflet renders the icon as a focusable element when
               keyboard=true; add the rich label + role for screen readers */
            add: (event: LeafletEvent) => {
              const el = (event.target as { getElement?: () => HTMLElement | null }).getElement?.();
              if (el) {
                el.setAttribute("role", "button");
                el.setAttribute("aria-label", markerAriaLabel(m));
              }
            },
          }}
        />
      ))}
      <MapController
        markers={markers}
        focusRequest={focusRequest}
        fitRequest={fitRequest}
        autoFitIfEmpty={autoFitIfEmpty}
        layoutKey={layoutKey}
        onViewChange={onViewChange}
      />
    </MapContainer>
  );
}
