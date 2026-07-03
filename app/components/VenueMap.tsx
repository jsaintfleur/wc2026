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

import { useEffect, useMemo } from "react";
import { MapContainer, TileLayer, Marker, Polyline, useMap } from "react-leaflet";
import { divIcon, type LeafletEvent } from "leaflet";

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

interface VenueMapProps {
  markers: VenueMapMarker[];
  /* Team travel path as [lat, lng] stops, in match order */
  routePoints: [number, number][];
  mapStyle: "Light" | "Dark" | "Satellite" | "Terrain";
  initialCenter: [number, number];
  initialZoom: number;
  focusRequest: VenueFocusRequest | null;
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

/* Imperative map behaviors that need the Leaflet instance */
function MapController({ markers, focusRequest, layoutKey, onViewChange }: {
  markers: VenueMapMarker[];
  focusRequest: VenueFocusRequest | null;
  layoutKey: string;
  onViewChange?: (center: [number, number], zoom: number) => void;
}) {
  const map = useMap();

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
  focusRequest, layoutKey, onSelect, onViewChange,
}: VenueMapProps) {
  const tiles = TILE_STYLES[mapStyle] || TILE_STYLES.Dark;

  /* divIcon per marker state — CSS-styled dot + city label + live pulse.
     Custom icons avoid Leaflet's bundler-hostile default marker images and
     keep the app's visual language. */
  const icons = useMemo(() => markers.map(m => divIcon({
    className: "vm-marker-wrap",
    iconSize: [0, 0],
    html:
      `<span class="vm-marker${m.live ? " vm-marker--live" : ""}${m.active ? " vm-marker--active" : ""}${m.muted ? " vm-marker--muted" : ""}">` +
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
        layoutKey={layoutKey}
        onViewChange={onViewChange}
      />
    </MapContainer>
  );
}
