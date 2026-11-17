import { useEffect, useRef, useState } from 'react';
import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { GeographicBounds } from '../imports/osm';
import './GeographicReference.css';
import { addUsgsImagery } from './imageryLayer';
import type { ImageryStatus } from './imageryLayer';

interface Props {
  latitude: number;
  longitude: number;
  bounds: GeographicBounds;
  tileUrl: string;
  onLocation: (latitude: number, longitude: number) => void;
  surveyedAreas?: { id: string; name: string; bounds: GeographicBounds }[];
}
export function MapSectionPicker({
  latitude,
  longitude,
  bounds,
  tileUrl,
  onLocation,
  surveyedAreas = [],
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const runtime = useRef<{
    map: L.Map;
    box: L.Rectangle;
    center: L.CircleMarker;
    saved: L.LayerGroup;
  } | null>(null);
  const latest = useRef({ onLocation, latitude, longitude, bounds });
  latest.current = { onLocation, latitude, longitude, bounds };
  const [layer, setLayer] = useState<'satellite' | 'street'>('satellite');
  const [status, setStatus] = useState<ImageryStatus>({
    detail: false,
    loading: true,
    message: 'Loading online imagery…',
  });
  useEffect(() => {
    if (!container.current) return;
    const { latitude, longitude, bounds } = latest.current;
    const map = L.map(container.current, {
      center: [latitude, longitude],
      zoom: 17,
      minZoom: 3,
      maxZoom: 20,
      worldCopyJump: false,
    });
    const saved = L.layerGroup().addTo(map);
    const box = L.rectangle(
      [
        [bounds.south, bounds.west],
        [bounds.north, bounds.east],
      ],
      { color: '#3c6455', weight: 2, fillOpacity: 0.12, interactive: false },
    ).addTo(map);
    const center = L.circleMarker([latitude, longitude], {
      radius: 5,
      color: '#fff',
      fillColor: '#3c6455',
      fillOpacity: 1,
      weight: 2,
      interactive: false,
    }).addTo(map);
    map.on('click', (event: L.LeafletMouseEvent) =>
      latest.current.onLocation(event.latlng.lat, event.latlng.lng),
    );
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(container.current);
    runtime.current = { map, box, center, saved };
    return () => {
      observer.disconnect();
      runtime.current = null;
      map.remove();
    };
  }, []);
  useEffect(() => {
    const current = runtime.current;
    if (!current) return;
    if (layer === 'satellite') return addUsgsImagery(current.map, setStatus);
    const streets = L.tileLayer(tileUrl, {
      maxZoom: 20,
      maxNativeZoom: 19,
      noWrap: true,
      keepBuffer: 1,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>',
    }).addTo(current.map);
    return () => {
      streets.remove();
    };
  }, [layer, tileUrl]);
  useEffect(() => {
    const current = runtime.current;
    if (!current) return;
    current.saved.clearLayers();
    for (const area of surveyedAreas.slice(0, 100)) {
      const label = document.createElement('span');
      label.textContent = area.name;
      L.rectangle(
        [
          [area.bounds.south, area.bounds.west],
          [area.bounds.north, area.bounds.east],
        ],
        { color: '#9aa987', weight: 1, opacity: 0.8, dashArray: '4 4', fillOpacity: 0.025 },
      )
        .bindTooltip(label)
        .addTo(current.saved);
    }
    current.box.bringToFront();
    current.center.bringToFront();
    return () => {
      current.saved.clearLayers();
    };
  }, [surveyedAreas]);
  useEffect(() => {
    const current = runtime.current;
    if (!current) return;
    current.box.setBounds([
      [bounds.south, bounds.west],
      [bounds.north, bounds.east],
    ]);
    current.center.setLatLng([latitude, longitude]);
    const selected = current.box.getBounds();
    if (!current.map.getBounds().contains(selected))
      current.map.fitBounds(selected, { padding: [18, 18], maxZoom: 18, animate: false });
  }, [bounds, latitude, longitude]);
  return (
    <div>
      <div className="geo-layer-choice" aria-label="Map picker layer">
        <button
          type="button"
          aria-pressed={layer === 'satellite'}
          onClick={() => setLayer('satellite')}
        >
          Satellite / aerial
        </button>
        <button type="button" aria-pressed={layer === 'street'} onClick={() => setLayer('street')}>
          Street map
        </button>
        {surveyedAreas.length > 0 && <small>Dashed outlines: saved surveys</small>}
      </div>
      <div
        className="area-map"
        ref={container}
        aria-label="Map section picker. Click to move the survey square; drag to explore."
      />
      <p className="geo-picker-note" role="status">
        {layer === 'satellite'
          ? status.message
          : 'Street map · OpenStreetMap features, not an aerial photograph.'}
      </p>
    </div>
  );
}
