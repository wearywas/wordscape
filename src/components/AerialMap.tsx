import { useEffect, useMemo, useRef, useState } from 'react';
import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './GeographicReference.css';
import { getFootprint } from '../world/geometry';
import { inferSurveyBounds, localToLatLng } from '../world/aerial';
import { KIND_COLORS } from '../world/types';
import type { GeographicBounds, ObjectKind, WorldDocument } from '../world/types';
import { addUsgsImagery } from './imageryLayer';
import type { ImageryStatus } from './imageryLayer';

interface Props {
  world: WorldDocument;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  visibleKinds: ObjectKind[];
  showLabels?: boolean;
  resetKey?: number;
  zoom?: number;
}
export function AerialMap({
  world,
  selectedId,
  onSelect,
  visibleKinds,
  showLabels = true,
  resetKey = 0,
  zoom = 1,
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const runtime = useRef<{ map: L.Map; objects: L.LayerGroup; homeZoom: number } | null>(null);
  const latest = useRef({ onSelect });
  latest.current = { onSelect };
  const [layer, setLayer] = useState<'satellite' | 'street'>('satellite');
  const [status, setStatus] = useState<ImageryStatus>({
    detail: false,
    loading: true,
    message: 'Loading online imagery…',
  });
  const serializedBounds = JSON.stringify(inferSurveyBounds(world));
  const bounds = useMemo(
    () => (serializedBounds ? (JSON.parse(serializedBounds) as GeographicBounds) : undefined),
    [serializedBounds],
  );
  useEffect(() => {
    if (!container.current || !bounds) return;
    const extent = L.latLngBounds([bounds.south, bounds.west], [bounds.north, bounds.east]);
    const map = L.map(container.current, {
      minZoom: 2,
      maxZoom: 20,
      zoomSnap: 0.25,
      worldCopyJump: false,
      maxBounds: extent.pad(2),
      maxBoundsViscosity: 0.7,
    });
    map.fitBounds(extent, { padding: [25, 25], maxZoom: 19 });
    runtime.current = { map, objects: L.layerGroup().addTo(map), homeZoom: map.getZoom() };
    map.on('click', () => latest.current.onSelect(null));
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(container.current);
    return () => {
      observer.disconnect();
      runtime.current = null;
      map.remove();
    };
  }, [bounds]);
  useEffect(() => {
    const current = runtime.current;
    if (!current) return;
    if (layer === 'satellite') return addUsgsImagery(current.map, setStatus);
    const streets = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
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
  }, [bounds, layer]);
  useEffect(() => {
    const current = runtime.current;
    if (!current || !bounds) return;
    current.objects.clearLayers();
    const objects = world.objects
      .filter((object) => visibleKinds.includes(object.kind))
      .sort((a, b) => a.layer - b.layer);
    L.rectangle(
      [
        [bounds.south, bounds.west],
        [bounds.north, bounds.east],
      ],
      { color: '#fff8dd', weight: 1.3, dashArray: '6 5', fill: false, interactive: false },
    ).addTo(current.objects);
    for (const object of objects) {
      const selected = object.id === selectedId;
      const polygon = L.polygon(
        getFootprint(object).map(([x, y]) => localToLatLng(bounds, world.bounds, x, y)),
        {
          color: selected ? '#ffd66b' : KIND_COLORS[object.kind],
          weight: selected ? 3 : 1.1,
          opacity: selected ? 1 : 0.75,
          fillOpacity: selected ? 0.18 : 0.025,
          bubblingMouseEvents: false,
        },
      ).addTo(current.objects);
      polygon.on('click', () => latest.current.onSelect(object.id));
      const label = document.createElement('span');
      label.textContent = object.label;
      polygon.bindTooltip(label, {
        permanent:
          selected ||
          (showLabels && objects.length < 80 && ['landmark', 'grass'].includes(object.kind)),
        direction: 'center',
      });
      const element = polygon.getElement();
      if (element) {
        element.setAttribute('tabindex', '0');
        element.setAttribute('role', 'button');
        element.setAttribute('aria-label', `Select ${object.label}`);
        element.addEventListener('keydown', (event) => {
          if ((event as KeyboardEvent).key === 'Enter' || (event as KeyboardEvent).key === ' ') {
            event.preventDefault();
            latest.current.onSelect(object.id);
          }
        });
      }
      if (selected) polygon.bringToFront();
    }
    return () => {
      current.objects.clearLayers();
    };
  }, [bounds, world, selectedId, visibleKinds, showLabels]);
  useEffect(() => {
    const current = runtime.current;
    if (!current || !bounds) return;
    current.map.fitBounds(
      [
        [bounds.south, bounds.west],
        [bounds.north, bounds.east],
      ],
      { padding: [25, 25], maxZoom: 19, animate: false },
    );
    current.homeZoom = current.map.getZoom();
  }, [bounds, resetKey]);
  useEffect(() => {
    const current = runtime.current;
    if (current)
      current.map.setZoom(current.homeZoom + Math.log2(Math.max(0.25, Math.min(8, zoom))), {
        animate: false,
      });
  }, [bounds, resetKey, zoom]);
  if (!bounds)
    return (
      <div className="geo-aerial-empty">
        This world has no recorded geographic frame for an aerial reference.
      </div>
    );
  return (
    <div className="geo-aerial">
      <div
        ref={container}
        className="geo-aerial-map"
        aria-label="Georeferenced aerial imagery and recorded object footprints"
      />
      <div className="geo-layer-choice geo-aerial-controls" aria-label="Reference map layer">
        <button aria-pressed={layer === 'satellite'} onClick={() => setLayer('satellite')}>
          Satellite / aerial
        </button>
        <button aria-pressed={layer === 'street'} onClick={() => setLayer('street')}>
          Street map
        </button>
      </div>
      <div className="geo-aerial-status" role="status">
        {layer === 'satellite'
          ? status.message
          : 'OpenStreetMap street map · recorded footprint overlay'}
        {layer === 'satellite' && !world.aerial
          ? ' · Derived from the saved import frame; document unchanged.'
          : ''}
      </div>
    </div>
  );
}
