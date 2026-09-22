import { useEffect, useMemo, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet';

// Brand pin as a div icon (avoids Leaflet's default image assets, which
// bundlers don't resolve).
const pinIcon = L.divIcon({
  className: 'map-pin',
  html: '<svg width="34" height="44" viewBox="0 0 34 44" aria-hidden="true"><path d="M17 43s15-14.6 15-26A15 15 0 0 0 2 17c0 11.4 15 26 15 26z" fill="#0F5F5C" stroke="#fff" stroke-width="2"/><circle cx="17" cy="17" r="6" fill="#E8900C"/></svg>',
  iconSize: [34, 44],
  iconAnchor: [17, 43],
});

const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

export const DEFAULT_CENTER: [number, number] = [28.4089, 77.3178]; // Faridabad

function Recenter({ center, zoom }: { center: [number, number]; zoom?: number }) {
  const map = useMap();
  const key = `${center[0].toFixed(6)},${center[1].toFixed(6)}`;
  const last = useRef('');
  useEffect(() => {
    if (last.current !== key) {
      last.current = key;
      map.setView(center, zoom ?? Math.max(map.getZoom(), 15));
    }
  }, [key, center, zoom, map]);
  return null;
}

function ClickToMove({ onMove }: { onMove: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onMove(e.latlng.lat, e.latlng.lng) });
  return null;
}

/** Draggable pin picker. `focus` recentres the map (e.g. after a place search). */
export function MapPicker({ lat, lng, onChange, focus, height = 360 }: { lat: number | null; lng: number | null; onChange: (lat: number, lng: number) => void; focus?: [number, number] | null; height?: number }) {
  const pos: [number, number] = lat != null && lng != null ? [lat, lng] : DEFAULT_CENTER;
  const handlers = useMemo(
    () => ({
      dragend(e: L.LeafletEvent) {
        const ll = (e.target as L.Marker).getLatLng();
        onChange(ll.lat, ll.lng);
      },
    }),
    [onChange],
  );
  return (
    <div className="map-box" style={{ height }}>
      <MapContainer center={pos} zoom={lat != null ? 16 : 12} scrollWheelZoom style={{ height: '100%', width: '100%' }}>
        <TileLayer url={TILE_URL} attribution={ATTRIBUTION} maxZoom={19} />
        <Marker position={pos} draggable icon={pinIcon} eventHandlers={handlers} />
        <ClickToMove onMove={onChange} />
        {focus && <Recenter center={focus} />}
      </MapContainer>
    </div>
  );
}

/** Read-only map with a single pin. */
export function MapView({ lat, lng, height = 280 }: { lat: number; lng: number; height?: number }) {
  return (
    <div className="map-box" style={{ height }}>
      <MapContainer center={[lat, lng]} zoom={16} scrollWheelZoom={false} style={{ height: '100%', width: '100%' }}>
        <TileLayer url={TILE_URL} attribution={ATTRIBUTION} maxZoom={19} />
        <Marker position={[lat, lng]} icon={pinIcon} />
        <Recenter center={[lat, lng]} zoom={16} />
      </MapContainer>
    </div>
  );
}
