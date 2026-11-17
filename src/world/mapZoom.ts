/** Wheel units are browser-dependent; normalize to CSS pixels before applying a zoom rate. */
export function normalizeWheelDelta(delta: number, mode: number, pageHeight: number): number {
  return delta * (mode === 1 ? 16 : mode === 2 ? Math.max(pageHeight, 1) : 1);
}

/** Keep the anchor in the same screen position while changing the SVG viewBox scale. */
export function zoomMapAtPoint(
  zoom: number,
  center: [number, number],
  anchor: [number, number],
  deltaPixels: number,
): { zoom: number; center: [number, number] } {
  const next = Math.min(
    8,
    Math.max(0.6, zoom * Math.exp(-Math.max(-1000, Math.min(1000, deltaPixels)) * 0.0015)),
  );
  const ratio = zoom / next;
  return {
    zoom: next,
    center: [
      anchor[0] + (center[0] - anchor[0]) * ratio,
      anchor[1] + (center[1] - anchor[1]) * ratio,
    ],
  };
}
