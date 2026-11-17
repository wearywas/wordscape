import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { MapPin, Sparkles, Box, ArrowRight, LoaderCircle } from 'lucide-react';
import { Modal } from './Modal';
import { MapSectionPicker } from './MapSectionPicker';
import { boundsAround, parseMapLocation } from '../imports/area';
import { convertOsmToWorld, geographicFrame, parseOsmXml } from '../imports/osm';
import type { GeographicBounds, OsmImportDiagnostics, OverpassResponse } from '../imports/osm';
import { companionPost, companionStatus } from '../services/companion';
import type { CompanionStatus, Extraction, ModelResult } from '../services/companion';
import { makeObject, migrateWorld, validateWorld } from '../world/document';
import { applyModelProposal } from '../world/proposals';
import { createGeometryTemplate, GEOMETRY_TEMPLATE_IDS } from '../world/geometryTemplates';
import type { GeometryTemplateId } from '../world/geometryTemplates';
import { KIND_LABELS } from '../world/types';
import type { ObjectKind, WorldDocument, WorldObject } from '../world/types';
import { washingtonSquare } from '../data/washingtonSquare';
import { attachAerialReference, inferSurveyBounds } from '../world/aerial';
import { attachTerrain } from '../imports/terrain';
import type { TerrainExtraction } from '../imports/terrain';
import { addMissingSurveyWater } from '../imports/enrichment';
import type { SavedSurvey } from '../world/surveyLibrary';
import { adjacentBounds } from '../world/atlas';
import type { CardinalDirection } from '../world/atlas';
import './CreationStudioAdjacent.css';

const WorldScene = lazy(() =>
  import('./WorldScene').then((module) => ({ default: module.WorldScene })),
);
const kinds = Object.keys(KIND_LABELS) as ObjectKind[];
const noSelect = () => {};
type Candidate = {
  baseWorld: WorldDocument;
  world: WorldDocument;
  summary: string;
  selectedId?: string;
  diagnostics?: OsmImportDiagnostics;
};
interface Props {
  world: WorldDocument;
  selectedId: string | null;
  initialTab: 'area' | 'model';
  completeExisting?: boolean;
  savedSurveys?: SavedSurvey[];
  onClose: () => void;
  onApply: (world: WorldDocument, selectedId?: string) => void;
}

function objectPreview(world: WorldDocument, id: string): WorldDocument {
  const object = world.objects.find((item) => item.id === id)!;
  const sourceIds = new Set([
    object.sourceId,
    ...(object.facts ?? []).flatMap((fact) => fact.sourceIds ?? []),
    ...(object.references ?? []).map((reference) => reference.sourceId),
  ]);
  const width = Math.max(3, object.width * 1.6, object.height * 0.6),
    depth = Math.max(3, object.depth * 1.6, object.height * 0.6);
  return {
    ...world,
    terrain: undefined,
    aerial: undefined,
    composition: undefined,
    sources: world.sources.filter((source) => sourceIds.has(source.id)),
    bounds: { width, depth },
    relations: [],
    objects: [
      {
        ...object,
        parentId: undefined,
        x: width / 2,
        y: depth / 2,
        elevation: 0,
        grounding: 'absolute',
        terrainAnchor: undefined,
        terrainCorrection: undefined,
      },
    ],
  };
}

export function CreationStudio({
  world,
  selectedId,
  initialTab,
  completeExisting: initiallyComplete = false,
  savedSurveys = [],
  onClose,
  onApply,
}: Props) {
  const [tab, setTab] = useState(initialTab);
  const currentBounds = useMemo(
    () => (world.composition ? undefined : inferSurveyBounds(world)),
    [world],
  );
  const [completeExisting, setCompleteExisting] = useState(initiallyComplete && !!currentBounds);
  const [includeTerrain, setIncludeTerrain] = useState(true);
  const [status, setStatus] = useState<CompanionStatus | null>(null);
  const [companionError, setCompanionError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [pendingCandidate, setCandidate] = useState<Candidate | null>(null);
  // Async proposals are reviewable only against the exact immutable document that produced them.
  const candidate = pendingCandidate?.baseWorld === world ? pendingCandidate : null;
  const [latitude, setLatitude] = useState(37.8008),
    [longitude, setLongitude] = useState(-122.4102);
  const [size, setSize] = useState(360),
    [locationText, setLocationText] = useState('');
  const [name, setName] = useState('My mapped place');
  const [adjacentSelection, setAdjacentSelection] = useState<{
    baseWorld: WorldDocument;
    direction: CardinalDirection;
    bounds: GeographicBounds;
  } | null>(null);
  const adjacency = adjacentSelection?.baseWorld === world ? adjacentSelection : null;
  const [provider, setProvider] = useState<'codex' | 'api'>('codex');
  const [loginUrl, setLoginUrl] = useState('');
  const [prompt, setPrompt] = useState(
    'Create a thoughtful, detailed 3D interpretation of this object using several parts. Preserve its footprint and dimensions.',
  );
  const [targetId, setTargetId] = useState(
    world.objects.some((object) => object.id === selectedId && object.height > 0)
      ? selectedId!
      : 'new',
  );
  const [draft, setDraft] = useState<WorldObject>(() => ({
    ...makeObject('building', world.bounds.width / 2, world.bounds.depth / 2),
    label: 'Imagined pavilion',
    width: 12,
    depth: 12,
    height: 8,
    ...(world.terrain
      ? ({ grounding: 'terrain', terrainAnchor: 'highest-footprint' } as const)
      : {}),
  }));
  const controller = useRef<AbortController | null>(null);
  const boundsResult = useMemo(() => {
    try {
      return { bounds: boundsAround(latitude, longitude, size), error: '' };
    } catch (error) {
      return { bounds: null, error: (error as Error).message };
    }
  }, [latitude, longitude, size]);
  const target =
    targetId === 'new' ? draft : world.objects.find((object) => object.id === targetId);
  const activeBounds = completeExisting
    ? currentBounds
    : (adjacency?.bounds ?? boundsResult.bounds);
  const chooseAdjacent = (direction: CardinalDirection) => {
    if (!currentBounds || busy) return;
    try {
      const bounds = adjacentBounds(currentBounds, direction);
      setAdjacentSelection({ baseWorld: world, direction, bounds });
      setCompleteExisting(false);
      setLatitude((bounds.south + bounds.north) / 2);
      setLongitude((bounds.west + bounds.east) / 2);
      setName(`${world.name.slice(0, 197 - direction.length)} · ${direction}`);
      setCandidate(null);
      setError('');
    } catch (error) {
      setError((error as Error).message);
    }
  };
  const preview = useMemo(
    () =>
      candidate?.selectedId
        ? objectPreview(candidate.world, candidate.selectedId)
        : candidate?.world,
    [candidate],
  );
  const refreshStatus = async () => {
    try {
      const next = await companionStatus();
      setStatus(next);
      setCompanionError('');
      if (next.ai.codex.authenticated) setLoginUrl('');
      return next;
    } catch (error) {
      setCompanionError((error as Error).message);
      return null;
    }
  };
  useEffect(() => {
    const abort = new AbortController();
    companionStatus(abort.signal)
      .then(setStatus)
      .catch((error) => {
        if (!abort.signal.aborted) setCompanionError(error.message);
      });
    return () => {
      abort.abort();
      controller.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (!loginUrl) return;
    const interval = window.setInterval(() => {
      void refreshStatus();
    }, 5000);
    return () => window.clearInterval(interval);
  }, [loginUrl]);
  const run = async (label: string, action: (signal: AbortSignal) => Promise<void>) => {
    const abort = new AbortController();
    controller.current = abort;
    setBusy(label);
    setError('');
    setCandidate(null);
    try {
      await action(abort.signal);
    } catch (error) {
      if (!abort.signal.aborted) setError((error as Error).message);
    } finally {
      if (controller.current === abort) {
        controller.current = null;
        setBusy('');
      }
    }
  };
  const convert = async (
    data: OverpassResponse,
    bounds: GeographicBounds,
    sourceUrl: string,
    accessed: string,
    warnings: string[] = [],
    example = false,
    token?: string,
    signal?: AbortSignal,
  ) => {
    const result = convertOsmToWorld(data, {
      bounds,
      sourceUrl,
      accessed,
      name: example ? 'Washington Square · mapped area' : name || 'Mapped place',
      ...(example
        ? {
            frame: {
              origin: washingtonSquare.origin,
              width: 360,
              depth: 360,
              mercatorScale: Math.cos((37.8008 * Math.PI) / 180),
            },
          }
        : {}),
    });
    result.diagnostics.warnings.unshift(...warnings);
    if (example && washingtonSquare.terrain) {
      result.world.terrain = structuredClone(washingtonSquare.terrain);
      result.world.sources.push(
        ...washingtonSquare.sources.filter(
          (source) => source.id === washingtonSquare.terrain!.sourceId,
        ),
      );
      result.world.objects = result.world.objects.map((object) => ({
        ...object,
        grounding: 'terrain',
        terrainAnchor:
          object.kind === 'building' || object.kind === 'landmark' ? 'highest-footprint' : 'center',
      }));
      result.world.description += ' Includes the retained Washington Square USGS terrain sample.';
      result.diagnostics.warnings = result.diagnostics.warnings.filter(
        (note) => !/terrain|elevation/i.test(note),
      );
    }
    let next = result.world;
    let addedWater = 0;
    if (completeExisting && !example) {
      const completed = addMissingSurveyWater(world, result.world);
      next = completed.world;
      addedWater = completed.added;
    }
    next = attachAerialReference(next, bounds, accessed);
    let terrainNote = next.terrain
      ? 'Retains recorded terrain.'
      : 'No terrain attached; uses a flat preview.';
    if (includeTerrain && !example && token) {
      setBusy('Reading ground elevations…');
      try {
        const extraction = await companionPost<TerrainExtraction>(
          'terrain/extract',
          token,
          { bounds },
          signal,
        );
        next = attachTerrain(next, extraction, { groundObjects: true });
        terrainNote = `${extraction.diagnostics.validSamples.toLocaleString()} sourced elevation samples (${extraction.diagnostics.provider}).`;
        result.diagnostics.warnings = result.diagnostics.warnings.filter(
          (note) => !/No terrain|terrain.*not|flat ground/i.test(note),
        );
        result.diagnostics.warnings.push(...extraction.diagnostics.warnings);
      } catch (error) {
        if (signal?.aborted) throw error;
        result.diagnostics.warnings.push(
          `Terrain retrieval failed: ${(error as Error).message} ${next.terrain ? 'Existing terrain retained.' : 'No terrain values were invented.'}`,
        );
        terrainNote = next.terrain
          ? 'Terrain refresh failed; existing terrain retained.'
          : 'Terrain unavailable; this preview is flat.';
      }
    }
    const errors = validateWorld(next).errors;
    if (errors.length) throw new Error(errors[0]);
    setCandidate({
      baseWorld: world,
      world: next,
      diagnostics: result.diagnostics,
      summary:
        completeExisting && !example
          ? `Preserves ${world.objects.length} existing placements and adds ${addedWater} mapped water surfaces. ${terrainNote} Online aerial reference attached.`
          : `${next.objects.length} mapped placements, with source links and explicit estimates. ${terrainNote} Online aerial reference attached.`,
    });
  };
  const fetchArea = () =>
    run('Reading mapped features…', async (signal) => {
      if (!activeBounds)
        throw new Error(boundsResult.error || 'The open world has no recoverable survey frame.');
      geographicFrame(activeBounds); // Enforce the 1 km network limit, including exact adjacent extents.
      const current = status ?? (await refreshStatus());
      if (!current)
        throw new Error(
          'Start the local companion to fetch a new map section. The saved example works without it.',
        );
      const extracted = await companionPost<Extraction>(
        'maps/extract',
        current.token,
        { bounds: activeBounds },
        signal,
      );
      const data =
        extracted.format === 'osm-xml'
          ? parseOsmXml(extracted.data as string)
          : (extracted.data as OverpassResponse);
      await convert(
        data,
        extracted.bounds,
        extracted.sourceUrl,
        extracted.accessed,
        extracted.warnings,
        false,
        current.token,
        signal,
      );
    });
  const loadExample = () =>
    run('Opening the retained map extract…', async (signal) => {
      const responses = await Promise.all([
        fetch('/reference/washington-square-osm.json', { signal }),
        fetch('/reference/washington-square-osm-manifest.json', { signal }),
      ]);
      if (responses.some((response) => !response.ok))
        throw new Error('The saved map example could not be loaded.');
      const [data, manifest] = await Promise.all(responses.map((response) => response.json()));
      await convert(data, manifest.bounds, manifest.sourceUrl, manifest.accessed, [], true);
    });
  const signIn = async () => {
    setError('');
    try {
      const current = status ?? (await refreshStatus());
      if (!current) throw new Error('Start the local companion before signing in.');
      const result = await companionPost<{ authUrl: string }>('ai/login', current.token, {});
      const url = new URL(result.authUrl);
      if (
        url.protocol !== 'https:' ||
        !(
          url.hostname === 'auth.openai.com' ||
          url.hostname === 'chatgpt.com' ||
          url.hostname.endsWith('.openai.com')
        )
      )
        throw new Error('The companion returned an unexpected sign-in URL.');
      setLoginUrl(url.href);
      window.open(url.href, '_blank', 'noopener,noreferrer');
    } catch (error) {
      setError((error as Error).message);
    }
  };
  const generate = () =>
    run('Building a geometry proposal…', async (signal) => {
      if (!target) throw new Error('Select an object first.');
      const retainedFacts =
        target.facts?.filter(
          (fact) => !['generation.model', 'generation.provider'].includes(fact.key),
        ) ?? [];
      if (retainedFacts.length > 62)
        throw new Error(
          'This object needs two available fact slots for model provenance before generation. Remove or combine facts explicitly first; no model request was sent.',
        );
      const current = status ?? (await refreshStatus());
      if (!current) throw new Error('Start the local companion to connect a model.');
      const base =
        targetId === 'new'
          ? { ...migrateWorld(world), objects: [...world.objects, target] }
          : world;
      const errors = validateWorld(base).errors;
      if (errors.length) throw new Error(errors[0]);
      const result = await companionPost<ModelResult>(
        'ai/generate',
        current.token,
        { provider, prompt, context: { worldName: world.name, objects: [target] } },
        signal,
      );
      const next = applyModelProposal(base, [target], result);
      setCandidate({
        baseWorld: world,
        world: next,
        selectedId: target.id,
        summary: `${result.proposal.summary} (${result.model}; authored interpretation.)`,
      });
    });
  const template = (id: GeometryTemplateId) => {
    setError('');
    const recipe = createGeometryTemplate(id);
    const object = {
      ...makeObject(recipe.kind, world.bounds.width / 2, world.bounds.depth / 2),
      ...recipe,
      description:
        'Authored procedural example. This placement is not a claim about the surveyed site.',
      ...(world.terrain
        ? ({ grounding: 'terrain', terrainAnchor: 'highest-footprint' } as const)
        : {}),
    };
    const next = { ...migrateWorld(world), objects: [...world.objects, object] };
    const errors = validateWorld(next).errors;
    if (errors.length) {
      setError(errors[0]);
      return;
    }
    setCandidate({
      baseWorld: world,
      world: next,
      selectedId: object.id,
      summary: `An editable ${id} made from ${object.geometry.parts.length} geometric parts. Added at the world centre; use Edit mode to position it after applying.`,
    });
  };
  const changeTab = (next: 'area' | 'model') => {
    setTab(next);
    setCandidate(null);
    setError('');
  };
  const canGenerate =
    provider === 'codex' ? status?.ai.codex.authenticated : status?.ai.api.configured;

  return (
    <Modal title="Create a place" className="creation-modal" onClose={onClose}>
      <p className="studio-intro">
        Start with mapped reality. Give individual objects a new interpretation.
      </p>
      <div className="studio-tabs" role="tablist" aria-label="Creation tools">
        <button
          role="tab"
          aria-selected={tab === 'area'}
          disabled={!!busy}
          onClick={() => changeTab('area')}
        >
          <MapPin size={17} /> A mapped area
        </button>
        <button
          role="tab"
          aria-selected={tab === 'model'}
          disabled={!!busy}
          onClick={() => changeTab('model')}
        >
          <Sparkles size={17} /> Model builder
        </button>
      </div>
      <div className="studio-layout">
        <section
          className="studio-controls"
          aria-label={tab === 'area' ? 'Choose a map section' : 'Build an object'}
        >
          {tab === 'area' ? (
            <>
              {currentBounds && (
                <div className="survey-completion-choice">
                  <button
                    className={!completeExisting ? 'active' : ''}
                    disabled={!!busy}
                    onClick={() => {
                      setCompleteExisting(false);
                      setCandidate(null);
                    }}
                  >
                    New area
                  </button>
                  <button
                    className={completeExisting ? 'active' : ''}
                    disabled={!!busy}
                    onClick={() => {
                      setCompleteExisting(true);
                      setAdjacentSelection(null);
                      setCandidate(null);
                    }}
                  >
                    Complete open survey
                  </button>
                </div>
              )}
              {completeExisting && (
                <p className="completion-note">
                  Add terrain, an aerial reference and missing mapped water to{' '}
                  <strong>{world.name}</strong>. Existing objects and authored placement edits are
                  retained; review the result before applying.
                </p>
              )}
              <h3>Every place begins with a coordinate.</h3>
              <p>
                Click the map to place a survey square. Drag to explore. Building footprints,
                streets and other mapped features become a portable world.
              </p>
              {!completeExisting && (
                <>
                  {currentBounds && (
                    <div className="studio-adjacent">
                      <span>Extend from the open survey</span>
                      <div role="group" aria-label="Adjacent survey direction">
                        {(['north', 'east', 'south', 'west'] as const).map((direction) => (
                          <button
                            type="button"
                            key={direction}
                            disabled={!!busy}
                            aria-pressed={adjacency?.direction === direction}
                            onClick={() => chooseAdjacent(direction)}
                          >
                            {direction[0].toUpperCase() + direction.slice(1)}
                          </button>
                        ))}
                      </div>
                      {adjacency && (
                        <p role="status">
                          Exact {adjacency.direction} neighbor of <strong>{world.name}</strong>.
                          Shares the open survey’s edge.{' '}
                          <button
                            type="button"
                            disabled={!!busy}
                            onClick={() => {
                              setAdjacentSelection(null);
                              setCandidate(null);
                            }}
                          >
                            Clear adjacent selection
                          </button>
                        </p>
                      )}
                    </div>
                  )}
                  <div className="studio-location">
                    <input
                      aria-label="Coordinates or map URL"
                      placeholder="Latitude, longitude or full map URL"
                      value={locationText}
                      disabled={!!busy}
                      onChange={(event) => {
                        setLocationText(event.target.value);
                        setAdjacentSelection(null);
                        setCandidate(null);
                      }}
                    />
                    <button
                      className="button"
                      disabled={!!busy}
                      onClick={() => {
                        try {
                          const location = parseMapLocation(locationText);
                          setLatitude(location.latitude);
                          setLongitude(location.longitude);
                          setAdjacentSelection(null);
                          setCandidate(null);
                          setError('');
                        } catch (error) {
                          setError((error as Error).message);
                        }
                      }}
                    >
                      Locate
                    </button>
                  </div>
                  <div className="studio-fields">
                    <label>
                      Latitude
                      <input
                        type="number"
                        step="0.0001"
                        value={latitude}
                        disabled={!!busy}
                        onChange={(event) => {
                          setLatitude(Number(event.target.value));
                          setAdjacentSelection(null);
                          setCandidate(null);
                        }}
                      />
                    </label>
                    <label>
                      Longitude
                      <input
                        type="number"
                        step="0.0001"
                        value={longitude}
                        disabled={!!busy}
                        onChange={(event) => {
                          setLongitude(Number(event.target.value));
                          setAdjacentSelection(null);
                          setCandidate(null);
                        }}
                      />
                    </label>
                    <label>
                      Survey width
                      <select
                        value={adjacency ? 'adjacent' : size}
                        disabled={!!busy}
                        onChange={(event) => {
                          if (event.target.value === 'adjacent') return;
                          setSize(Number(event.target.value));
                          setAdjacentSelection(null);
                          setCandidate(null);
                        }}
                      >
                        {adjacency && (
                          <option value="adjacent">
                            Matched {world.bounds.width.toFixed(0)} ×{' '}
                            {world.bounds.depth.toFixed(0)} m
                          </option>
                        )}
                        {[200, 360, 600, 1000].map((value) => (
                          <option key={value} value={value}>
                            {value} × {value} m
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      World name
                      <input
                        value={name}
                        maxLength={200}
                        disabled={!!busy}
                        onChange={(event) => {
                          setName(event.target.value);
                          setCandidate(null);
                        }}
                      />
                    </label>
                  </div>
                </>
              )}
              {activeBounds ? (
                <MapSectionPicker
                  latitude={(activeBounds.south + activeBounds.north) / 2}
                  longitude={(activeBounds.west + activeBounds.east) / 2}
                  bounds={activeBounds}
                  tileUrl={status?.maps.tileUrl ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'}
                  surveyedAreas={savedSurveys.flatMap((entry) =>
                    entry.bounds ? [{ id: entry.id, name: entry.name, bounds: entry.bounds }] : [],
                  )}
                  onLocation={(lat, lon) => {
                    if (busy || completeExisting) return;
                    setLatitude(Number(lat.toFixed(6)));
                    setLongitude(Number(lon.toFixed(6)));
                    setAdjacentSelection(null);
                    setCandidate(null);
                  }}
                />
              ) : (
                <p className="studio-error">{boundsResult.error}</p>
              )}
              <label className="terrain-import-option">
                <input
                  type="checkbox"
                  checked={includeTerrain}
                  disabled={!!busy}
                  onChange={(event) => {
                    setIncludeTerrain(event.target.checked);
                    setCandidate(null);
                  }}
                />
                <span>
                  Retrieve sourced terrain
                  <small>
                    Uses available elevation data; gaps and source quality remain visible.
                  </small>
                </span>
              </label>
              <div className="studio-actions">
                <button
                  className="button primary"
                  disabled={!!busy || !activeBounds}
                  onClick={() => void fetchArea()}
                >
                  {completeExisting ? 'Preview survey completion' : 'Fetch mapped area'}{' '}
                  <ArrowRight size={16} />
                </button>
                {!completeExisting && (
                  <button
                    className="text-button"
                    disabled={!!busy}
                    onClick={() => void loadExample()}
                  >
                    Try Washington Square example
                  </button>
                )}
              </div>
              <p className="field-note">
                Map coverage varies worldwide. Missing heights receive labelled defaults. Satellite
                imagery is an online reference, with dates and coverage varying by location. No
                aerial-image recognition is performed.
              </p>
            </>
          ) : (
            <>
              <h3>A shape made of instructions.</h3>
              <p>
                Ask a model to compose boxes, cylinders, cones, spheres and extruded polygons. The
                result is editable data that travels with the object.
              </p>
              <label className="studio-full-label">
                Object to interpret
                <select
                  value={targetId}
                  disabled={!!busy}
                  onChange={(event) => {
                    setTargetId(event.target.value);
                    setCandidate(null);
                  }}
                >
                  <option value="new">New imagined object</option>
                  {world.objects
                    .filter((object) => object.height > 0)
                    .map((object) => (
                      <option value={object.id} key={object.id}>
                        {object.label}
                      </option>
                    ))}
                </select>
              </label>
              {targetId === 'new' && (
                <div className="studio-fields">
                  <label className="span-two">
                    Object name
                    <input
                      value={draft.label}
                      maxLength={160}
                      disabled={!!busy}
                      onChange={(event) => setDraft({ ...draft, label: event.target.value })}
                    />
                  </label>
                  {(['width', 'depth', 'height'] as const).map((key) => (
                    <label key={key}>
                      {key[0].toUpperCase() + key.slice(1)} (m)
                      <input
                        type="number"
                        min={0.2}
                        max={100}
                        value={draft[key]}
                        disabled={!!busy}
                        onChange={(event) =>
                          setDraft({ ...draft, [key]: Number(event.target.value) })
                        }
                      />
                    </label>
                  ))}
                </div>
              )}
              {targetId !== 'new' && target && (
                <p className="studio-envelope">
                  Preserves {target.width.toFixed(1)} × {target.depth.toFixed(1)} ×{' '}
                  {target.height.toFixed(1)} m, placement, facts and references.
                </p>
              )}
              <label className="studio-full-label">
                Describe the interpretation
                <textarea
                  rows={4}
                  maxLength={4000}
                  value={prompt}
                  disabled={!!busy}
                  onChange={(event) => setPrompt(event.target.value)}
                />
              </label>
              <div className="studio-connection">
                <label>
                  Model connection
                  <select
                    value={provider}
                    disabled={!!busy}
                    onChange={(event) => setProvider(event.target.value as 'codex' | 'api')}
                  >
                    <option value="codex">ChatGPT subscription · local Codex</option>
                    <option value="api">OpenAI API · separate billing</option>
                  </select>
                </label>
                {provider === 'codex' ? (
                  <>
                    <p>
                      {status?.ai.codex.authenticated
                        ? `Connected to ChatGPT${status.ai.codex.planType ? ` · ${status.ai.codex.planType}` : ''}. Subscription limits apply.`
                        : 'Sign in once for Wordscape’s separate local Codex profile. Your subscription provides the model usage; plan limits apply.'}
                    </p>
                    {!status?.ai.codex.authenticated && (
                      <button
                        className="button"
                        disabled={!!busy || !status?.ai.codex.available}
                        onClick={() => void signIn()}
                      >
                        Sign in with ChatGPT
                      </button>
                    )}
                    {loginUrl && (
                      <p>
                        <a href={loginUrl} target="_blank" rel="noopener noreferrer">
                          Continue official OpenAI sign-in
                        </a>{' '}
                        · Checking for completion…
                      </p>
                    )}
                  </>
                ) : (
                  <p>
                    {status?.ai.api.configured
                      ? `API key configured on the local server. Model: ${status.ai.api.defaultModel}.`
                      : 'Set OPENAI_API_KEY in your local .env file and restart the companion. API usage is billed separately; the key stays on the server.'}
                  </p>
                )}
                <button
                  className="text-button"
                  disabled={!!busy}
                  onClick={() => void refreshStatus()}
                >
                  Check connection
                </button>
              </div>
              <button
                className="button primary"
                disabled={!!busy || !canGenerate || !prompt.trim() || !target}
                onClick={() => void generate()}
              >
                <Sparkles size={16} /> Generate proposal
              </button>
              <p className="field-note">
                Sends your instructions and the selected object’s metadata to OpenAI. Linked photos
                and web pages are not fetched. Geometry is an authored interpretation, with up to 32
                parts; it does not verify real-world facts.
              </p>
              <div className="studio-templates">
                <span>Or start with a local recipe</span>
                {GEOMETRY_TEMPLATE_IDS.map((id) => (
                  <button key={id} disabled={!!busy} onClick={() => template(id)}>
                    <Box size={14} /> {id}
                  </button>
                ))}
              </div>
            </>
          )}
        </section>
        <section className="studio-preview" aria-label="Proposal preview">
          <div className="studio-preview-title">
            <span>Preview before applying</span>
            <small>{candidate ? 'Ready for review' : 'Your current world is saved'}</small>
          </div>
          {busy ? (
            <div className="studio-placeholder">
              <LoaderCircle className="spinning" size={32} />
              <h3>{busy}</h3>
              <p>
                {tab === 'area'
                  ? 'Map and elevation services may take a minute or two. Successful requests are cached.'
                  : 'The model is composing a bounded geometry recipe. This can take a few minutes.'}
              </p>
              <button className="button" onClick={() => controller.current?.abort()}>
                Cancel
              </button>
            </div>
          ) : preview ? (
            <>
              <div className="studio-scene">
                <Suspense fallback={<p>Preparing 3D preview…</p>}>
                  <WorldScene
                    world={preview}
                    selectedId={null}
                    onSelect={noSelect}
                    visibleKinds={kinds}
                  />
                </Suspense>
              </div>
              <p className="studio-summary">{candidate?.summary}</p>
              {candidate?.diagnostics && (
                <>
                  <div className="studio-counts">
                    <span>
                      <strong>{candidate.diagnostics.counts.buildings}</strong>building masses
                    </span>
                    <span>
                      <strong>{candidate.diagnostics.counts.paths}</strong>path segments
                    </span>
                    <span>
                      <strong>{candidate.diagnostics.counts.estimatedHeights}</strong>default
                      heights
                    </span>
                    <span>
                      <strong>{candidate.diagnostics.counts.entrances}</strong>mapped entrances
                    </span>
                  </div>
                  <details className="studio-diagnostics">
                    <summary>Coverage, estimates & omissions</summary>
                    <ul>
                      {candidate.diagnostics.warnings.map((note, index) => (
                        <li key={index}>{note}</li>
                      ))}
                      {candidate.diagnostics.omitted.map((item) => (
                        <li key={item.reason}>
                          {item.count} omitted: {item.reason}
                        </li>
                      ))}
                    </ul>
                  </details>
                  <a
                    className="studio-attribution"
                    href="https://www.openstreetmap.org/copyright"
                    target="_blank"
                    rel="noreferrer"
                  >
                    © OpenStreetMap contributors · ODbL
                  </a>
                </>
              )}
              <div className="studio-apply">
                <button
                  className="button primary"
                  onClick={() => candidate && onApply(candidate.world, candidate.selectedId)}
                >
                  {candidate?.selectedId
                    ? 'Apply to current world'
                    : completeExisting
                      ? 'Apply survey completion'
                      : 'Open this world'}{' '}
                  <ArrowRight size={15} />
                </button>
                <p>
                  {candidate?.selectedId || completeExisting
                    ? 'Adds this interpretation to the world.'
                    : 'Replaces the open world.'}{' '}
                  You can undo in Edit mode.
                </p>
              </div>
            </>
          ) : (
            <div className="studio-placeholder">
              {tab === 'area' ? <MapPin size={34} /> : <Box size={34} />}
              <h3>{tab === 'area' ? 'From a map to a world.' : 'Describe. Preview. Place.'}</h3>
              <p>
                {tab === 'area'
                  ? 'Fetch a small area to inspect the data available there. The retained Washington Square example is ready to try offline.'
                  : 'Generate a new interpretation, or try a local recipe. Review its shape here before adding it to your world.'}
              </p>
            </div>
          )}
          {error && (
            <p className="studio-error" role="alert">
              {error}
            </p>
          )}
          {companionError && (
            <p className="field-note studio-offline">
              {companionError} Saved examples and local recipes are still available.
            </p>
          )}
        </section>
      </div>
    </Modal>
  );
}
