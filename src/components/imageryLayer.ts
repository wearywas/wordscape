import * as L from 'leaflet';
import {
  canRequestNaip,
  naipImageUrl,
  USGS_ATTRIBUTION,
  USGS_CREDITS_URL,
  USGS_OVERVIEW_URL,
} from '../world/aerial';

export interface ImageryStatus {
  detail: boolean;
  loading: boolean;
  message: string;
}
/** Online display only. One bounded NAIP image per settled view; no tile harvesting or offline cache. */
export function addUsgsImagery(map: L.Map, onStatus: (status: ImageryStatus) => void): () => void {
  let disposed = false,
    loaded = false,
    detail: L.ImageOverlay | undefined,
    pending: L.ImageOverlay | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let detailTimeout: ReturnType<typeof setTimeout> | undefined;
  const report = (status: ImageryStatus) => {
    if (!disposed) onStatus(status);
  };
  const overview = L.tileLayer(`${USGS_OVERVIEW_URL}/tile/{z}/{y}/{x}`, {
    attribution: `<a href="${USGS_CREDITS_URL}" target="_blank" rel="noopener noreferrer">${USGS_ATTRIBUTION}</a>`,
    maxZoom: 20,
    maxNativeZoom: 16,
    minZoom: 2,
    noWrap: true,
    keepBuffer: 1,
    updateWhenIdle: true,
  });
  overview.on('tileload', () => {
    loaded = true;
    if (!detail && !pending)
      report({
        detail: false,
        loading: false,
        message: 'Overview imagery. Resolution and capture dates vary.',
      });
  });
  overview.on('loading', () => {
    loaded = false;
  });
  overview.on('tileerror', () => {
    if (!loaded && !detail)
      report({
        detail: false,
        loading: false,
        message: 'Online imagery unavailable. Check the connection or use Street map.',
      });
  });
  overview.addTo(map);
  const update = () => {
    if (disposed) return;
    const view = map.getBounds();
    const bounds = {
      west: view.getWest(),
      south: view.getSouth(),
      east: view.getEast(),
      north: view.getNorth(),
    };
    const conus = canRequestNaip(bounds);
    const nativeZoom = conus ? 16 : 8;
    if (overview.options.maxNativeZoom !== nativeZoom) {
      overview.options.maxNativeZoom = nativeZoom;
      overview.redraw();
    }
    if (pending) {
      if (detailTimeout) clearTimeout(detailTimeout);
      // Leaflet unregisters its map listeners in the layer's own `remove` event.
      // Calling off() first deletes that hook and leaves callbacks on a detached layer.
      pending.remove();
      pending.off();
      pending.getElement()?.removeAttribute('src');
      pending = undefined;
    }
    if (!conus || map.getZoom() < 14) {
      detail?.remove();
      detail = undefined;
      report({
        detail: false,
        loading: false,
        message: conus
          ? 'Overview imagery. Zoom in for NAIP detail.'
          : 'Coarse overview imagery; detailed NAIP coverage is limited to the contiguous U.S.',
      });
      return;
    }
    const size = map.getSize();
    const next = L.imageOverlay(
      naipImageUrl(
        bounds,
        size.x * Math.min(devicePixelRatio, 1.5),
        size.y * Math.min(devicePixelRatio, 1.5),
      ),
      view,
      { pane: 'tilePane', zIndex: 3, interactive: false },
    );
    pending = next;
    report({ detail: Boolean(detail), loading: true, message: 'Loading aerial detail…' });
    next.once('load', () => {
      if (disposed || pending !== next) return;
      if (detailTimeout) clearTimeout(detailTimeout);
      detail?.remove();
      detail = next;
      pending = undefined;
      report({
        detail: true,
        loading: false,
        message: 'USDA NAIP aerial imagery · capture dates vary · online reference',
      });
    });
    next.once('error', () => {
      if (disposed || pending !== next) return;
      if (detailTimeout) clearTimeout(detailTimeout);
      next.remove();
      pending = undefined;
      report({
        detail: Boolean(detail),
        loading: false,
        message: detail
          ? 'New aerial detail unavailable; retaining the previous georeferenced view.'
          : 'Aerial detail unavailable; showing the coarser overview when available.',
      });
    });
    detailTimeout = setTimeout(() => {
      if (disposed || pending !== next) return;
      next.remove();
      next.off();
      next.getElement()?.removeAttribute('src');
      pending = undefined;
      report({
        detail: Boolean(detail),
        loading: false,
        message:
          'Aerial detail timed out. Showing available overview imagery; move the map to retry.',
      });
    }, 15000);
    next.addTo(map);
  };
  const schedule = () => {
    if (timer) clearTimeout(timer);
    if (detailTimeout) clearTimeout(detailTimeout);
    timer = setTimeout(update, 240);
  };
  map.on('moveend resize', schedule);
  schedule();
  return () => {
    disposed = true;
    if (timer) clearTimeout(timer);
    if (detailTimeout) clearTimeout(detailTimeout);
    map.off('moveend resize', schedule);
    pending?.remove();
    pending?.off();
    pending?.getElement()?.removeAttribute('src');
    detail?.remove();
    detail?.off();
    overview.remove();
    overview.off();
  };
}
