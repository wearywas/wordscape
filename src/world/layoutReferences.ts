import type { WorldDocument } from './types';
import corpus from '../data/layoutExamples.json' with { type: 'json' };
export type LayoutPreference = 'contextual' | 'clustered' | 'planned' | 'open';
export interface LayoutReferenceInput {
  prompt?: string;
  layout?: LayoutPreference;
  referenceIds?: string[];
  world?: Pick<WorldDocument, 'name' | 'description'>;
}
export type LayoutExample = (typeof corpus.examples)[number];
export interface LayoutReferenceSelection {
  mode: 'auto' | 'explicit' | 'none';
  referenceIds: string[];
  examples: LayoutExample[];
  reason: string;
}
export const LAYOUT_REFERENCE_OPTIONS = corpus.examples.map(
  ({ id, name, context, tags, source, stats }) => ({
    id,
    name,
    context,
    tags: [...tags],
    source: structuredClone(source),
    stats: structuredClone(stats),
  }),
);
export const LAYOUT_PREFERENCES: LayoutPreference[] = [
  'contextual',
  'clustered',
  'planned',
  'open',
];
const words = (text: string) =>
  new Set(
    text
      .normalize('NFKD')
      .toLowerCase()
      .replace(/[\u0300-\u036f]/g, '')
      .match(/[a-z0-9]+/g) ?? [],
  );
// A deliberately small text heuristic, not general natural-language parsing. Local
// negations keep “avoid a grid” from becoming a positive request for a grid.
function affirmed(text: string, terms: RegExp) {
  return text
    .toLowerCase()
    .split(/[.!?;,\n]|\bbut\b/)
    .some((clause) =>
      [...clause.matchAll(terms)].some((match) => {
        const before = clause.slice(0, match.index).match(/[a-z]+/g) ?? [];
        return !before.slice(-4).some((word) => ['no', 'not', 'avoid', 'without'].includes(word));
      }),
    );
}
/** Brief wording wins over the control; unknown contextual briefs stay unspecified. */
export function getLayoutIntent(
  input: LayoutReferenceInput,
): 'organic' | 'planned' | 'unspecified' {
  const brief = input.prompt ?? '';
  if (affirmed(brief, /\b(planned|grid|gridded|orthogonal|formal|rectilinear)\b/g))
    return 'planned';
  if (
    affirmed(
      brief,
      /\b(organic|irregular|winding|bending|curving|meandering|clustered|clusters|grown over time)\b/g,
    )
  )
    return 'organic';
  return input.layout === 'planned'
    ? 'planned'
    : input.layout === 'clustered'
      ? 'organic'
      : 'unspecified';
}
const aliases: [string[], string[]][] = [
  [
    ['canal', 'canals', 'harbour', 'harbor', 'waterfront', 'pier', 'wharf'],
    ['waterfront', 'harbor'],
  ],
  [
    ['historic', 'historical', 'medieval', 'market', 'bazaar', 'organic', 'irregular', 'ancient'],
    ['organic', 'historic', 'irregular'],
  ],
  [
    ['dense', 'compact', 'clustered', 'clusters', 'crowded'],
    ['dense', 'mixed-spacing', 'small-buildings'],
  ],
  [
    [
      'forest',
      'woodland',
      'wilderness',
      'rural',
      'sparse',
      'dispersed',
      'meadow',
      'clearing',
      'open',
    ],
    ['sparse', 'dispersed', 'open-space', 'meadow-edge'],
  ],
  [
    ['planned', 'grid', 'orthogonal', 'formal'],
    ['planned', 'grid'],
  ],
  [
    ['mountain', 'alpine', 'hills', 'hillside', 'valley'],
    ['mountain', 'village', 'curved'],
  ],
  [
    ['island', 'tropical', 'coastal'],
    ['island', 'small-buildings'],
  ],
  [
    ['suburban', 'residential', 'detached', 'garden', 'gardens'],
    ['suburban', 'detached', 'gardens', 'setbacks'],
  ],
  [
    ['civic', 'courtyard', 'plaza', 'municipal', 'town'],
    ['civic', 'small-town'],
  ],
];
function concepts(text: string) {
  const result = new Set<string>();
  for (const [triggers, tags] of aliases)
    if (triggers.some((word) => affirmed(text, new RegExp(`\\b${word}\\b`, 'g'))))
      for (const tag of tags) result.add(tag);
  return result;
}
/** Local, deterministic keyword/tag matching, not model search or a quality ranking. */
export function selectLayoutReferences(input: LayoutReferenceInput): LayoutReferenceSelection {
  const layout = input.layout ?? 'contextual';
  if (!LAYOUT_PREFERENCES.includes(layout)) throw new Error('Unknown layout preference.');
  if (
    input.prompt !== undefined &&
    (typeof input.prompt !== 'string' || input.prompt.length > 4000)
  )
    throw new Error('Reference-selection prompt must be at most 4000 characters.');
  if (input.referenceIds !== undefined) {
    if (!Array.isArray(input.referenceIds) || input.referenceIds.length > 2)
      throw new Error('Select at most two reference examples.');
    if (new Set(input.referenceIds).size !== input.referenceIds.length)
      throw new Error('Reference IDs must be unique.');
    const examples = input.referenceIds.map((id) => {
      const example = corpus.examples.find((candidate) => candidate.id === id);
      if (!example) throw new Error(`Unknown layout reference ID: ${String(id).slice(0, 100)}.`);
      return structuredClone(example);
    });
    return {
      mode: examples.length ? 'explicit' : 'none',
      referenceIds: [...input.referenceIds],
      examples,
      reason: examples.length
        ? 'Explicitly selected reference examples; geometry is inspiration, not a template or measured fictional content.'
        : 'No concrete reference examples selected.',
    };
  }
  const brief = words(input.prompt ?? ''),
    contextText = `${input.world?.name ?? ''} ${input.world?.description?.slice(0, 800) ?? ''}`,
    context = words(contextText),
    themes = concepts(input.prompt ?? ''),
    contextThemes = concepts(contextText),
    intent = getLayoutIntent(input);
  if (intent !== 'planned') {
    themes.delete('planned');
    themes.delete('grid');
  }
  const preferred: Record<LayoutPreference, string[]> = {
    contextual: [],
    clustered: ['dense', 'organic', 'irregular', 'mixed-spacing'],
    planned: ['planned', 'grid'],
    open: ['sparse', 'dispersed', 'open-space'],
  };
  const ranked = corpus.examples
    .map((example, index) => {
      const description = words(`${example.name} ${example.context} ${example.tags.join(' ')}`);
      let score = example.tags.reduce(
        (sum, tag) =>
          sum +
          (themes.has(tag) ? (['waterfront', 'harbor'].includes(tag) ? 20 : 12) : 0) +
          (contextThemes.has(tag) ? 1 : 0) +
          (preferred[layout].includes(tag) ? 3 : 0),
        0,
      );
      // Verbose briefs repeat generic spatial vocabulary. Cap that weak signal
      // so “small varied buildings along…” cannot outweigh the requested form.
      score += Math.min(
        6,
        [...brief].filter((word) => word.length > 3 && description.has(word)).length * 2,
      );
      for (const word of context) if (word.length > 3 && description.has(word)) score += 0.1;
      if (intent === 'organic') {
        if (example.tags.some((tag) => ['organic', 'irregular', 'curved'].includes(tag)))
          score += 12;
        // A soft relevance adjustment for this particular brief, never a quality
        // score: real orthogonal settlements remain valid for other requests.
        const alignment = example.stats.roadOrientation.orthogonalAlignment;
        if (typeof alignment === 'number') score += 24 * (0.5 - alignment);
      } else if (
        intent === 'planned' &&
        example.tags.some((tag) => ['planned', 'grid'].includes(tag))
      ) {
        score += 36;
      }
      if (themes.has('sparse')) {
        if (example.tags.includes('dense')) score -= 30;
        if (example.tags.some((tag) => ['sparse', 'dispersed'].includes(tag))) score += 12;
      }
      if (!brief.size && layout === 'contextual')
        score += example.id === 'monaco-old-town' ? 2 : example.id === 'malbun-village' ? 1 : 0;
      return { example, index, score };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const examples = ranked.slice(0, 2).map(({ example }) => structuredClone(example));
  return {
    mode: 'auto',
    referenceIds: examples.map(({ id }) => id),
    examples,
    reason:
      'Automatic deterministic keyword/tag heuristic over the brief, layout preference and optional existing-world description, with a soft morphology preference when requested; not model search or a universal quality ranking. The brief remains authoritative.',
  };
}
