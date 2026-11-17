import type { GeographicBounds } from './osm';
import { geographicFrame } from './osm';

export function boundsAround(
  latitude: number,
  longitude: number,
  metres: number,
): GeographicBounds {
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    Math.abs(latitude) >= 85 ||
    Math.abs(longitude) > 180 ||
    !Number.isFinite(metres) ||
    metres < 5 ||
    metres > 1000
  )
    throw new Error(
      'Choose a latitude between −85 and 85, longitude between −180 and 180, and a size of 5–1,000 metres.',
    );
  const r = 6378137,
    scale = Math.cos((latitude * Math.PI) / 180);
  const cy = r * Math.log(Math.tan(Math.PI / 4 + (latitude * Math.PI) / 360));
  const half = metres / (2 * scale);
  const lat = (y: number) => ((2 * Math.atan(Math.exp(y / r)) - Math.PI / 2) * 180) / Math.PI;
  const dx = ((half / r) * 180) / Math.PI;
  const bounds = {
    west: longitude - dx,
    east: longitude + dx,
    south: lat(cy - half),
    north: lat(cy + half),
  };
  geographicFrame(bounds);
  return bounds;
}

export function parseMapLocation(text: string): { latitude: number; longitude: number } {
  const raw = text.trim();
  const coordinate = /^(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)$/.exec(raw);
  const google = /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(raw);
  const osm = /#map=\d+(?:\.\d+)?\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)/.exec(raw);
  const match = coordinate ?? google ?? osm;
  if (!match)
    throw new Error(
      'Paste latitude, longitude or a full map URL containing @latitude,longitude or #map=zoom/latitude/longitude. Short links and place names are not supported yet.',
    );
  const latitude = Number(match[1]),
    longitude = Number(match[2]);
  boundsAround(latitude, longitude, 10);
  return { latitude, longitude };
}
