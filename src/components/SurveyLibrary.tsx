import { useState } from 'react';
import {
  Archive,
  ArrowDownToLine,
  ArrowRight,
  Layers,
  Mountain,
  Save,
  Search,
  Trash2,
} from 'lucide-react';
import { Modal } from './Modal';
import type { SavedSurvey } from '../world/surveyLibrary';

interface Props {
  entries: SavedSurvey[];
  error: string;
  loading: boolean;
  currentName: string;
  onClose: () => void;
  onSave: () => Promise<boolean>;
  onCombine: () => void;
  onOpen: (id: string) => Promise<void>;
  onExport: (id: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}
export function SurveyLibrary({
  entries,
  error,
  loading,
  currentName,
  onClose,
  onSave,
  onCombine,
  onOpen,
  onExport,
  onRemove,
}: Props) {
  const [search, setSearch] = useState(''),
    [busy, setBusy] = useState(''),
    [removeId, setRemoveId] = useState<string | null>(null),
    [notice, setNotice] = useState('');
  const run = async (id: string, action: () => Promise<unknown>) => {
    setBusy(id);
    setNotice('');
    try {
      await action();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'The library action failed.');
    } finally {
      setBusy('');
    }
  };
  const visible = entries.filter((entry) =>
    entry.name.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <Modal title="Saved worlds" className="library-modal" onClose={onClose}>
      <p className="library-intro">
        Reopen a surveyed or imagined world. Each saved copy retains its objects, evidence and any
        terrain or imagery reference.
      </p>
      <div className="library-save">
        <div>
          <small>Currently open</small>
          <strong>{currentName}</strong>
        </div>
        <button
          className="button primary"
          disabled={!!busy}
          onClick={() =>
            void run('save', async () => {
              if (await onSave())
                setNotice('Current world saved. Identical copies are kept only once.');
            })
          }
        >
          <Save size={15} /> Save current copy
        </button>
      </div>
      <p className="field-note">
        New area imports and worlds you leave are saved automatically. These are snapshots: use Save
        current copy to keep later edits. Storage is local to this browser; export JSON for a
        durable backup.
      </p>
      <button className="button" onClick={onCombine} disabled={!!busy}>
        <Layers size={15} /> Combine surveys
      </button>
      <label className="search-field library-search">
        <Search size={15} />
        <input
          aria-label="Find a saved world"
          placeholder="Find a saved place…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </label>
      {(error || notice) && (
        <p className={error ? 'library-error' : 'library-notice'} role={error ? 'alert' : 'status'}>
          {error || notice}
        </p>
      )}
      <div className="library-list">
        {loading && <p>Opening the local library…</p>}
        {!loading && !visible.length && (
          <div className="library-empty">
            <Archive size={28} />
            <p>
              {search
                ? 'No saved places match that name.'
                : 'Save a world or import an area to begin your library.'}
            </p>
          </div>
        )}
        {visible.map((entry) => (
          <article className="saved-survey" key={entry.id}>
            <div className="saved-survey-details">
              <h3>{entry.name}</h3>
              <p>
                {entry.width.toFixed(0)} × {entry.depth.toFixed(0)} m · {entry.objectCount} objects
                · {(entry.bytes / 1024).toFixed(0)} KB
              </p>
              <div className="survey-badges">
                {entry.hasTerrain && (
                  <span>
                    <Mountain size={12} /> Terrain
                  </span>
                )}
                {entry.hasAerial && (
                  <span>
                    <Layers size={12} /> Aerial reference
                  </span>
                )}
                {entry.bounds && (
                  <span>
                    {((entry.bounds.south + entry.bounds.north) / 2).toFixed(4)},{' '}
                    {((entry.bounds.west + entry.bounds.east) / 2).toFixed(4)}
                  </span>
                )}
              </div>
              <time dateTime={entry.savedAt}>
                {new Date(entry.savedAt).toLocaleString(undefined, {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
              </time>
            </div>
            {removeId === entry.id ? (
              <div className="saved-survey-confirm">
                <p>Remove this saved copy? The open world stays unchanged.</p>
                <button className="button" disabled={!!busy} onClick={() => setRemoveId(null)}>
                  Keep copy
                </button>
                <button
                  className="button danger"
                  disabled={!!busy}
                  onClick={() =>
                    void run(entry.id, async () => {
                      await onRemove(entry.id);
                      setRemoveId(null);
                    })
                  }
                >
                  Remove copy
                </button>
              </div>
            ) : (
              <div className="saved-survey-actions">
                <button
                  className="button primary"
                  disabled={!!busy}
                  onClick={() => void run(entry.id, () => onOpen(entry.id))}
                >
                  Open <ArrowRight size={14} />
                </button>
                <button
                  className="icon-button"
                  title="Export saved JSON"
                  aria-label={`Export ${entry.name}`}
                  disabled={!!busy}
                  onClick={() => void run(entry.id, () => onExport(entry.id))}
                >
                  <ArrowDownToLine size={16} />
                </button>
                <button
                  className="icon-button"
                  title="Remove saved copy"
                  aria-label={`Remove ${entry.name}`}
                  disabled={!!busy}
                  onClick={() => setRemoveId(entry.id)}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            )}
          </article>
        ))}
      </div>
    </Modal>
  );
}
