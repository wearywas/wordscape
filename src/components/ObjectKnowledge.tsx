import { useState } from 'react';
import {
  ArrowDownToLine,
  ChevronRight,
  ExternalLink,
  Link,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import type { ObjectReference, WorldDocument, WorldFact, WorldObject } from '../world/types';
import { getDescendants, migrateWorld, serializeWorld, validateWorld } from '../world/document';
import { createContainerPacket } from '../world/packet';
import { Modal } from './Modal';

interface ObjectKnowledgeProps {
  object: WorldObject;
  world: WorldDocument;
  isEditing: boolean;
  onSelect: (id: string) => void;
  onPatch: (patch: Partial<WorldObject>) => void;
  onWorldChange: (world: WorldDocument) => void;
}
const FACT_LABELS: Record<string, string> = {
  'building.levels': 'Floors',
  'building.roofShape': 'Roof shape',
  'building.material': 'Building material',
  'building.height': 'Documented height',
  'building.style': 'Architectural style',
  'building.yearBuilt': 'Built',
  'building.facade': 'Facade',
  'building.color': 'Wall color',
  'building.roofColor': 'Roof color',
  'tree.species': 'Tree species',
  'tree.form': 'Growth form',
  'tree.commonName': 'Common name',
  'road.direction': 'Traffic direction',
  'road.speedLimit': 'Speed limit',
  'road.lanes': 'Traffic lanes',
  'road.bearing': 'Road bearing',
  'fixture.type': 'Fixture type',
};
const factLabel = (key: string) =>
  FACT_LABELS[key] ??
  key
    .split('.')
    .at(-1)!
    .replace(/([a-z])([A-Z])/g, '$1 $2');

export function ObjectKnowledge({
  object,
  world,
  isEditing,
  onSelect,
  onPatch,
  onWorldChange,
}: ObjectKnowledgeProps) {
  const [dialog, setDialog] = useState<'fact' | 'reference' | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [factKey, setFactKey] = useState('');
  const [factValue, setFactValue] = useState('');
  const [factType, setFactType] = useState('text');
  const [unit, setUnit] = useState('');
  const [note, setNote] = useState('');
  const [sourceChoice, setSourceChoice] = useState('');
  const [factSourceIds, setFactSourceIds] = useState<string[]>([]);
  const [sourceTitle, setSourceTitle] = useState('');
  const [url, setUrl] = useState('');
  const [role, setRole] = useState<ObjectReference['role']>('photo');
  const [angle, setAngle] = useState('');
  const [error, setError] = useState('');
  const children = world.objects.filter((candidate) => candidate.parentId === object.id);
  const parent = world.objects.find((candidate) => candidate.id === object.parentId);
  const descendants = getDescendants(world, object.id);
  const unavailableParents = new Set([object.id, ...descendants.map((child) => child.id)]);
  const facts = object.facts ?? [];
  const references = object.references ?? [];
  const openFact = (fact?: WorldFact) => {
    setEditingKey(fact?.key ?? null);
    setFactKey(fact?.key ?? `${object.kind}.`);
    setFactValue(fact?.value === null || fact?.value === undefined ? '' : String(fact.value));
    setFactType(
      fact?.value === null
        ? 'unknown'
        : typeof fact?.value === 'number'
          ? 'number'
          : typeof fact?.value === 'boolean'
            ? 'boolean'
            : 'text',
    );
    setUnit(fact?.unit ?? '');
    setNote(fact?.note ?? '');
    setFactSourceIds(fact?.sourceIds ?? []);
    setError('');
    setDialog('fact');
  };
  const saveFact = () => {
    if (!isEditing) return;
    const value =
      factType === 'unknown'
        ? null
        : factType === 'number'
          ? Number(factValue)
          : factType === 'boolean'
            ? factValue === 'true'
            : factValue;
    if (!factKey.trim() || (factType !== 'unknown' && !factValue.trim())) {
      setError('Enter a key and value, or choose Unknown.');
      return;
    }
    const fact: WorldFact = {
      key: factKey.trim(),
      value,
      evidence: value === null ? 'unknown' : 'authored',
      ...(unit.trim() ? { unit: unit.trim() } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
      ...(factSourceIds.length ? { sourceIds: factSourceIds } : {}),
    };
    const nextFacts = editingKey
      ? facts.map((existing) => (existing.key === editingKey ? fact : existing))
      : [...facts, fact];
    const next = {
      ...migrateWorld(world),
      objects: world.objects.map((existing) =>
        existing.id === object.id ? { ...existing, facts: nextFacts } : existing,
      ),
    };
    const validation = validateWorld(next);
    if (validation.errors.length) {
      setError(validation.errors[0]);
      return;
    }
    onPatch({ facts: nextFacts });
    setDialog(null);
  };
  const saveReference = () => {
    if (!isEditing) return;
    const id = sourceChoice || `ref-${crypto.randomUUID()}`;
    if (!sourceChoice && (!sourceTitle.trim() || !url.trim())) {
      setError('Give the reference a title and an HTTP(S) link.');
      return;
    }
    const reference: ObjectReference = {
      sourceId: id,
      role,
      ...(angle.trim() ? { view: angle.trim() } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
    };
    const next: WorldDocument = {
      ...migrateWorld(world),
      sources: sourceChoice
        ? world.sources
        : [
            ...world.sources,
            {
              id,
              title: sourceTitle.trim(),
              url: url.trim(),
              attribution: 'User-provided reference; rights remain with the source.',
              accessed: new Intl.DateTimeFormat('en-CA').format(new Date()),
              notes: 'Added in the workbench. Linked content has not been verified.',
            },
          ],
      objects: world.objects.map((existing) =>
        existing.id === object.id
          ? { ...existing, evidence: 'authored', references: [...references, reference] }
          : existing,
      ),
    };
    const validation = validateWorld(next);
    if (validation.errors.length) {
      setError(validation.errors[0]);
      return;
    }
    onWorldChange(next);
    setDialog(null);
  };
  const exportPacket = () => {
    const packet = createContainerPacket(world, object.id);
    const blob = new Blob([serializeWorld(packet)], { type: 'application/json' });
    const address = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = address;
    anchor.download = `${object.id}.container.wordscape.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(address), 10_000);
  };
  return (
    <div className="object-knowledge">
      <details className="knowledge-section" open>
        <summary>
          Container <span>{children.length} children</span>
        </summary>
        {parent && (
          <button className="parent-link" onClick={() => onSelect(parent.id)}>
            Part of {parent.label}
            <ChevronRight size={13} />
          </button>
        )}
        {children.length > 0 && (
          <div className="child-list">
            {children.map((child) => (
              <button key={child.id} onClick={() => onSelect(child.id)}>
                <span>↳ {child.label}</span>
                <ChevronRight size={12} />
              </button>
            ))}
          </div>
        )}
        {children.length === 0 && (
          <p className="field-note">
            This placement can contain facts, references, and child placements.
          </p>
        )}
        {isEditing && (
          <label className="field parent-field">
            <span>Parent container</span>
            <select
              aria-label="Parent container"
              value={object.parentId ?? ''}
              onChange={(event) => {
                const next = structuredClone(world);
                const current = next.objects.find((item) => item.id === object.id)!;
                if (event.target.value) current.parentId = event.target.value;
                else delete current.parentId;
                current.evidence = 'authored';
                next.version = '0.2';
                onWorldChange(next);
              }}
            >
              <option value="">World root</option>
              {world.objects
                .filter((candidate) => !unavailableParents.has(candidate.id))
                .map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.label}
                  </option>
                ))}
            </select>
          </label>
        )}
        {children.length > 0 && (
          <p className="field-note">
            Moving or rotating this container carries its children. Resizing affects this footprint
            only.
          </p>
        )}
        <button className="text-button packet-button" onClick={exportPacket}>
          <ArrowDownToLine size={12} />
          Export container JSON
        </button>
      </details>
      <details className="knowledge-section" open>
        <summary>
          Facts & evidence <span>{facts.length}</span>
        </summary>
        {facts.length === 0 && (
          <p className="field-note">
            No detailed facts yet. Add floors, species, materials, or other generation hints in Edit
            mode.
          </p>
        )}
        <dl className="fact-list">
          {facts.map((fact) => (
            <div className="fact-item" key={fact.key}>
              <dt title={fact.key}>
                {factLabel(fact.key)}
                <span className={`fact-evidence evidence-${fact.evidence}`}>{fact.evidence}</span>
              </dt>
              <dd>
                {fact.value === null
                  ? 'Not established'
                  : typeof fact.value === 'boolean'
                    ? fact.value
                      ? 'Yes'
                      : 'No'
                    : String(fact.value)}
                {fact.value !== null && fact.unit ? ` ${fact.unit}` : ''}
              </dd>
              {fact.note && <p>{fact.note}</p>}
              {fact.sourceIds?.map((id) => {
                const source = world.sources.find((candidate) => candidate.id === id);
                return (
                  source?.url && (
                    <a
                      key={id}
                      className="fact-source"
                      href={source.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <ExternalLink size={10} />
                      {source.title}
                    </a>
                  )
                );
              })}
              {isEditing && (
                <div className="fact-actions">
                  <button
                    title={`Edit ${factLabel(fact.key)}`}
                    aria-label={`Edit ${fact.key}`}
                    onClick={() => openFact(fact)}
                  >
                    <Pencil size={11} />
                  </button>
                  <button
                    title={`Remove ${factLabel(fact.key)}`}
                    aria-label={`Remove ${fact.key}`}
                    onClick={() =>
                      onPatch({ facts: facts.filter((existing) => existing.key !== fact.key) })
                    }
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              )}
            </div>
          ))}
        </dl>
        {isEditing && (
          <button
            className="text-button inline-action"
            onClick={() => openFact()}
            disabled={facts.length >= 64}
          >
            <Plus size={12} />
            Add fact
          </button>
        )}
      </details>
      <details className="knowledge-section" open>
        <summary>
          References <span>{references.length}</span>
        </summary>
        {references.length === 0 && (
          <p className="field-note">
            Photo angles, historical records, datasets, or inspiration can travel with this object.
          </p>
        )}
        <div className="reference-list">
          {references.map((reference, index) => {
            const source = world.sources.find((candidate) => candidate.id === reference.sourceId);
            return (
              source && (
                <article key={`${reference.sourceId}-${index}`}>
                  <div className="reference-role">
                    <Link size={11} />
                    {reference.role}
                    {reference.view ? ` · ${reference.view}` : ''}
                    {isEditing && (
                      <button
                        aria-label={`Remove reference ${source.title}`}
                        onClick={() =>
                          onPatch({ references: references.filter((_, i) => i !== index) })
                        }
                      >
                        <Trash2 size={11} />
                      </button>
                    )}
                  </div>
                  <a href={source.url || undefined} target="_blank" rel="noreferrer">
                    {source.title}
                    <ExternalLink size={10} />
                  </a>
                  {reference.note && <p>{reference.note}</p>}
                </article>
              )
            );
          })}
        </div>
        {isEditing && (
          <button
            className="text-button inline-action"
            disabled={references.length >= 32}
            onClick={() => {
              setSourceChoice('');
              setSourceTitle('');
              setUrl('');
              setAngle('');
              setNote('');
              setRole('photo');
              setError('');
              setDialog('reference');
            }}
          >
            <Plus size={12} />
            Add reference
          </button>
        )}
      </details>
      {dialog && (
        <Modal
          title={
            dialog === 'fact'
              ? editingKey
                ? 'Edit object fact'
                : 'Add object fact'
              : 'Add an object reference'
          }
          onClose={() => setDialog(null)}
        >
          {!isEditing ? (
            <p>Edit mode is off. Close this dialog and enable editing to make changes.</p>
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (dialog === 'fact') saveFact();
                else saveReference();
              }}
            >
              {dialog === 'fact' ? (
                <>
                  <label className="field">
                    <span>Fact key</span>
                    <input
                      aria-label="Fact key"
                      value={factKey}
                      onChange={(event) => setFactKey(event.target.value)}
                      placeholder="building.levels"
                      maxLength={128}
                      required
                    />
                  </label>
                  <div className="fact-form-grid">
                    <label className="field">
                      <span>Value type</span>
                      <select
                        value={factType}
                        onChange={(event) => {
                          setFactType(event.target.value);
                          if (event.target.value === 'boolean') setFactValue('true');
                        }}
                      >
                        <option value="text">Text</option>
                        <option value="number">Number</option>
                        <option value="boolean">Yes / no</option>
                        <option value="unknown">Unknown</option>
                      </select>
                    </label>
                    <label className="field">
                      <span>Value</span>
                      {factType === 'boolean' ? (
                        <select
                          aria-label="Fact value"
                          value={factValue}
                          onChange={(event) => setFactValue(event.target.value)}
                        >
                          <option value="true">Yes</option>
                          <option value="false">No</option>
                        </select>
                      ) : (
                        <input
                          aria-label="Fact value"
                          value={factValue}
                          onChange={(event) => setFactValue(event.target.value)}
                          type={factType === 'number' ? 'number' : 'text'}
                          step="any"
                          disabled={factType === 'unknown'}
                          required={factType !== 'unknown'}
                          maxLength={10000}
                        />
                      )}
                    </label>
                  </div>
                  <label className="field">
                    <span>Unit (optional)</span>
                    <input
                      value={unit}
                      onChange={(event) => setUnit(event.target.value)}
                      placeholder="m, floors, mph…"
                      maxLength={64}
                    />
                  </label>
                  <p className="field-note">
                    Changes are marked authored. A reference records where to investigate; it does
                    not automatically verify the value.
                  </p>
                </>
              ) : (
                <>
                  <label className="field">
                    <span>Reference purpose</span>
                    <select
                      value={role}
                      onChange={(event) => setRole(event.target.value as ObjectReference['role'])}
                    >
                      {['photo', 'map', 'history', 'dataset', 'inspiration'].map((value) => (
                        <option key={value}>{value}</option>
                      ))}
                    </select>
                  </label>
                </>
              )}
              {dialog === 'fact' ? (
                <fieldset className="source-choices">
                  <legend>Supporting sources (optional)</legend>
                  <div>
                    {world.sources.map((source) => (
                      <label key={source.id}>
                        <input
                          type="checkbox"
                          checked={factSourceIds.includes(source.id)}
                          onChange={(event) =>
                            setFactSourceIds(
                              event.target.checked
                                ? [...factSourceIds, source.id]
                                : factSourceIds.filter((id) => id !== source.id),
                            )
                          }
                        />
                        <span>{source.title}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              ) : (
                <label className="field">
                  <span>Source</span>
                  <select
                    value={sourceChoice}
                    onChange={(event) => setSourceChoice(event.target.value)}
                  >
                    <option value="">Add a new web link</option>
                    {world.sources.map((source) => (
                      <option key={source.id} value={source.id}>
                        {source.title}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {dialog === 'reference' && (
                <>
                  {!sourceChoice && (
                    <>
                      <label className="field">
                        <span>Reference title</span>
                        <input
                          value={sourceTitle}
                          onChange={(event) => setSourceTitle(event.target.value)}
                          maxLength={300}
                          required
                        />
                      </label>
                      <label className="field">
                        <span>Web link</span>
                        <input
                          type="url"
                          value={url}
                          onChange={(event) => setUrl(event.target.value)}
                          placeholder="https://…"
                          maxLength={2000}
                          required
                        />
                      </label>
                    </>
                  )}
                  <label className="field">
                    <span>View or angle (optional)</span>
                    <input
                      value={angle}
                      onChange={(event) => setAngle(event.target.value)}
                      placeholder="South facade, street level…"
                      maxLength={200}
                    />
                  </label>
                </>
              )}
              <label className="field">
                <span>Context or uncertainty (optional)</span>
                <textarea
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  rows={3}
                  maxLength={2000}
                />
              </label>
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
              <div className="modal-actions">
                <button type="button" className="button" onClick={() => setDialog(null)}>
                  Cancel
                </button>
                <button type="submit" className="button primary">
                  {dialog === 'fact' ? 'Save fact' : 'Save reference'}
                </button>
              </div>
            </form>
          )}
        </Modal>
      )}
    </div>
  );
}
