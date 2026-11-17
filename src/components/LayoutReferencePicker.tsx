import { lazy, Suspense, useEffect, useState } from 'react';
import { LAYOUT_REFERENCE_OPTIONS } from '../world/layoutReferences';
import { parseWorld } from '../world/document';
import { KIND_LABELS } from '../world/types';
import type { ObjectKind, WorldDocument } from '../world/types';
import './LayoutReferencePicker.css';

const WorldScene = lazy(() =>
  import('./WorldScene').then((module) => ({ default: module.WorldScene })),
);
const kinds = Object.keys(KIND_LABELS) as ObjectKind[];
const noSelect = () => {};
export type ReferenceChoice = 'auto' | 'none' | 'manual';
interface Props {
  mode: ReferenceChoice;
  selectedIds: string[];
  disabled: boolean;
  onModeChange: (mode: ReferenceChoice) => void;
  onIdsChange: (ids: string[]) => void;
}

/** Only our bundled, allowlisted reference records can be fetched by this viewer. */
function referencePath(id: string) {
  const reference = LAYOUT_REFERENCE_OPTIONS.find((option) => option.id === id);
  const expected = `/reference/layout-examples/${id}.wordscape.json`;
  if (!reference || reference.source.worldPath !== expected)
    throw new Error('This reference is not in the bundled library.');
  return expected;
}

export function LayoutReferencePicker({
  mode,
  selectedIds,
  disabled,
  onModeChange,
  onIdsChange,
}: Props) {
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ id: string; world: WorldDocument } | null>(null);
  const [error, setError] = useState<{ id: string; message: string } | null>(null);
  const activeId = !disabled && previewId && selectedIds.includes(previewId) ? previewId : null;
  useEffect(() => {
    if (!activeId) return;
    const abort = new AbortController();
    void (async () => {
      try {
        const response = await fetch(referencePath(activeId), { signal: abort.signal });
        if (!response.ok) throw new Error('The bundled reference could not be loaded.');
        const content = await response.text();
        if (content.length > 8 * 1024 * 1024)
          throw new Error('This reference exceeds the preview limit.');
        const world = parseWorld(content);
        if (!abort.signal.aborted) {
          setPreview({ id: activeId, world });
          setError(null);
        }
      } catch (error) {
        if (!abort.signal.aborted) setError({ id: activeId, message: (error as Error).message });
      }
    })();
    return () => abort.abort();
  }, [activeId]);
  const selected = selectedIds.flatMap((id) => {
    const option = LAYOUT_REFERENCE_OPTIONS.find((reference) => reference.id === id);
    return option ? [option] : [];
  });
  return (
    <section className="layout-references" aria-label="Real layout references">
      <label className="world-studio-field">
        <span>Real-place references</span>
        <select
          value={mode}
          disabled={disabled}
          onChange={(event) => {
            setPreviewId(null);
            onModeChange(event.target.value as ReferenceChoice);
          }}
        >
          <option value="auto">Automatic · match the brief</option>
          <option value="manual">Choose up to two</option>
          <option value="none">None · use the general guide</option>
        </select>
      </label>
      {mode === 'manual' && (
        <fieldset className="layout-reference-options" disabled={disabled}>
          <legend>Choose 1–2 mapped examples · {selectedIds.length}/2 selected</legend>
          {LAYOUT_REFERENCE_OPTIONS.map((option) => (
            <label key={option.id}>
              <input
                type="checkbox"
                checked={selectedIds.includes(option.id)}
                disabled={!selectedIds.includes(option.id) && selectedIds.length >= 2}
                onChange={(event) => {
                  setPreviewId(null);
                  onIdsChange(
                    event.target.checked
                      ? [...selectedIds, option.id].slice(0, 2)
                      : selectedIds.filter((id) => id !== option.id),
                  );
                }}
              />
              <span>{option.name}</span>
            </label>
          ))}
        </fieldset>
      )}
      <p className="layout-reference-explanation">
        {mode === 'auto'
          ? 'Matched locally by brief keywords and layout preference; the brief remains authoritative.'
          : mode === 'none'
            ? 'No concrete examples will be sent. The shared authoring guide still applies.'
            : 'Choose examples for spatial inspiration. Their real locations are not copied into your world.'}
      </p>
      <div className="layout-reference-cards">
        {selected.map((option) => (
          <article className="layout-reference-card" key={option.id} data-reference-id={option.id}>
            <img
              src={option.source.thumbnailPath}
              alt={`Mapped plan of ${option.name}; dashed outline marks the smaller prompt context`}
              width={80}
              height={80}
              loading="lazy"
            />
            <div>
              <h4>{option.name}</h4>
              <p>{option.context}</p>
              <span className="layout-reference-metrics">
                {option.stats.objectCount} objects · {option.stats.buildingCount} buildings ·{' '}
                {(option.stats.summedBuildingAreaRatio * 100).toFixed(1)}% summed footprint coverage
              </span>
              <div className="layout-reference-links">
                <button type="button" disabled={disabled} onClick={() => setPreviewId(option.id)}>
                  Preview {option.name.split(' · ')[0]} in 3D
                </button>
                <a href={referencePath(option.id)} download={`${option.id}.wordscape.json`}>
                  Download world JSON
                </a>
              </div>
            </div>
          </article>
        ))}
      </div>
      {selected.length > 0 && (
        <p className="layout-reference-caption">
          Complete converted plans; dashed boxes mark the smaller geometry context sent to the
          model. Heights may be estimated, and mapping is incomplete. © OpenStreetMap contributors ·{' '}
          <a
            href="https://opendatacommons.org/licenses/odbl/1-0/"
            target="_blank"
            rel="noopener noreferrer"
          >
            ODbL 1.0
          </a>
          .
        </p>
      )}
      {activeId && (
        <section className="layout-reference-preview" aria-label="Read-only reference preview">
          <div className="layout-reference-preview-heading">
            <strong>{selected.find((option) => option.id === activeId)?.name}</strong>
            <button type="button" onClick={() => setPreviewId(null)}>
              Close reference preview
            </button>
          </div>
          {error?.id === activeId ? (
            <p role="alert">{error.message}</p>
          ) : preview?.id === activeId ? (
            <div className="layout-reference-scene">
              <Suspense fallback={<p>Preparing the reference scene…</p>}>
                <WorldScene
                  world={preview.world}
                  selectedId={null}
                  onSelect={noSelect}
                  visibleKinds={kinds}
                />
              </Suspense>
            </div>
          ) : (
            <p role="status">Loading the bundled reference…</p>
          )}
          <p>
            Read-only mapped example. Your open world is unchanged; 3D detail includes inferred
            heights and forms.
          </p>
        </section>
      )}
    </section>
  );
}
