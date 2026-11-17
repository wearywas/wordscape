import { useMemo, useState } from 'react';
import { Check, FileJson } from 'lucide-react';
import { parseWorld, serializeWorld } from '../world/document';
import type { WorldDocument } from '../world/types';

interface DocumentEditorProps {
  world: WorldDocument;
  onApply: (world: WorldDocument) => void;
  isEditing?: boolean;
}
export function DocumentEditor({ world, onApply, isEditing = false }: DocumentEditorProps) {
  const source = useMemo(() => serializeWorld(world), [world]);
  const [editor, setEditor] = useState({ source, draft: source, error: '', applied: false });
  // Undo and inspector edits replace the source while this view remains mounted.
  if (editor.source !== source) setEditor({ source, draft: source, error: '', applied: false });
  const { draft, error, applied } = editor;
  return (
    <div className="document-editor">
      <div className="document-heading">
        <div>
          <FileJson size={18} />
          <span>world.wordscape.json</span>
        </div>
        <button
          className="button primary"
          disabled={!isEditing}
          onClick={() => {
            if (!isEditing) return;
            try {
              const next = parseWorld(draft);
              const serialized = serializeWorld(next);
              onApply(next);
              setEditor({ source: serialized, draft: serialized, error: '', applied: true });
            } catch (e) {
              setEditor({
                ...editor,
                error: e instanceof Error ? e.message : 'Could not read this world.',
                applied: false,
              });
            }
          }}
        >
          <Check size={15} />
          Apply document
        </button>
      </div>
      <p className="editor-tip">
        {isEditing
          ? 'Edit the portable source of this world. Apply changes before leaving this view.'
          : 'Viewing the portable world document. Turn on Edit mode to change it.'}
      </p>
      <textarea
        spellCheck={false}
        aria-label="World JSON document"
        value={draft}
        readOnly={!isEditing}
        onChange={(event) => setEditor({ ...editor, draft: event.target.value, applied: false })}
      />
      {(error || applied) && (
        <div className={`editor-result ${error ? 'error' : ''}`} role="status">
          {error || 'Document applied. All views now use these objects.'}
        </div>
      )}
    </div>
  );
}
