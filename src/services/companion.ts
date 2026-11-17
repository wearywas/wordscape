import type { GeographicBounds, OverpassResponse } from '../imports/osm';
import type { GeometryRecipe } from '../world/types';

export interface AiStatus {
  codex: {
    available: boolean;
    authenticated: boolean;
    accountType?: string | null;
    planType?: string | null;
    models: { id: string; name?: string; isDefault?: boolean }[];
    isolated: boolean;
  };
  api: { configured: boolean; defaultModel: string };
  busy: boolean;
}
export interface CompanionStatus {
  token: string;
  ai: AiStatus;
  maps: { provider: string; tileUrl: string };
  terrain?: { available: boolean };
}
export interface Extraction {
  format: 'overpass' | 'osm-xml';
  data: OverpassResponse | string;
  sourceUrl: string;
  bounds: GeographicBounds;
  warnings: string[];
  accessed: string;
  cached: boolean;
}
export interface ModelProposal {
  summary: string;
  changes: { objectId: string; description: string; geometry: GeometryRecipe | null }[];
}
export interface ModelResult {
  proposal: ModelProposal;
  provider: 'codex' | 'api';
  model: string;
}

async function responseJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  let result;
  try {
    result = JSON.parse(text);
  } catch {
    throw new Error(
      'The local companion is not available. Start Wordscape with npm run dev (or npm start after building).',
    );
  }
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status}).`);
  return result as T;
}
export function companionStatus(signal?: AbortSignal): Promise<CompanionStatus> {
  return fetch('/api/status', { signal }).then(responseJson<CompanionStatus>);
}
export function companionPost<T>(
  path: string,
  token: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<T> {
  return fetch(`/api/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Wordscape-Token': token },
    body: JSON.stringify(body),
    signal,
  }).then(responseJson<T>);
}
