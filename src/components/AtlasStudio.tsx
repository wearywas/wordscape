import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { ArrowRight, Layers, Mountain } from 'lucide-react';
import { Modal } from './Modal';
import { combineSurveyWorlds } from '../world/atlas';
import type { AtlasResult } from '../world/atlas';
import type { SavedSurvey } from '../world/surveyLibrary';
import { KIND_LABELS } from '../world/types';
import type { ObjectKind, WorldDocument } from '../world/types';
import './AtlasStudio.css';

const WorldScene = lazy(() =>
  import('./WorldScene').then((module) => ({ default: module.WorldScene })),
);
const kinds = Object.keys(KIND_LABELS) as ObjectKind[];
interface Props {
  entries: SavedSurvey[];
  onRead: (id: string) => Promise<WorldDocument>;
  onApply: (world: WorldDocument) => void;
  onClose: () => void;
}

export function AtlasStudio({ entries, onRead, onApply, onClose }: Props) {
  const [selected, setSelected] = useState<string[]>([]);
  const [name, setName] = useState('Connected places');
  const [candidate, setCandidate] = useState<AtlasResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef(0);
  useEffect(
    () => () => {
      request.current++;
    },
    [],
  );
  const available = entries.filter((entry) => entry.bounds && !entry.isComposition);
  const invalidate = () => {
    request.current++;
    setCandidate(null);
    setError('');
    setBusy(false);
  };
  const preview = async () => {
    const id = ++request.current;
    setBusy(true);
    setError('');
    setCandidate(null);
    try {
      const worlds = await Promise.all(selected.map(onRead));
      if (id !== request.current) return;
      setCandidate(combineSurveyWorlds(worlds, { name: name.trim() || 'Connected places' }));
    } catch (error) {
      if (id === request.current)
        setError(error instanceof Error ? error.message : 'These surveys could not be combined.');
    } finally {
      if (id === request.current) setBusy(false);
    }
  };
  return (
    <Modal title="Combine surveys" className="atlas-modal" onClose={onClose}>
      <p className="atlas-intro">
        Choose two to four neighboring surveys and preview them as one editable world. Your original
        saved copies stay intact.
      </p>
      <div className="atlas-layout">
        <section className="atlas-choices" aria-label="Choose surveys to combine">
          <label className="field">
            <span>Combined world name</span>
            <input
              aria-label="Combined world name"
              value={name}
              maxLength={200}
              onChange={(event) => {
                setName(event.target.value);
                invalidate();
              }}
            />
          </label>
          <p className="field-note">
            Select touching areas with no overlap. For a new neighbor, open a saved survey and use
            Create a place → Extend from the open survey. Complete terrain on each tile first, or
            combine tiles that are all flat.
          </p>
          <div className="atlas-tile-list">
            {available.length === 0 && (
              <p>No individual geographic surveys saved yet. Import a mapped area to begin.</p>
            )}
            {available.map((entry) => (
              <label
                key={entry.id}
                className={`atlas-tile ${selected.includes(entry.id) ? 'selected' : ''}`}
              >
                <input
                  type="checkbox"
                  aria-label={`Include ${entry.name}`}
                  checked={selected.includes(entry.id)}
                  disabled={!selected.includes(entry.id) && selected.length >= 4}
                  onChange={() => {
                    setSelected(
                      selected.includes(entry.id)
                        ? selected.filter((id) => id !== entry.id)
                        : [...selected, entry.id],
                    );
                    invalidate();
                  }}
                />
                <span>
                  <strong>{entry.name}</strong>
                  <small>
                    {entry.width.toFixed(0)} × {entry.depth.toFixed(0)} m · {entry.objectCount}{' '}
                    objects
                  </small>
                  <small>
                    {entry.hasTerrain ? (
                      <>
                        <Mountain size={11} /> Terrain grid
                      </>
                    ) : (
                      'Flat survey'
                    )}{' '}
                    · {new Date(entry.savedAt).toLocaleDateString()}
                  </small>
                </span>
              </label>
            ))}
          </div>
          <p className="field-note">
            Up to 2 km across and 4,000 objects. Different or unknown terrain datums require review
            before combining. Saved combined worlds are opened from the library, rather than nested
            into another combination.
          </p>
          <button
            className="button primary"
            disabled={busy || selected.length < 2}
            onClick={() => void preview()}
          >
            <Layers size={15} /> {busy ? 'Combining…' : 'Preview combined world'}
          </button>
          {error && (
            <p className="studio-error" role="alert">
              {error}
            </p>
          )}
        </section>
        <section className="atlas-preview" aria-label="Combined world preview">
          {candidate ? (
            <>
              <div className="atlas-preview-heading">
                <h3>{candidate.world.name}</h3>
                <p>
                  {candidate.stats.tiles} surveys · {candidate.stats.objects.toLocaleString()}{' '}
                  objects · {candidate.world.bounds.width.toFixed(0)} ×{' '}
                  {candidate.world.bounds.depth.toFixed(0)} m
                </p>
              </div>
              <div className="atlas-scene">
                <Suspense
                  fallback={<div className="empty-canvas">Building the combined preview…</div>}
                >
                  <WorldScene
                    world={candidate.world}
                    selectedId={null}
                    onSelect={() => {}}
                    visibleKinds={kinds}
                  />
                </Suspense>
              </div>
              <p className="field-note">
                {candidate.stats.deduplicated} repeated mapped objects removed.{' '}
                {candidate.stats.seamFragments} clipped fragments retained at survey edges.
              </p>
              {candidate.warnings.length > 0 && (
                <details className="atlas-warnings">
                  <summary>Review boundaries and uncertainty ({candidate.warnings.length})</summary>
                  <ul>
                    {candidate.warnings.map((warning, index) => (
                      <li key={index}>{warning}</li>
                    ))}
                  </ul>
                </details>
              )}
              <div className="atlas-apply">
                <button className="button primary" onClick={() => onApply(candidate.world)}>
                  Open combined world <ArrowRight size={15} />
                </button>
                <p className="field-note">
                  Saved as a new document. Undo remains available in Edit mode.
                </p>
              </div>
            </>
          ) : (
            <div className="atlas-empty">
              <Layers size={36} />
              <h3>One landscape. Several surveys.</h3>
              <p>
                Shared coordinates align the tiles. Their original sources and uncertainty travel
                with them.
              </p>
            </div>
          )}
        </section>
      </div>
    </Modal>
  );
}
