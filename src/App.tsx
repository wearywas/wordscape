import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  Archive,
  ArrowUpFromLine,
  Box,
  Check,
  ChevronDown,
  CircleHelp,
  Compass,
  Copy,
  FileJson,
  Layers,
  Map,
  MapPin,
  Mountain,
  NotebookText,
  Minus,
  LockKeyhole,
  Pencil,
  Plus,
  Redo2,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import { washingtonSquare } from './data/washingtonSquare';
import { aerialReferences } from './data/aerialReferences';
import { useWorldHistory } from './hooks/useWorldHistory';
import {
  documentBytes,
  makeObject,
  parseWorld,
  serializeWorld,
  validateWorld,
  migrateWorld,
  updateObject,
  removeObject,
  duplicateObject,
  getDescendants,
  getWorldLimits,
} from './world/document';
import { KIND_COLORS, KIND_LABELS } from './world/types';
import type { ObjectKind, WorldDocument, WorldObject } from './world/types';
import { WordMap } from './components/WordMap';
import { DocumentEditor } from './components/DocumentEditor';
import { Modal } from './components/Modal';
import { ObjectKnowledge } from './components/ObjectKnowledge';
import { SurveyNotebook } from './components/SurveyNotebook';
import { CreationStudio } from './components/CreationStudio';
import { AerialMap } from './components/AerialMap';
import { SurveyLibrary } from './components/SurveyLibrary';
import { useSurveyLibrary } from './hooks/useSurveyLibrary';
import { inferSurveyBounds } from './world/aerial';
import { getObjectBaseElevation, sampleTerrain } from './world/terrain';
import { terrainSlope } from './world/survey';

const WorldScene = lazy(() =>
  import('./components/WorldScene').then((module) => ({ default: module.WorldScene })),
);
const AtlasStudio = lazy(() =>
  import('./components/AtlasStudio').then((module) => ({ default: module.AtlasStudio })),
);
const WorldStudio = lazy(() =>
  import('./components/WorldStudio').then((module) => ({ default: module.WorldStudio })),
);
const WorldExamples = lazy(() =>
  import('./components/WorldExamples').then((module) => ({ default: module.WorldExamples })),
);
const ALL_KINDS = Object.keys(KIND_LABELS) as ObjectKind[];
type View = 'words' | '3d' | 'aerial' | 'document';
type Dialog =
  | 'sources'
  | 'about'
  | 'reset'
  | 'survey'
  | 'create'
  | 'library'
  | 'atlas'
  | 'imagine'
  | 'improve'
  | 'examples'
  | null;

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function App() {
  const { world, update, undo, redo, canUndo, canRedo, saveError } =
    useWorldHistory(washingtonSquare);
  const library = useSurveyLibrary(world);
  const limits = getWorldLimits(world);
  const surveyBounds = useMemo(() => inferSurveyBounds(world), [world]);
  const [view, setView] = useState<View>('words');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [visibleKinds, setVisibleKinds] = useState<ObjectKind[]>(ALL_KINDS);
  const [showLabels, setShowLabels] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [resetKey, setResetKey] = useState(0);
  const [dialog, setDialog] = useState<Dialog>(null);
  const currentContext = useRef({ world, dialog });
  currentContext.current = { world, dialog };
  const [creationTab, setCreationTab] = useState<'area' | 'model'>('area');
  const [completeExisting, setCompleteExisting] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [notice, setNotice] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [terrainEnabled, setTerrainEnabled] = useState(true);
  const [aerialId, setAerialId] = useState<string>('noaa-2022');
  const aerial = aerialReferences.find((reference) => reference.id === aerialId)!;
  const importInput = useRef<HTMLInputElement>(null);
  const selected = world.objects.find((o) => o.id === selectedId);
  const selectedBase = selected ? getObjectBaseElevation(world, selected) : undefined;
  const selectedGround = selected ? sampleTerrain(world, selected.x, selected.y) : undefined;
  const selectedSlope = selected ? terrainSlope(world, selected.x, selected.y) : undefined;
  const validation = useMemo(() => validateWorld(world), [world]);
  const bytes = useMemo(() => documentBytes(world), [world]);
  const filteredObjects = world.objects.filter(
    (object) =>
      (!search ||
        `${object.label} ${object.kind} ${object.description} ${(object.facts ?? []).map((f) => `${f.key} ${f.value ?? ''}`).join(' ')}`
          .toLowerCase()
          .includes(search.toLowerCase())) &&
      visibleKinds.includes(object.kind),
  );
  const hasReference =
    !world.imaginary &&
    world.origin.latitude === washingtonSquare.origin.latitude &&
    world.origin.longitude === washingtonSquare.origin.longitude &&
    world.bounds.width === washingtonSquare.bounds.width &&
    world.bounds.depth === washingtonSquare.bounds.depth;
  const onlineAerial = view === 'aerial' && !hasReference && !!surveyBounds;

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (dialog || target.closest('dialog[open]')) return;
      if (target.matches('input, textarea, select') || target.isContentEditable) return;
      if (isEditing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      }
      if (isEditing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        redo();
      }
      if (event.key === 'Escape') {
        setSelectedId(null);
        setShowAdd(false);
        setExportOpen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undo, redo, isEditing, dialog]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 7000);
    return () => clearTimeout(timer);
  }, [notice]);

  const patchObject = (id: string, patch: Partial<WorldObject>) => {
    if (!isEditing) return;
    try {
      update(updateObject(migrateWorld(world), id, patch));
    } catch (error) {
      setNotice(
        `Change not applied: ${error instanceof Error ? error.message : 'Invalid object change.'}`,
      );
    }
  };
  const commitWorld = (next: WorldDocument): boolean => {
    const { errors } = validateWorld(next);
    if (errors.length) {
      setNotice(`Change not applied: ${errors[0]}`);
      return false;
    }
    update(next);
    return true;
  };
  const openWorld = (next: WorldDocument, nextView: View = 'words', id?: string) => {
    if (!commitWorld(next)) return;
    void library.archive([world, next]).then((saved) => {
      setNotice(
        saved
          ? 'Opened. Both worlds are kept in Saved worlds; Undo is available in Edit mode.'
          : 'Opened, but the library copy could not be saved. Export JSON to keep a backup.',
      );
    });
    setSelectedId(id ?? null);
    setZoom(1);
    setResetKey((key) => key + 1);
    setView(nextView);
    setSearch('');
    setVisibleKinds(ALL_KINDS);
    setIsEditing(false);
    setDialog(null);
  };
  const addObject = (kind: ObjectKind) => {
    if (!isEditing) return;
    if (world.objects.length >= limits.objects) {
      setNotice(`This document supports up to ${limits.objects.toLocaleString()} objects.`);
      return;
    }
    const object = makeObject(kind, world.bounds.width / 2, world.bounds.depth / 2);
    if (world.terrain) {
      object.grounding = 'terrain';
      if (kind === 'building' || kind === 'landmark') object.terrainAnchor = 'highest-footprint';
    }
    if (!commitWorld({ ...migrateWorld(world), objects: [...world.objects, object] })) return;
    setSelectedId(object.id);
    setShowAdd(false);
    setSearch('');
    if (!visibleKinds.includes(kind)) setVisibleKinds([...visibleKinds, kind]);
    if (view === 'document') setView('words');
    setNotice(
      `Added ${KIND_LABELS[kind].toLowerCase()}. Drag its footprint or edit its coordinates.`,
    );
  };
  const removeSelected = () => {
    if (!selected || !isEditing) return;
    const count = getDescendants(world, selected.id).length;
    update(removeObject(world, selected.id));
    setSelectedId(null);
    setNotice(
      `Object${count ? ` and ${count} contained placements` : ''} removed. Undo brings everything back.`,
    );
  };
  const duplicateSelected = () => {
    if (!selected || !isEditing || world.objects.length >= limits.objects) return;
    try {
      const copy = duplicateObject(migrateWorld(world), selected.id);
      update(copy.world);
      setSelectedId(copy.rootId);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not duplicate container.');
    }
  };
  const exportWorld = async (type: 'json' | 'glb') => {
    setExportOpen(false);
    const name =
      world.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 60) || 'world';
    if (type === 'json') {
      download(
        new Blob([serializeWorld(world)], { type: 'application/json' }),
        `${name}.wordscape.json`,
      );
      setNotice('World document exported, including objects, relationships, and sources.');
      return;
    }
    setIsExporting(true);
    try {
      const { exportWorldGlb } = await import('./world/threeAdapter');
      download(await exportWorldGlb(world), `${name}.glb`);
      setNotice('3D world exported as glTF binary.');
    } catch (error) {
      setNotice(
        `Export failed: ${error instanceof Error ? error.message : 'Try exporting the JSON document.'}`,
      );
    } finally {
      setIsExporting(false);
    }
  };
  const importFile = async (file?: File) => {
    if (!file) return;
    try {
      if (file.size > 16 * 1024 * 1024)
        throw new Error('Choose a document no larger than 16 MiB (4 MiB for a single survey).');
      const imported = migrateWorld(parseWorld(await file.text()));
      openWorld(imported);
    } catch (error) {
      setNotice(
        `Import failed: ${error instanceof Error ? error.message : 'Invalid world document.'}`,
      );
    } finally {
      if (importInput.current) importInput.current.value = '';
    }
  };
  const changeView = (next: View) => {
    setView(next);
    setZoom(1);
  };
  const numberField = (
    key: 'x' | 'y' | 'width' | 'depth' | 'height' | 'elevation' | 'rotation' | 'layer',
    label: string,
    max = 1000,
    min = 0,
  ) =>
    selected && (
      <label className="number-field" key={key}>
        <span>{label}</span>
        <div>
          <input
            type="number"
            readOnly={!isEditing}
            aria-label={label}
            value={selected[key]}
            min={min}
            max={max}
            step={key === 'layer' ? 1 : 0.1}
            onChange={(event) => {
              if (!event.target.value) return;
              const value = Number(event.target.value);
              if (
                !Number.isFinite(value) ||
                value < min ||
                value > max ||
                (key === 'layer' && !Number.isInteger(value))
              )
                return;
              if ((key === 'width' || key === 'depth') && selected.footprint) {
                const factor = value / selected[key];
                patchObject(selected.id, {
                  [key]: value,
                  footprint: selected.footprint.map(([x, y]) =>
                    key === 'width' ? [x * factor, y] : [x, y * factor],
                  ),
                });
              } else patchObject(selected.id, { [key]: value });
            }}
          />
          <span>{key === 'rotation' ? '°' : key === 'layer' ? '' : 'm'}</span>
        </div>
      </label>
    );

  return (
    <div className="app-shell">
      <header className="app-header">
        <button className="brand" onClick={() => setDialog('about')} aria-label="About Wordscape">
          <span className="brand-mark">
            <Layers size={23} strokeWidth={1.6} />
          </span>
          <span>
            wordscape<span className="version">Alpha 0.9</span>
          </span>
        </button>
        <div className="header-caption">Portable spatial documents</div>
        <div className="header-actions">
          <button
            className="button create-place-button"
            onClick={() => {
              setCreationTab('area');
              setCompleteExisting(false);
              setDialog('create');
            }}
          >
            <Plus size={16} /> Create a place
          </button>
          <button className="button imagine-button" onClick={() => setDialog('imagine')}>
            <Sparkles size={16} /> Imagine a world
          </button>
          <button className="button examples-button" onClick={() => setDialog('examples')}>
            <Layers size={16} /> Examples
          </button>
          <button className="button library-button" onClick={() => setDialog('library')}>
            <Archive size={16} /> Saved worlds
          </button>
          <span className={`save-state ${saveError ? 'unsaved' : ''}`}>
            <span />
            {saveError ? 'Export to save' : 'Saved on this device'}
          </span>
          <button className="button subtle" onClick={() => importInput.current?.click()}>
            <ArrowUpFromLine size={16} />
            <span>Import</span>
          </button>
          <div className="popover-anchor">
            <button
              className="button primary"
              aria-expanded={exportOpen}
              onClick={() => setExportOpen(!exportOpen)}
              disabled={isExporting}
            >
              <ArrowDownToLine size={16} />
              {isExporting ? 'Exporting…' : 'Export world'}
              <ChevronDown size={13} />
            </button>
            {exportOpen && (
              <div className="popover export-menu">
                <button onClick={() => void exportWorld('json')}>
                  <FileJson size={18} />
                  <span>
                    World document<small>Portable JSON with source evidence</small>
                  </span>
                </button>
                <button onClick={() => void exportWorld('glb')}>
                  <Box size={18} />
                  <span>
                    3D model<small>glTF binary for other 3D tools</small>
                  </span>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>
      <div className="framework-note">
        <p>
          <strong>An open-source alpha for portable worlds.</strong> Objects, placement, evidence
          and terrain travel together in JSON. Three.js is one example interpreter.
        </p>
        <button className="text-button" onClick={() => setDialog('about')}>
          About the framework
        </button>
      </div>
      <section className="project-bar">
        <div className="project-heading">
          <span className="project-icon">
            <MapPin size={19} />
          </span>
          <div>
            <h1>{world.name}</h1>
            <p>
              {world.imaginary
                ? 'An imaginary place · authored'
                : hasReference
                  ? 'San Francisco, California'
                  : 'Your spatial document'}{' '}
              <span className="separator">/</span> {world.bounds.width} × {world.bounds.depth} m{' '}
              {world.imaginary ? 'world' : 'survey'}
            </p>
          </div>
        </div>
        <div className="project-actions">
          <button className="button improve-world-button" onClick={() => setDialog('improve')}>
            <Sparkles size={15} /> Improve this world
          </button>
          {surveyBounds && !world.composition && (
            <button
              className="button complete-survey-button"
              onClick={() => {
                setCreationTab('area');
                setCompleteExisting(true);
                setDialog('create');
              }}
            >
              <Mountain size={15} /> Complete survey
            </button>
          )}
          <button
            className={`button edit-toggle ${isEditing ? 'editing' : ''}`}
            aria-label="Edit mode"
            aria-pressed={isEditing}
            onClick={() => {
              setIsEditing(!isEditing);
              setShowAdd(false);
            }}
          >
            {isEditing ? <Pencil size={15} /> : <LockKeyhole size={15} />}
            {isEditing ? 'Editing · Done' : 'Edit mode'}
          </button>
          <button className="text-button" onClick={() => setDialog('sources')}>
            Survey & sources
          </button>
          <button className="button notebook-button" onClick={() => setDialog('survey')}>
            <NotebookText size={15} /> Terrain & survey
          </button>
          <button
            className="icon-button"
            onClick={() => setDialog('about')}
            aria-label="How Wordscape works"
          >
            <CircleHelp size={18} />
          </button>
        </div>
      </section>
      {hasReference &&
        (!world.terrain || !world.sources.some((source) => source.id === 'osm-extract')) && (
          <div className="survey-update">
            <span>
              Your saved placements are preserved. The latest Washington Square survey adds sourced
              terrain and connected walking paths.
            </span>
            <button className="text-button" onClick={() => setDialog('reset')}>
              Load updated survey
            </button>
          </div>
        )}
      <main className="workbench">
        <aside className="object-panel" aria-label="World objects">
          <div className="panel-title">
            <h2>
              World objects <span>{world.objects.length}</span>
            </h2>
            <div className="popover-anchor">
              <button
                className="icon-button add-button"
                onClick={() => setShowAdd(!showAdd)}
                aria-label="Add object"
                aria-expanded={showAdd}
                disabled={!isEditing}
                title={isEditing ? 'Add object' : 'Turn on Edit mode to add objects'}
              >
                <Plus size={19} />
              </button>
              {showAdd && (
                <div className="popover add-menu">
                  {ALL_KINDS.map((kind) => (
                    <button key={kind} onClick={() => addObject(kind)}>
                      <span className="kind-dot" style={{ background: KIND_COLORS[kind] }} />
                      {KIND_LABELS[kind]}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <label className="search-field">
            <Search size={15} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Find an object…"
              aria-label="Find an object"
            />
            {search && (
              <button onClick={() => setSearch('')} aria-label="Clear search">
                <X size={12} />
              </button>
            )}
          </label>
          <div className="object-list">
            {ALL_KINDS.filter((kind) => filteredObjects.some((o) => o.kind === kind)).map(
              (kind) => (
                <section className="object-group" key={kind}>
                  <div className="group-label">
                    <span className="kind-dot" style={{ background: KIND_COLORS[kind] }} />
                    {KIND_LABELS[kind]}
                    <span>{filteredObjects.filter((o) => o.kind === kind).length}</span>
                  </div>
                  {filteredObjects
                    .filter((o) => o.kind === kind)
                    .map((object) => (
                      <button
                        key={object.id}
                        className={`object-row ${selectedId === object.id ? 'active' : ''}`}
                        aria-pressed={selectedId === object.id}
                        onClick={() => setSelectedId(object.id)}
                      >
                        <span>
                          {object.parentId ? '↳ ' : ''}
                          {object.label}
                        </span>
                        <small>
                          {Math.round(object.width)} × {Math.round(object.depth)}
                        </small>
                      </button>
                    ))}
                </section>
              ),
            )}
            {filteredObjects.length === 0 && (
              <p className="empty-list">
                No visible objects match. Clear your search or enable a layer below.
              </p>
            )}
          </div>
          <div className="layer-controls">
            <div className="layer-heading">
              <Layers size={14} />
              Visible layers
            </div>
            <div className="layer-options">
              {ALL_KINDS.map((kind) => (
                <label key={kind} title={KIND_LABELS[kind]}>
                  <input
                    type="checkbox"
                    checked={visibleKinds.includes(kind)}
                    onChange={() =>
                      setVisibleKinds(
                        visibleKinds.includes(kind)
                          ? visibleKinds.filter((k) => k !== kind)
                          : [...visibleKinds, kind],
                      )
                    }
                  />
                  <span style={{ background: KIND_COLORS[kind] }} />
                  {kind === 'pavement' ? 'Paths' : kind === 'grass' ? 'Green' : KIND_LABELS[kind]}
                </label>
              ))}
            </div>
          </div>
        </aside>
        <section className="canvas-panel" aria-label="World workspace">
          <div className="canvas-toolbar">
            <nav className="view-tabs" aria-label="World view">
              {(
                [
                  { id: 'words', label: 'Words', icon: Map },
                  { id: '3d', label: '3D world', icon: Box },
                  { id: 'aerial', label: 'Aerial', icon: Layers },
                  { id: 'document', label: 'Document', icon: FileJson },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  className={view === tab.id ? 'active' : ''}
                  aria-pressed={view === tab.id}
                  disabled={tab.id === 'aerial' && !!world.imaginary}
                  title={
                    tab.id === 'aerial' && world.imaginary
                      ? 'Imaginary worlds have no geographic aerial reference'
                      : undefined
                  }
                  onClick={() => changeView(tab.id)}
                >
                  <tab.icon size={15} />
                  {tab.label}
                </button>
              ))}
            </nav>
            <div className="history-controls">
              <button
                className="icon-button"
                title="Undo (Ctrl+Z)"
                aria-label="Undo"
                onClick={undo}
                disabled={!canUndo || !isEditing}
              >
                <Undo2 size={16} />
              </button>
              <button
                className="icon-button"
                title="Redo (Ctrl+Shift+Z)"
                aria-label="Redo"
                onClick={redo}
                disabled={!canRedo || !isEditing}
              >
                <Redo2 size={16} />
              </button>
            </div>
          </div>
          <div className={`canvas-stage mode-${view}${onlineAerial ? ' online-aerial' : ''}`}>
            {view === 'document' ? (
              <DocumentEditor
                key={resetKey}
                world={world}
                isEditing={isEditing}
                onApply={(next: WorldDocument) => {
                  if (!isEditing) return;
                  update(migrateWorld(next));
                  setSelectedId(null);
                }}
              />
            ) : (
              <>
                {view === 'aerial' && hasReference && (
                  <div className="aerial-choice">
                    <select
                      aria-label="Aerial reference"
                      value={aerialId}
                      onChange={(event) => setAerialId(event.target.value)}
                    >
                      {aerialReferences.map((reference) => (
                        <option key={reference.id} value={reference.id}>
                          {reference.label}
                        </option>
                      ))}
                    </select>
                    <a href="https://sfplanninggis.org/1938/" target="_blank" rel="noreferrer">
                      City 8 cm viewer
                    </a>
                  </div>
                )}
                {view === '3d' ? (
                  <Suspense fallback={<div className="empty-canvas">Building your world…</div>}>
                    <WorldScene
                      world={world}
                      selectedId={selectedId}
                      onSelect={setSelectedId}
                      visibleKinds={visibleKinds}
                      resetKey={resetKey}
                      terrainEnabled={terrainEnabled}
                      allowWalk
                      interactionBlocked={!!dialog}
                    />
                  </Suspense>
                ) : onlineAerial ? (
                  <AerialMap
                    world={world}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                    visibleKinds={visibleKinds}
                    showLabels={showLabels}
                    resetKey={resetKey}
                  />
                ) : (
                  <WordMap
                    key={`${view}-${resetKey}`}
                    world={world}
                    isEditing={isEditing}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                    visibleKinds={visibleKinds}
                    onMove={(id, x, y) => patchObject(id, { x, y })}
                    aerial={view === 'aerial'}
                    aerialImage={aerial.image}
                    showLabels={showLabels}
                    zoom={zoom}
                    onZoomChange={setZoom}
                    hasReference={hasReference}
                  />
                )}
                <div className="compass" aria-hidden="true">
                  <Compass size={27} strokeWidth={1} />
                  <span>{view === 'aerial' ? 'N ↑' : 'Metre grid'}</span>
                </div>
                <div className="map-controls">
                  {view === '3d' && world.terrain && (
                    <button
                      className={`toggle-label ${terrainEnabled ? 'active' : ''}`}
                      aria-label="Show terrain"
                      aria-pressed={terrainEnabled}
                      onClick={() => setTerrainEnabled(!terrainEnabled)}
                    >
                      <Mountain size={15} />
                      <span>{terrainEnabled ? 'Terrain · true scale' : 'Flat comparison'}</span>
                    </button>
                  )}
                  {view !== '3d' && (
                    <>
                      <button
                        className={showLabels ? 'toggle-label active' : 'toggle-label'}
                        onClick={() => setShowLabels(!showLabels)}
                        aria-pressed={showLabels}
                      >
                        Aa <span>Labels</span>
                      </button>
                      {!onlineAerial && (
                        <div className="zoom-controls">
                          <button
                            aria-label="Zoom out"
                            onClick={() => setZoom((z) => Math.max(0.6, z - 0.2))}
                            disabled={zoom <= 0.6}
                          >
                            <Minus size={15} />
                          </button>
                          <span>{Math.round(zoom * 100)}%</span>
                          <button
                            aria-label="Zoom in"
                            onClick={() => setZoom((z) => Math.min(8, z + (z >= 3 ? 0.5 : 0.2)))}
                            disabled={zoom >= 8}
                          >
                            <Plus size={15} />
                          </button>
                        </div>
                      )}
                    </>
                  )}
                  <button
                    className="fit-button"
                    aria-label="Reset view"
                    title="Reset view"
                    onClick={() => {
                      setZoom(1);
                      setResetKey((k) => k + 1);
                    }}
                  >
                    <RotateCcw size={15} />
                  </button>
                </div>
                <div className="canvas-help">
                  {view === '3d'
                    ? 'Drag to orbit · Scroll to zoom · Right-drag to pan'
                    : isEditing && !onlineAerial
                      ? 'Editing: drag objects · Arrow keys to nudge · Drag empty space to pan'
                      : 'Viewing: drag to pan · Click to inspect · Placements locked'}
                  {view === 'aerial' && hasReference && (
                    <a href={aerial.url} target="_blank" rel="noreferrer">
                      {aerial.attribution}
                    </a>
                  )}
                </div>
              </>
            )}
          </div>
          <div className="canvas-status">
            <span>
              <span className="status-square" />
              {filteredObjects.length} objects visible
            </span>
            <span>
              {view === '3d'
                ? world.terrain
                  ? terrainEnabled
                    ? 'Terrain at 1× vertical scale'
                    : 'Flat preview · exports retain terrain'
                  : 'Local elevation plane'
                : view === 'aerial'
                  ? hasReference
                    ? `North-up · ${aerial.id === 'noaa-2022' ? '2022 / 25 cm' : '2024 / 60 cm'}`
                    : onlineAerial
                      ? 'Online imagery · capture dates vary'
                      : 'No aerial reference'
                  : view === 'document'
                    ? `Wordscape format v${world.version}`
                    : 'Isometric plan · height shown in 3D'}
              <span className="status-spacer" />1 unit = 1 metre
            </span>
          </div>
        </section>
        <aside className="inspector" aria-label="Object inspector">
          <div className="panel-title">
            <h2>{selected ? 'Object details' : 'Inside this world'}</h2>
            <SlidersHorizontal size={16} />
          </div>
          {selected ? (
            <div className="inspector-content">
              <div className="object-kind-heading">
                <span className="kind-dot" style={{ background: KIND_COLORS[selected.kind] }} />
                {KIND_LABELS[selected.kind]}
                <span className={`evidence ${selected.evidence}`}>{selected.evidence}</span>
              </div>
              <label className="field">
                <span>Name</span>
                <input
                  value={selected.label}
                  readOnly={!isEditing}
                  maxLength={120}
                  onChange={(event) => {
                    if (event.target.value.trim())
                      patchObject(selected.id, { label: event.target.value });
                  }}
                />
              </label>
              <label className="field">
                <span>Description</span>
                <textarea
                  value={selected.description}
                  readOnly={!isEditing}
                  maxLength={2000}
                  rows={4}
                  onChange={(event) =>
                    patchObject(selected.id, { description: event.target.value })
                  }
                />
              </label>
              <label className="field">
                <span>Visual category</span>
                <select
                  value={selected.kind}
                  disabled={!isEditing}
                  onChange={(event) =>
                    patchObject(selected.id, { kind: event.target.value as ObjectKind })
                  }
                >
                  {ALL_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {KIND_LABELS[kind]}
                    </option>
                  ))}
                </select>
              </label>
              <p className="field-note">
                {isEditing
                  ? 'Changes mark this placement as authored. Sourced facts retain their own evidence.'
                  : 'Viewing only. Turn on Edit mode to change placement or information.'}
              </p>
              <button
                className="button model-object-button"
                onClick={() => {
                  setCreationTab('model');
                  setDialog('create');
                }}
              >
                <Box size={15} /> Model this object
              </button>
              <ObjectKnowledge
                key={selected.id}
                object={selected}
                world={world}
                isEditing={isEditing}
                onSelect={setSelectedId}
                onPatch={(patch) => patchObject(selected.id, patch)}
                onWorldChange={(next) => {
                  if (isEditing) commitWorld(next);
                }}
              />
              <div className="inspector-section">
                <h3>Position</h3>
                <label className="field">
                  <span>Grounding</span>
                  <select
                    value={selected.grounding ?? 'absolute'}
                    disabled={!isEditing}
                    onChange={(event) => {
                      const grounding = event.target.value as 'absolute' | 'terrain';
                      if (grounding === 'absolute') {
                        if (selectedBase === undefined) {
                          setNotice(
                            'The current base is unknown. In Document, set grounding to absolute and supply an explicit local elevation; no height has been guessed.',
                          );
                          return;
                        }
                        patchObject(selected.id, {
                          grounding,
                          terrainAnchor: undefined,
                          elevation: selectedBase,
                        });
                      } else {
                        const terrainAnchor =
                          selected.kind === 'building' || selected.kind === 'landmark'
                            ? 'highest-footprint'
                            : 'center';
                        const grounded = {
                          ...selected,
                          grounding,
                          terrainAnchor,
                          elevation: 0,
                        } as WorldObject;
                        if (getObjectBaseElevation(world, grounded) === undefined) {
                          setNotice('No terrain observation is available at this position.');
                          return;
                        }
                        patchObject(selected.id, {
                          grounding,
                          terrainAnchor,
                          elevation: 0,
                        });
                      }
                    }}
                  >
                    <option value="absolute">Local elevation</option>
                    <option value="terrain" disabled={!world.terrain}>
                      Follow terrain
                    </option>
                  </select>
                </label>
                {world.terrain && (
                  <p className="field-note">
                    Follow terrain places the base on the sampled ground with zero offset. Local
                    elevation keeps the current base height when detached.
                  </p>
                )}
                {selected.grounding === 'terrain' && (
                  <label className="field">
                    <span>Ground anchor</span>
                    <select
                      value={selected.terrainAnchor ?? 'center'}
                      disabled={!isEditing}
                      onChange={(event) =>
                        patchObject(selected.id, {
                          terrainAnchor: event.target.value as 'center' | 'highest-footprint',
                        })
                      }
                    >
                      <option value="center">Center sample</option>
                      <option value="highest-footprint">Highest ground in footprint</option>
                    </select>
                  </label>
                )}
                <div className="number-grid">
                  {numberField('x', 'East', world.bounds.width)}
                  {numberField('y', 'North', world.bounds.depth)}
                  {numberField(
                    'elevation',
                    selected.grounding === 'terrain' ? 'Ground offset' : 'Local elevation',
                    1000,
                    -100,
                  )}
                  {numberField('rotation', 'Rotation', 360, -360)}
                </div>
                {world.terrain && (
                  <div className="ground-reading">
                    <span>
                      Ground at center
                      <strong>
                        {selectedGround === undefined
                          ? 'Unknown'
                          : `${selectedGround.toFixed(2)} m`}
                      </strong>
                    </span>
                    <span>
                      Sampled slope
                      <strong>
                        {selectedSlope === undefined ? 'Unknown' : `${selectedSlope.toFixed(1)}°`}
                      </strong>
                    </span>
                    <span>
                      Object base, local
                      <strong>
                        {selectedBase === undefined ? 'Unresolved' : `${selectedBase.toFixed(2)} m`}
                      </strong>
                    </span>
                    <p>
                      {world.terrain.verticalDatum}. Local zero = {world.terrain.referenceElevation}{' '}
                      m. Terrain is sampled ground; a level foundation is an interpretation, not a
                      surveyed floor elevation.
                    </p>
                  </div>
                )}
              </div>
              <div className="inspector-section">
                <h3>Footprint & scale</h3>
                <div className="number-grid">
                  {numberField('width', 'Width', 1000, 0.1)}
                  {numberField('depth', 'Depth', 1000, 0.1)}
                  {numberField('height', 'Height', 1000)}
                  {numberField('layer', 'Layer', 100, -100)}
                </div>
                {selected.footprint && (
                  <p className="field-note">
                    Traced polygon · {selected.footprint.length} vertices. Resizing scales its
                    footprint.
                  </p>
                )}
              </div>
              {world.relations.some((r) => r.from === selected.id || r.to === selected.id) && (
                <div className="inspector-section">
                  <h3>Connections</h3>
                  {world.relations
                    .filter((r) => r.from === selected.id || r.to === selected.id)
                    .map((r, i) => (
                      <p className="relation" key={i}>
                        {r.from === selected.id ? r.type : `← ${r.type}`}{' '}
                        <button
                          onClick={() => setSelectedId(r.from === selected.id ? r.to : r.from)}
                        >
                          {
                            world.objects.find(
                              (o) => o.id === (r.from === selected.id ? r.to : r.from),
                            )?.label
                          }
                        </button>
                      </p>
                    ))}
                </div>
              )}
              <div className="inspector-section">
                <h3>Evidence</h3>
                <p className="field-note">
                  {selected.evidence === 'observed'
                    ? 'Plan footprint interpreted from the aerial image. Height and appearance are estimates.'
                    : selected.evidence === 'inferred'
                      ? 'An approximation based on the visible context. Verify before using as a real-world measurement.'
                      : 'Edited or added in this workbench. This object is now an authored interpretation.'}
                </p>
                {selected.sourceId && (
                  <button className="text-button" onClick={() => setDialog('sources')}>
                    View original source
                  </button>
                )}
              </div>
              <div className="object-actions">
                <button
                  className="button"
                  onClick={duplicateSelected}
                  disabled={
                    !isEditing ||
                    world.objects.length + getDescendants(world, selected.id).length + 1 >
                      limits.objects
                  }
                >
                  <Copy size={14} />
                  Duplicate
                </button>
                <button
                  className="icon-button danger"
                  onClick={removeSelected}
                  aria-label="Delete selected object"
                  disabled={!isEditing}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ) : (
            <div className="inspector-content framework-inspector">
              <FileJson size={25} strokeWidth={1.3} />
              <h3>One document, several views</h3>
              <p>Select an object to inspect its placement, facts, sources and editable form.</p>
              <dl>
                <div>
                  <dt>Words</dt>
                  <dd>A spatial map of named objects.</dd>
                </div>
                <div>
                  <dt>3D world</dt>
                  <dd>A procedural Three.js interpretation of the same record.</dd>
                </div>
                <div>
                  <dt>Document</dt>
                  <dd>The portable JSON. Export it for another tool or interpreter.</dd>
                </div>
              </dl>
              <button
                className="button"
                onClick={() =>
                  setSelectedId(
                    world.objects.find((o) => o.kind === 'building')?.id ??
                      world.objects[0]?.id ??
                      null,
                  )
                }
              >
                Inspect an object
              </button>
              <button className="button" onClick={() => changeView('document')}>
                View world document
              </button>
              <p className="framework-evidence-note">
                {world.imaginary
                  ? 'This world is authored fiction. Reference patterns and generated terrain are not observations of a real place.'
                  : hasReference
                    ? 'This survey combines mapped footprints, sourced terrain and explicit estimates. Inspect evidence before treating a detail as measured.'
                    : 'Sources, estimates and authored interpretations retain their own evidence labels.'}
              </p>
            </div>
          )}
        </aside>
      </main>
      <footer className="app-footer">
        {world.sources.some(
          (source) => source.url.includes('openstreetmap.org') || source.id === 'osm-extract',
        ) && (
          <a
            className="osm-credit"
            href="https://www.openstreetmap.org/copyright"
            target="_blank"
            rel="noreferrer"
          >
            © OpenStreetMap contributors
          </a>
        )}
        <div className="document-metrics">
          <FileJson size={15} />
          <strong>{(bytes / 1024).toFixed(1)} KB</strong>
          <span>world document</span>
          <span className="footer-dot" />
          <span>{world.objects.length} objects</span>
          <span className="footer-dot" />
          <span>{world.relations.length} relationships</span>
        </div>
        <div className="footer-right">
          {validation.errors.length > 0 ? (
            <button
              className="text-button warning"
              onClick={() => setNotice(validation.errors.slice(0, 3).join(' '))}
            >
              {validation.errors.length} document errors
            </button>
          ) : validation.warnings.length > 0 ? (
            <button
              className="text-button warning"
              onClick={() => setNotice(validation.warnings.slice(0, 3).join(' '))}
            >
              {validation.warnings.length} spatial notes
            </button>
          ) : (
            <span className="valid-state">
              <Check size={13} />
              Document valid
            </span>
          )}
          <button className="text-button" onClick={() => setDialog('reset')}>
            Restore survey
          </button>
        </div>
      </footer>
      <input
        ref={importInput}
        type="file"
        accept=".json,application/json"
        hidden
        aria-label="Import world document"
        onChange={(event) => void importFile(event.target.files?.[0])}
      />
      {notice && (
        <div className="toast" role="status">
          <span>{notice}</span>
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => setNotice('')}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {dialog === 'create' && (
        <CreationStudio
          world={world}
          selectedId={selectedId}
          initialTab={creationTab}
          completeExisting={completeExisting}
          savedSurveys={library.entries}
          onClose={() => setDialog(null)}
          onApply={(next, id) => {
            openWorld(next, '3d', id);
          }}
        />
      )}
      {(dialog === 'imagine' || dialog === 'improve') && (
        <Suspense
          fallback={
            <Modal
              title={dialog === 'imagine' ? 'Imagine a world' : 'Improve this world'}
              onClose={() => setDialog(null)}
            >
              <p>Opening the world studio…</p>
            </Modal>
          }
        >
          <WorldStudio
            world={world}
            mode={dialog === 'imagine' ? 'create' : 'revise'}
            onClose={() => setDialog(null)}
            onApply={(next) => openWorld(next, '3d')}
          />
        </Suspense>
      )}
      {dialog === 'library' && (
        <SurveyLibrary
          entries={library.entries}
          error={library.error}
          loading={library.loading}
          currentName={world.name}
          onClose={() => setDialog(null)}
          onSave={() => library.archive([world])}
          onCombine={() => setDialog('atlas')}
          onRemove={library.remove}
          onOpen={async (id) => {
            const next = await library.read(id);
            if (
              currentContext.current.dialog !== 'library' ||
              currentContext.current.world !== world
            )
              return;
            openWorld(next);
          }}
          onExport={async (id) => {
            const saved = await library.read(id);
            const name =
              saved.name
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .slice(0, 60) || 'survey';
            download(
              new Blob([serializeWorld(saved)], { type: 'application/json' }),
              `${name}.wordscape.json`,
            );
          }}
        />
      )}
      {dialog === 'atlas' && (
        <Suspense
          fallback={
            <Modal title="Combine surveys" onClose={() => setDialog(null)}>
              <p>Opening the survey composer…</p>
            </Modal>
          }
        >
          <AtlasStudio
            entries={library.entries}
            onRead={library.read}
            onClose={() => setDialog(null)}
            onApply={(next) => openWorld(next, '3d')}
          />
        </Suspense>
      )}
      {dialog === 'survey' && (
        <SurveyNotebook
          world={world}
          onClose={() => setDialog(null)}
          onSelect={setSelectedId}
          onExport={(report) => {
            download(
              new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }),
              'wordscape-survey-notebook.json',
            );
            setNotice(
              'Survey notebook exported with evidence counts, review questions and descriptive patterns.',
            );
          }}
        />
      )}
      {dialog === 'sources' && (
        <Modal
          title={world.imaginary ? 'The ideas behind the words' : 'The survey behind the words'}
          onClose={() => setDialog(null)}
        >
          <p>{world.description}</p>
          <div className="source-facts">
            <span>
              <strong>
                {world.bounds.width} × {world.bounds.depth} m
              </strong>
              Local metre grid
            </span>
            <span>
              <strong>
                {world.imaginary
                  ? 'Imaginary'
                  : `${world.origin.latitude.toFixed(5)}, ${world.origin.longitude.toFixed(5)}`}
              </strong>
              {world.imaginary ? 'No geographic location' : 'Southwest origin'}
            </span>
          </div>
          <p className="field-note">{world.origin.note}</p>
          {hasReference && (
            <>
              <div className="source-aerial-choice">
                <label htmlFor="source-aerial">Compare aerials</label>
                <select
                  id="source-aerial"
                  value={aerialId}
                  onChange={(event) => setAerialId(event.target.value)}
                >
                  {aerialReferences.map((reference) => (
                    <option key={reference.id} value={reference.id}>
                      {reference.label}
                    </option>
                  ))}
                </select>
                <p className="field-note">{aerial.note}</p>
              </div>
              <img
                className="source-image"
                src={aerial.image}
                alt={`${aerial.title}: north-up view of Washington Square and surrounding blocks`}
              />
            </>
          )}
          <div className="sources">
            {world.sources.map((source) => (
              <article key={source.id}>
                <h3>
                  <a href={source.url} target="_blank" rel="noreferrer">
                    {source.title}
                  </a>
                </h3>
                <p>{source.notes}</p>
                <small>
                  {source.attribution} · Accessed {source.accessed}
                </small>
              </article>
            ))}
          </div>
          <p className="modal-callout">
            Facts retain their own evidence and dates. Footprints are simplified, and detailed
            geometry remains an interpretation even when a particular dimension is documented.
          </p>
        </Modal>
      )}
      {dialog === 'examples' && (
        <Suspense
          fallback={
            <Modal title="Example worlds" onClose={() => setDialog(null)}>
              <p>Opening the bundled examples…</p>
            </Modal>
          }
        >
          <WorldExamples
            onClose={() => setDialog(null)}
            onOpen={async (next) => {
              const previous = world;
              if (!(await library.archive([previous, next])))
                throw new Error(
                  'The current world could not be saved. Export its JSON before opening an example.',
                );
              if (
                currentContext.current.world !== previous ||
                currentContext.current.dialog !== 'examples'
              )
                return;
              openWorld(next, '3d');
            }}
          />
        </Suspense>
      )}
      {dialog === 'about' && (
        <Modal title="A portable world document" onClose={() => setDialog(null)}>
          <p>
            Wordscape is an open-source alpha proposal for recording worlds as portable, editable
            JSON. Named objects, metre-based placements, relationships, evidence and optional
            terrain form the shared record. This workbench demonstrates how tools can author and
            interpret it.
          </p>
          <div className="about-flow">
            <span>Survey or author</span>
            <span>→</span>
            <span>World JSON</span>
            <span>→</span>
            <span>Interpreters</span>
          </div>
          <h3>The layout is the contract</h3>
          <p>
            Objects use metre-based positions, footprints, heights, layers, and relationships. Trees
            can sit over lawns; paths can cross a park. The document preserves these overlaps.
          </p>
          <h3>One document, multiple interpretations</h3>
          <p>
            The word map and Three.js scene share one source. Three.js is an example renderer, not
            the format itself. JSON exports preserve the editable record; GLB exports preserve this
            particular 3D interpretation and embed the world document in metadata.
          </p>
          <h3>Knowledge that travels</h3>
          <p>
            Every placement can contain child placements, typed facts and source links. Export a
            container to send its geometry, descendants, evidence and references to another
            world-building agent. Inspiration links are explicitly marked separately from observed
            or sourced facts.
          </p>
          <h3>Measured and authored ground</h3>
          <p>
            Optional terrain grids retain absolute elevations, their vertical datum, capture dates
            and source resolution. Objects can follow the ground or retain a local elevation. The 3D
            view uses true vertical scale; flat comparison changes only the preview. Imaginary
            worlds can also contain explicitly authored terrain. Authoring never turns invented
            elevations into a measured landscape, and surveyed terrain is protected from model
            replacement.
          </p>
          <h3>Try it without a model connection</h3>
          <p>
            Open a bundled example, inspect its objects, switch views, enable Edit mode and export
            JSON. Create a place imports mapped features; Imagine a world and Improve this world use
            an optional connected model. Proposals remain previews until you apply them. Real-world
            source facts stay intact; explicit terrain authoring can reground eligible fictional
            objects.
          </p>
          <div className="modal-actions">
            <button className="button" onClick={() => setDialog('examples')}>
              Explore example worlds
            </button>
            <button
              className="button"
              onClick={() => {
                setDialog(null);
                changeView('document');
              }}
            >
              Inspect the JSON
            </button>
          </div>
          <p className="modal-callout">
            This is an evolving alpha, not a settled standard or a complete scene-reconstruction
            system. The document size excludes interpreters and reference imagery. Keep portable
            JSON backups; saved worlds are local to this browser.
          </p>
        </Modal>
      )}
      {dialog === 'reset' && (
        <Modal title="Load the latest baseline survey?" onClose={() => setDialog(null)}>
          <p>
            This replaces the current document with the latest Washington Square survey. You can
            undo it in Edit mode, or export your current world first.
          </p>
          <div className="modal-actions">
            <button className="button" onClick={() => setDialog(null)}>
              Keep editing
            </button>
            <button
              className="button primary"
              onClick={() => {
                openWorld(migrateWorld(washingtonSquare));
              }}
            >
              Restore survey
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
