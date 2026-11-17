import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Check, Layers, LoaderCircle, Sparkles } from 'lucide-react';
import { Modal } from './Modal';
import { companionPost, companionStatus } from '../services/companion';
import type { CompanionStatus } from '../services/companion';
import {
  applyWorldGeneration,
  canAuthorTerrain,
  prepareWorldGeneration,
  reviewWorldGeneration,
} from '../world/worldGeneration';
import type {
  WorldGenerationRequest,
  WorldGenerationResult,
  WorldGenerationReview,
} from '../world/worldGeneration';
import { KIND_LABELS } from '../world/types';
import type { ObjectKind, WorldDocument } from '../world/types';
import layoutGuide from '../data/layoutGuide.json';
import { LayoutReferencePicker } from './LayoutReferencePicker';
import type { ReferenceChoice } from './LayoutReferencePicker';
import { LAYOUT_REFERENCE_OPTIONS, selectLayoutReferences } from '../world/layoutReferences';
import type { LayoutPreference } from '../world/layoutReferences';
import { describeWorldLayout } from '../world/layoutReview';
import type { LayoutDescription } from '../world/layoutReview';
import './WorldStudio.css';

const WorldScene = lazy(() =>
  import('./WorldScene').then((module) => ({ default: module.WorldScene })),
);
const kinds = Object.keys(KIND_LABELS) as ObjectKind[];
const noSelect = () => {};
const studyExamples = ['monaco-old-town', 'malbun-village', 'ruggell-fields'].flatMap((id) =>
  layoutGuide.samples.filter((sample) => sample.id === id).map((sample) => sample.label),
);
const routeSamples = layoutGuide.patterns.find((pattern) => pattern.id === 'routes-have-types')
  ?.sampleIds.length;
const guidancePrinciples = [
  ['routes-first', 'Lay out connected routes and shared spaces first.'],
  ['variable-clearances', 'Vary building footprints and spacing deliberately.'],
  ['walkable-openings', 'Keep passage clear; place trees and furniture beside paths.'],
].filter(([id]) =>
  layoutGuide.heuristics.some((rule) => rule.id === id && rule.evidence === 'authored'),
);
const ideas = {
  create: [
    [
      'Canal town',
      'A compact canal town with footbridges, a central gathering square, waterside homes, workshops and small gardens.',
    ],
    [
      'Garden district',
      'A quiet garden district organized around a shared green, winding pedestrian paths, varied homes and a few memorable public buildings.',
    ],
    [
      'Coastal village',
      'An imagined coastal village with a sheltered harbor, a clear promenade, compact streets, a market and a recognizable landmark.',
    ],
  ],
  revise: [
    [
      'Detail buildings',
      'Give existing buildings more distinctive, coherent forms using editable procedural parts. Preserve their footprints, placements and recorded facts.',
    ],
    [
      'Add street furniture',
      'Add a considered set of benches, lamps, planters and other small public-space objects where the existing layout supports them.',
    ],
    [
      'Enrich public spaces',
      'Strengthen the public spaces with authored gathering places, planting and useful connections that fit the existing layout.',
    ],
  ],
} as const;

export interface WorldStudioProps {
  world: WorldDocument;
  mode: 'create' | 'revise';
  onClose: () => void;
  onApply: (world: WorldDocument) => void;
}
interface Candidate {
  baseWorld: WorldDocument;
  request: WorldGenerationRequest;
  result: WorldGenerationResult;
  review: WorldGenerationReview;
  layoutDescription: LayoutDescription;
  terrainRange: { min: number; max: number } | null;
}

function localTerrainRange(world: WorldDocument) {
  if (!world.terrain) return null;
  let min = Infinity,
    max = -Infinity;
  for (const elevation of world.terrain.heights) {
    if (elevation === null) continue;
    const height = elevation - world.terrain.referenceElevation;
    min = Math.min(min, height);
    max = Math.max(max, height);
  }
  return Number.isFinite(min) ? { min, max } : null;
}

export function WorldStudio({ world, mode, onClose, onApply }: WorldStudioProps) {
  const [prompt, setPrompt] = useState('');
  const [size, setSize] = useState<180 | 360 | 720>(360);
  const [layout, setLayout] = useState<LayoutPreference>('contextual');
  const [terrainMode, setTerrainMode] = useState<'preserve' | 'author'>(
    mode === 'create' ? 'author' : 'preserve',
  );
  const [referenceMode, setReferenceMode] = useState<ReferenceChoice>('auto');
  const [manualReferenceIds, setManualReferenceIds] = useState<string[]>([]);
  const [provider, setProvider] = useState<'codex' | 'api'>('codex');
  const [status, setStatus] = useState<CompanionStatus | null>(null);
  const [connectionError, setConnectionError] = useState('');
  const [loginUrl, setLoginUrl] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState<Candidate | null>(null);
  const candidate = pending?.baseWorld === world && pending.request.mode === mode ? pending : null;
  const mounted = useRef(true);
  const currentWorld = useRef(world);
  const lastContext = useRef({ world, mode });
  const serial = useRef(0);
  const generation = useRef<AbortController | null>(null);
  const connection = useRef<AbortController | null>(null);
  const login = useRef<AbortController | null>(null);
  currentWorld.current = world;
  const revise = mode === 'revise';
  const terrainAllowed = !revise || canAuthorTerrain(world);
  const authorTerrain = terrainAllowed && terrainMode === 'author';
  const referenceIds =
    referenceMode === 'auto' ? undefined : referenceMode === 'none' ? [] : manualReferenceIds;
  const selection = useMemo(
    () =>
      selectLayoutReferences({
        prompt,
        layout,
        referenceIds:
          referenceMode === 'auto' ? undefined : referenceMode === 'none' ? [] : manualReferenceIds,
        ...(revise ? { world } : {}),
      }),
    [prompt, layout, referenceMode, manualReferenceIds, revise, world],
  );
  const referencesReady = referenceMode !== 'manual' || manualReferenceIds.length > 0;

  const refreshStatus = useCallback(async () => {
    connection.current?.abort();
    const abort = new AbortController();
    connection.current = abort;
    try {
      const next = await companionStatus(abort.signal);
      if (abort.signal.aborted || !mounted.current) return null;
      setStatus(next);
      setConnectionError('');
      if (next.ai.codex.authenticated) setLoginUrl('');
      return next;
    } catch (error) {
      if (!abort.signal.aborted && mounted.current) setConnectionError((error as Error).message);
      return null;
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refreshStatus();
    return () => {
      mounted.current = false;
      generation.current?.abort();
      connection.current?.abort();
      login.current?.abort();
    };
  }, [refreshStatus]);
  useEffect(() => {
    if (!loginUrl) return;
    const interval = window.setInterval(() => void refreshStatus(), 5000);
    return () => window.clearInterval(interval);
  }, [loginUrl, refreshStatus]);
  useEffect(() => {
    if (lastContext.current.world === world && lastContext.current.mode === mode) return;
    lastContext.current = { world, mode };
    serial.current++;
    generation.current?.abort();
    generation.current = null;
    setBusy(false);
    setPending(null);
    setTerrainMode(mode === 'create' ? 'author' : 'preserve');
    setNotice('The open world changed. Generate a fresh proposal for this version.');
  }, [world, mode]);

  const invalidate = () => {
    setPending(null);
    setError('');
    setNotice('');
  };
  const signIn = async () => {
    const abort = new AbortController();
    login.current = abort;
    setConnecting(true);
    setError('');
    try {
      const current = status ?? (await refreshStatus());
      if (!current) throw new Error('Start the local companion before signing in.');
      const result = await companionPost<{ authUrl: string }>(
        'ai/login',
        current.token,
        {},
        abort.signal,
      );
      if (abort.signal.aborted || !mounted.current) return;
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
      if (!abort.signal.aborted && mounted.current) setError((error as Error).message);
    } finally {
      if (!abort.signal.aborted && mounted.current) setConnecting(false);
    }
  };

  const generate = async () => {
    const requestId = ++serial.current;
    const baseWorld = world;
    const abort = new AbortController();
    generation.current?.abort();
    generation.current = abort;
    setBusy(true);
    invalidate();
    try {
      const request = prepareWorldGeneration({
        provider,
        prompt,
        mode,
        layout,
        terrainMode: authorTerrain ? 'author' : 'preserve',
        ...(referenceIds === undefined ? {} : { referenceIds }),
        ...(revise ? { world: baseWorld } : { size }),
      });
      const current = status ?? (await refreshStatus());
      if (abort.signal.aborted || requestId !== serial.current) return;
      if (!current) throw new Error('Start the local companion to connect a model.');
      if (provider === 'codex' ? !current.ai.codex.authenticated : !current.ai.api.configured)
        throw new Error('Connect the selected model provider before generating.');
      const result = await companionPost<WorldGenerationResult>(
        'ai/world',
        current.token,
        request,
        abort.signal,
      );
      if (
        abort.signal.aborted ||
        !mounted.current ||
        requestId !== serial.current ||
        currentWorld.current !== baseWorld
      )
        return;
      const review = reviewWorldGeneration(request, result);
      setPending({
        baseWorld,
        request,
        result,
        review,
        layoutDescription: describeWorldLayout(review.world),
        terrainRange: localTerrainRange(review.world),
      });
    } catch (error) {
      if (!abort.signal.aborted && mounted.current && requestId === serial.current)
        setError((error as Error).message);
    } finally {
      if (mounted.current && requestId === serial.current) {
        generation.current = null;
        setBusy(false);
      }
    }
  };
  const cancel = () => {
    serial.current++;
    generation.current?.abort();
    generation.current = null;
    setBusy(false);
    setNotice('Generation cancelled. Your open world is unchanged.');
  };
  const apply = () => {
    if (!candidate || candidate.baseWorld !== currentWorld.current) return;
    try {
      const next = applyWorldGeneration(currentWorld.current, candidate.request, candidate.result);
      onApply(next);
    } catch (error) {
      setError((error as Error).message);
      setPending(null);
    }
  };
  const connected =
    provider === 'codex' ? status?.ai.codex.authenticated : status?.ai.api.configured;
  const disabled = busy || connecting;

  return (
    <Modal
      title={revise ? 'Improve this world' : 'Imagine a world'}
      className="world-studio-modal"
      onClose={onClose}
    >
      <p className="world-studio-intro">
        {revise ? (
          <>
            Give <strong>{world.name}</strong> richer forms and new authored places. Review the
            proposal before changing the document.
          </>
        ) : (
          'Describe a place, or leave room for surprise. Preview a complete miniature world before opening it.'
        )}
      </p>
      <div className="world-studio-layout">
        <section
          className="world-studio-form"
          aria-label={revise ? 'World improvement brief' : 'Imaginary world brief'}
        >
          <span className="world-studio-kicker">
            {revise ? 'ANOTHER LAYER OF INTERPRETATION' : 'A PLACE THAT STARTS WITH WORDS'}
          </span>
          <label className="world-studio-field">
            <span>
              {revise ? 'What would you like to improve?' : 'What kind of place do you imagine?'}{' '}
              <small>Optional</small>
            </span>
            <textarea
              rows={5}
              maxLength={4000}
              value={prompt}
              disabled={disabled}
              placeholder={
                revise
                  ? 'Add public spaces, enrich building forms, or let the model suggest a useful next step…'
                  : 'A canal town, a garden neighborhood, a place from a story…'
              }
              onChange={(event) => {
                setPrompt(event.target.value);
                invalidate();
              }}
            />
          </label>
          <div className="world-studio-ideas" aria-label="Brief starting points">
            {ideas[mode].map(([label, brief]) => (
              <button
                type="button"
                key={label}
                disabled={disabled}
                onClick={() => {
                  setPrompt(brief);
                  invalidate();
                }}
              >
                {label}
              </button>
            ))}
          </div>
          {!revise && (
            <label className="world-studio-field">
              <span>World size</span>
              <select
                value={size}
                disabled={disabled}
                onChange={(event) => {
                  setSize(Number(event.target.value) as 180 | 360 | 720);
                  invalidate();
                }}
              >
                <option value={180}>180 × 180 m · a small place</option>
                <option value={360}>360 × 360 m · a neighborhood</option>
                <option value={720}>720 × 720 m · a larger district</option>
              </select>
            </label>
          )}
          <div className="world-studio-terrain-option">
            {terrainAllowed ? (
              <label>
                <input
                  type="checkbox"
                  checked={authorTerrain}
                  disabled={disabled}
                  onChange={(event) => {
                    setTerrainMode(event.target.checked ? 'author' : 'preserve');
                    invalidate();
                  }}
                />
                <span>
                  <strong>
                    {revise ? 'Author or replace terrain' : 'Include authored terrain'}
                  </strong>
                  <small>
                    {revise
                      ? 'Explicitly allow fictional ground to change. Eligible authored objects follow the new ground vertically; their plan positions stay fixed. Water remains flat. Review slopes, foundations and shorelines.'
                      : 'Let the model shape actual ground elevations to suit the brief. These are authored heights, not surveyed data; the result may be flat when appropriate.'}
                  </small>
                </span>
              </label>
            ) : (
              <p>
                <strong>Recorded terrain is protected.</strong> This world’s ground and vertical
                placements will be preserved. Surveyed or unmarked terrain and terrain-grounded
                source objects are protected. Eligible imaginary worlds can author new ground.
              </p>
            )}
            {!authorTerrain && terrainAllowed && (
              <p>
                {revise
                  ? 'Existing ground and vertical placements will be preserved.'
                  : 'This new world will use a flat ground plane.'}
              </p>
            )}
          </div>
          <label className="world-studio-field">
            <span>Layout character {revise && <small>For new additions</small>}</span>
            <select
              value={layout}
              disabled={disabled}
              onChange={(event) => {
                setLayout(event.target.value as LayoutPreference);
                invalidate();
              }}
            >
              <option value="contextual">Follow the brief</option>
              <option value="clustered">Clustered · varied spaces and routes</option>
              <option value="planned">Planned · ordered blocks and streets</option>
              <option value="open">Open · dispersed places and clearings</option>
            </select>
          </label>
          {revise && (
            <p className="world-studio-disclosure">
              Layout guidance applies to additions; existing plan positions are preserved.
            </p>
          )}
          <LayoutReferencePicker
            mode={referenceMode}
            selectedIds={selection.referenceIds}
            disabled={disabled}
            onModeChange={(next) => {
              if (next === 'manual' && referenceMode === 'auto')
                setManualReferenceIds(selection.referenceIds);
              setReferenceMode(next);
              invalidate();
            }}
            onIdsChange={(ids) => {
              setManualReferenceIds(ids);
              invalidate();
            }}
          />
          {!referencesReady && (
            <p className="world-studio-disclosure">
              Choose one or two references, or select “None” to continue without examples.
            </p>
          )}
          <div className="world-studio-scope">
            <Layers size={17} aria-hidden="true" />
            <p>
              {revise ? (
                <>
                  Up to 60 authored additions and 12 existing descriptions or forms updated.
                  Recorded facts, sources and plan positions stay intact.
                  {authorTerrain && ' Eligible fictional objects may be regrounded vertically.'}
                </>
              ) : (
                <>
                  20–60 authored objects, with paths, buildings and shared spaces. This is an
                  imaginary world without a real geographic location.
                </>
              )}
            </p>
          </div>
          <details className="world-studio-guidance">
            <summary>Layout guidance · {layoutGuide.sampleCount} real places</summary>
            <p>
              A selected OpenStreetMap study spans urban blocks, waterfronts, villages and rural
              edges. Examples include {studyExamples.join(', ')}.
            </p>
            <p>
              <strong>Measured patterns.</strong> Building footprint sizes and spacing vary across
              the samples.
              {routeSamples !== undefined &&
                ` ${routeSamples} of ${layoutGuide.sampleCount} contain both mapped motor roads and pedestrian or cycle paths.`}
            </p>
            <strong className="world-studio-guidance-label">Authored design principles</strong>
            <ul>
              {guidancePrinciples.map(([id, principle]) => (
                <li key={id}>{principle}</li>
              ))}
            </ul>
            <p>
              These findings and rules enter the model’s prompt as guidance. The selected cases have
              incomplete mapped coverage.
            </p>
            <div className="world-studio-study-links">
              <a
                href="/reference/layout-study/contact-sheet.png"
                target="_blank"
                rel="noopener noreferrer"
              >
                View the contact sheet
              </a>
              <a
                href="/reference/layout-study/manifest.json"
                target="_blank"
                rel="noopener noreferrer"
              >
                Inspect the source manifest
              </a>
            </div>
            <small>
              {layoutGuide.sourceLicense.attribution} · Guide {layoutGuide.version}
            </small>
          </details>
          <div className="world-studio-connection">
            <label className="world-studio-field">
              <span>Model connection</span>
              <select
                value={provider}
                disabled={disabled}
                onChange={(event) => {
                  setProvider(event.target.value as 'codex' | 'api');
                  invalidate();
                }}
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
                    : 'Sign in to Wordscape’s separate local Codex profile. Your subscription supplies the model usage; plan limits apply.'}
                </p>
                {!status?.ai.codex.authenticated && (
                  <button
                    className="button"
                    type="button"
                    disabled={disabled || !status?.ai.codex.available}
                    onClick={() => void signIn()}
                  >
                    {connecting ? 'Opening sign-in…' : 'Sign in with ChatGPT'}
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
                  ? `API key configured on the local server. Model: ${status.ai.api.defaultModel}. Usage is billed separately.`
                  : 'Set OPENAI_API_KEY in the local .env file and restart the companion. API usage is billed separately; the key stays on the server.'}
              </p>
            )}
            {status?.ai.busy && !busy && (
              <p>
                A model request is already running. Check the connection again when it finishes.
              </p>
            )}
            <button
              className="text-button"
              type="button"
              disabled={disabled}
              onClick={() => void refreshStatus()}
            >
              Check connection
            </button>
            {connectionError && (
              <p className="world-studio-connection-error" role="status">
                {connectionError}
              </p>
            )}
          </div>
          <button
            className="button primary world-studio-generate"
            type="button"
            disabled={disabled || !connected || status?.ai.busy || !referencesReady}
            onClick={() => void generate()}
          >
            {busy ? (
              <LoaderCircle size={16} className="spinning" aria-hidden="true" />
            ) : (
              <Sparkles size={16} aria-hidden="true" />
            )}
            {busy
              ? 'Generating…'
              : candidate
                ? 'Generate another proposal'
                : revise
                  ? 'Generate improvements'
                  : 'Generate world'}
          </button>
          <p className="world-studio-disclosure">
            {revise
              ? 'Sends your brief, layout preference, selected reference metrics and small geometry contexts, world name and bounds, the general guide, bounded object summaries with resolved bases, and a coarse 9 × 9 terrain summary when present to OpenAI. Your complete document, full terrain grid, source records, linked references and images stay with the local companion.'
              : 'Sends your brief, requested size, layout preference, general guide, and selected reference metrics and small geometry contexts to OpenAI. Reference images and full reference worlds are not sent.'}
          </p>
          {notice && (
            <p className="world-studio-notice" role="status">
              {notice}
            </p>
          )}
          {error && (
            <p className="world-studio-error" role="alert">
              {error}
            </p>
          )}
        </section>
        <section className="world-studio-review" aria-label="World proposal preview">
          <div className="world-studio-preview-heading">
            <span>PREVIEW BEFORE APPLYING</span>
            <small>
              {candidate ? 'Ready for review' : busy ? 'Model working' : 'Your open world is saved'}
            </small>
          </div>
          {busy ? (
            <div className="world-studio-empty" aria-live="polite">
              <LoaderCircle size={34} className="spinning" />
              <h3>{revise ? 'Considering the next layer…' : 'Giving the world a shape…'}</h3>
              <p>
                The model is planning a layout and composing editable objects. This can take a few
                minutes.
              </p>
              <button className="button" type="button" onClick={cancel}>
                Cancel generation
              </button>
            </div>
          ) : candidate ? (
            <>
              <div className="world-studio-scene">
                <Suspense fallback={<p>Preparing the 3D preview…</p>}>
                  <WorldScene
                    world={candidate.review.world}
                    selectedId={null}
                    onSelect={noSelect}
                    visibleKinds={kinds}
                  />
                </Suspense>
              </div>
              <h3 className="world-studio-world-name">{candidate.review.world.name}</h3>
              <p className="world-studio-summary">{candidate.result.proposal.summary}</p>
              <div className="world-studio-counts">
                <span>
                  <strong>{candidate.review.addedIds.length}</strong>authored additions
                </span>
                <span>
                  <strong>{candidate.review.changedIds.length}</strong>existing objects updated
                </span>
                <span>
                  <strong>{candidate.review.world.objects.length}</strong>objects in the result
                </span>
              </div>
              <section className="world-studio-layout-review" aria-label="Layout measurements">
                <h4>Plan measurements</h4>
                <div className="world-studio-layout-metrics">
                  <span>
                    <strong>
                      {(candidate.layoutDescription.buildingCoverageRatio * 100).toFixed(1)}%
                    </strong>
                    summed building coverage
                  </span>
                  <span>
                    <strong>
                      {candidate.layoutDescription.nearestBuildingGapM
                        ? `${candidate.layoutDescription.nearestBuildingGapM.median.toFixed(1)} m`
                        : '—'}
                    </strong>
                    median nearest building-edge gap
                  </span>
                  <span>
                    <strong>{candidate.layoutDescription.buildingCount}</strong>buildings across the
                    result
                  </span>
                </div>
                <p>
                  Descriptive, not a quality score. Coverage sums footprints and can count overlaps
                  twice. Gaps use{' '}
                  {candidate.layoutDescription.gapSampled
                    ? `${candidate.layoutDescription.gapSampleCount} sampled buildings`
                    : 'all buildings'}
                  .
                </p>
                <details>
                  <summary>Measurement definitions and limits</summary>
                  <ul>
                    {candidate.layoutDescription.notes.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                </details>
              </section>
              <div className="world-studio-used-references">
                <strong>Reference context used</strong>
                <p>
                  {candidate.result.referenceIds === undefined
                    ? 'This response does not report its concrete references.'
                    : candidate.result.referenceIds.length === 0
                      ? 'No concrete examples; the general guide only.'
                      : candidate.result.referenceIds
                          .map(
                            (id) =>
                              LAYOUT_REFERENCE_OPTIONS.find((option) => option.id === id)?.name ??
                              id,
                          )
                          .join(' · ')}
                </p>
                <small>
                  Spatial inspiration only. Generated objects are authored interpretations.
                </small>
              </div>
              <section className="world-studio-terrain-review" aria-label="Terrain proposal">
                <h4>
                  {candidate.review.terrainChanged
                    ? 'Authored terrain preview'
                    : candidate.review.world.terrain
                      ? 'Existing terrain retained'
                      : 'Flat ground'}
                </h4>
                {candidate.terrainRange && (
                  <p>
                    <strong>
                      {candidate.terrainRange.min.toFixed(1)}–
                      {candidate.terrainRange.max.toFixed(1)} m
                    </strong>{' '}
                    ground elevation in the local height frame ·{' '}
                    <strong>
                      {(candidate.terrainRange.max - candidate.terrainRange.min).toFixed(1)} m
                    </strong>{' '}
                    relief.
                  </p>
                )}
                {candidate.review.terrainChanged ? (
                  <>
                    <p>
                      {candidate.review.regroundedIds.length} existing objects regrounded vertically
                      · {candidate.review.preservedGroundingIds.length} protected vertical
                      placements retained.
                    </p>
                    <p>
                      Invented ground, shown at true scale. Inspect access, slope transitions,
                      foundations and flat-water shorelines before applying.
                    </p>
                  </>
                ) : (
                  <p>No terrain change is proposed.</p>
                )}
              </section>
              <details className="world-studio-input">
                <summary>What the model received</summary>
                <p>
                  {candidate.result.provider === 'codex' ? 'ChatGPT / local Codex' : 'OpenAI API'} ·{' '}
                  {candidate.result.model}
                  <br />
                  Layout guide {candidate.result.guideVersion}. Terrain{' '}
                  {candidate.request.terrainMode === 'author'
                    ? 'authoring enabled'
                    : 'preservation requested'}
                  .{' '}
                  {revise
                    ? `${candidate.result.context.includedObjects} existing objects included; ${candidate.result.context.omittedObjects} omitted from the model context.`
                    : 'Brief and requested world size.'}
                </p>
              </details>
              {candidate.review.warnings.length > 0 && (
                <details className="world-studio-warnings" open>
                  <summary>Review notes · {candidate.review.warnings.length}</summary>
                  <ul>
                    {candidate.review.warnings.map((warning, index) => (
                      <li key={index}>{warning}</li>
                    ))}
                  </ul>
                </details>
              )}
              <div className="world-studio-apply">
                <p>
                  <Check size={15} aria-hidden="true" />
                  Authored interpretation. Generation does not verify real-world observations.
                </p>
                <button className="button primary" type="button" onClick={apply}>
                  {revise ? 'Apply improvements' : 'Open imagined world'}
                  <ArrowRight size={16} />
                </button>
                <small>
                  {revise
                    ? `Applies the reviewed additions and form changes${candidate.review.terrainChanged ? ', authored terrain and disclosed vertical regrounding' : ''}.`
                    : 'Replaces the open world with this preview.'}{' '}
                  You can undo in Edit mode.
                </small>
              </div>
            </>
          ) : (
            <div className="world-studio-empty">
              <div className="world-studio-placeholder" aria-hidden="true">
                <span />
                <span />
                <span />
                <span />
                <span />
              </div>
              <h3>{revise ? 'A world can keep growing.' : 'A whole place, from a few words.'}</h3>
              <p>
                {revise
                  ? 'Keep the existing record and explore another authored interpretation. Your proposal will appear here.'
                  : 'The shared guide gives the model a starting structure. Your brief gives the place its character.'}
              </p>
            </div>
          )}
        </section>
      </div>
    </Modal>
  );
}
