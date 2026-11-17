import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { washingtonSquare } from '../data/washingtonSquare';
import { WordMap } from './WordMap';

describe('map resource bounds', () => {
  it('keeps the metre grid bounded for the largest accepted world', () => {
    const world = { ...washingtonSquare, bounds: { width: 100000, depth: 100000 }, objects: [] };
    const markup = renderToStaticMarkup(
      <WordMap
        world={world}
        selectedId={null}
        onSelect={() => {}}
        visibleKinds={[]}
        onMove={() => {}}
        showLabels={false}
        zoom={1}
        hasReference={false}
      />,
    );
    expect((markup.match(/<line /g) ?? []).length).toBeLessThanOrEqual(202);
  });
});
