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
import { MapContainer, TileLayer, Marker, Polyline, ZoomControl, useMap, useMapEvents } from "react-leaflet";
import { divIcon, latLngBounds, type LeafletEvent, type Map as LeafletMap, type Marker as LeafletMarker } from "leaflet";

export interface VenueMapMarker {
  venueId: string;
  stadiumName: string;
  city: string;
  country: string;
  latitude: number;
  longitude: number;
  live: boolean;
  active: boolean;
  /* true when this venue is one of the selected team's route stops */
  onTeamPath: boolean;
  /* true for dense northeast venues whose city labels read better leftward */
  labelLeft: boolean;
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

/* A one-shot route-bounds request used when a team path becomes drawable. */
export interface VenueRouteFitRequest {
  points: [number, number][];
  seq: number;
}

interface VenueMapProps {
  markers: VenueMapMarker[];
  /* Team travel path as [lat, lng] stops, in match order */
  routePoints: [number, number][];
  mapStyle: "Light" | "Dark" | "Terrain";
  initialCenter: [number, number];
  initialZoom: number;
  focusRequest: VenueFocusRequest | null;
  fitRequest: VenueFitRequest | null;
  routeFitRequest: VenueRouteFitRequest | null;
  /* Restored views can point to an old ocean/empty tile area after settings
     changes or viewport changes; when true, the controller checks once and
     recovers to all venues if no marker is visible. */
  autoFitIfEmpty: boolean;
  /* Changes whenever the surrounding layout changes size (sheet state,
     panel collapse) so Leaflet re-measures its container. */
  layoutKey: string;
  onSelect: (venueId: string) => void;
  onBackgroundClick?: () => void;
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
  Terrain: {
    url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://opentopomap.org">OpenTopoMap</a>',
  },
};

function markerAriaLabel(m: VenueMapMarker): string {
  return `${m.stadiumName}, ${m.city}, ${m.country}. ` +
    `${m.matchesHosted} matches: ${m.liveCount} live, ${m.upcomingCount} upcoming, ${m.completedCount} completed.` +
    (m.live ? " Live now." : "") +
    (m.muted ? " Not in current filter." : "");
}

function validVenuePoints(markers: VenueMapMarker[]): [number, number][] {
  return markers
    .filter(m => Number.isFinite(m.latitude) && Number.isFinite(m.longitude) && !(m.latitude === 0 && m.longitude === 0))
    .map(m => [m.latitude, m.longitude] as [number, number]);
}

function fitMapToVenues(map: LeafletMap, markers: VenueMapMarker[], animate: boolean) {
  const points = validVenuePoints(markers);
  fitMapToPoints(map, points, animate, 5);
}

function fitMapToPoints(map: LeafletMap, points: [number, number][], animate: boolean, maxZoom = 7) {
  if (points.length === 0) return;
  if (points.length === 1) {
    map.flyTo(points[0], Math.max(map.getZoom(), 5), { duration: animate ? 0.45 : 0 });
    return;
  }
  map.fitBounds(latLngBounds(points), {
    animate,
    duration: animate ? 0.55 : undefined,
    maxZoom,
    padding: [46, 46],
  });
}

/* Imperative map behaviors that need the Leaflet instance */
function MapController({ markers, focusRequest, fitRequest, routeFitRequest, autoFitIfEmpty, layoutKey, onViewChange }: {
  markers: VenueMapMarker[];
  focusRequest: VenueFocusRequest | null;
  fitRequest: VenueFitRequest | null;
  routeFitRequest: VenueRouteFitRequest | null;
  autoFitIfEmpty: boolean;
  layoutKey: string;
  onViewChange?: (center: [number, number], zoom: number) => void;
}) {
  const map = useMap();
  const handledFitSeqRef = useRef(0);
  const handledRouteFitSeqRef = useRef(0);
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

  /* Fit just the selected team's route stops when a real path appears. This
     is separate from the all-venues control so team exploration never
     overwrites the user's explicit recovery button state. */
  useEffect(() => {
    if (!routeFitRequest || handledRouteFitSeqRef.current === routeFitRequest.seq) return;
    handledRouteFitSeqRef.current = routeFitRequest.seq;
    fitMapToPoints(map, routeFitRequest.points, true, 7);
  }, [routeFitRequest, map]);

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

function MapBackgroundClick({ onBackgroundClick }: { onBackgroundClick?: () => void }) {
  useMapEvents({
    click: event => {
      if (!onBackgroundClick) return;
      const target = event.originalEvent.target;
      /* Marker clicks should keep selecting venues; only bare map clicks
         collapse the sheet. Leaflet suppresses post-drag clicks for us. */
      if (target instanceof Element && target.closest(".leaflet-marker-icon")) return;
      onBackgroundClick();
    },
  });
  return null;
}

export default function VenueMap({
  markers, routePoints, mapStyle, initialCenter, initialZoom,
  focusRequest, fitRequest, routeFitRequest, autoFitIfEmpty, layoutKey, onSelect, onBackgroundClick, onViewChange,
}: VenueMapProps) {
  const tiles = TILE_STYLES[mapStyle] || TILE_STYLES.Dark;
  const markerRefs = useRef(new Map<string, LeafletMarker>());

  /* divIcon per marker state — CSS-styled dot + city label + live pulse.
     Custom icons avoid Leaflet's bundler-hostile default marker images and
     keep the app's visual language. */
  const icons = useMemo(() => markers.map(m => divIcon({
    className: "vm-marker-wrap",
    iconSize: [44, 44],
    iconAnchor: [22, 22],
    html:
      `<span class="vm-marker${m.live ? " vm-marker--live" : ""}${m.active ? " vm-marker--active" : ""}${m.onTeamPath ? " vm-marker--route" : ""}${m.muted ? " vm-marker--muted" : ""}">` +
      '<span class="vm-marker__hit"></span>' +
      (m.live ? '<span class="vm-marker__pulse"></span>' : "") +
      '<span class="vm-marker__dot"></span>' +
      `<span class="vm-marker__label${m.labelLeft ? " vm-marker__label--left" : ""}">${m.city.replace(/</g, "&lt;")}</span>` +
      "</span>",
  })), [markers]);

  /* Leaflet marker DOM can survive prop changes, so labels set only in the
     add event go stale as live counts and filter state change. Keep the
     marker instances keyed by venueId and refresh their current DOM element
     whenever the marker model changes. */
  useEffect(() => {
    for (const marker of markers) {
      const leafletMarker = markerRefs.current.get(marker.venueId);
      const el = leafletMarker?.getElement();
      if (!el) continue;
      el.setAttribute("role", "button");
      el.setAttribute("aria-label", markerAriaLabel(marker));
    }
  }, [markers]);

  return (
    <MapContainer
      center={initialCenter}
      zoom={initialZoom}
      minZoom={3}
      maxZoom={12}
      className={`venue-leaflet venue-leaflet--${mapStyle.toLowerCase()}`}
      zoomControl={false}
      scrollWheelZoom
      doubleClickZoom={false}
      attributionControl
    >
      <ZoomControl position="bottomright" />
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
              const marker = event.target as LeafletMarker;
              markerRefs.current.set(m.venueId, marker);
              const el = marker.getElement?.();
              if (el) {
                el.setAttribute("role", "button");
                el.setAttribute("aria-label", markerAriaLabel(m));
              }
            },
            remove: () => { markerRefs.current.delete(m.venueId); },
          }}
        />
      ))}
      <MapController
        markers={markers}
        focusRequest={focusRequest}
        fitRequest={fitRequest}
        routeFitRequest={routeFitRequest}
        autoFitIfEmpty={autoFitIfEmpty}
        layoutKey={layoutKey}
        onViewChange={onViewChange}
      />
      <MapBackgroundClick onBackgroundClick={onBackgroundClick} />
    </MapContainer>
  );
}
