import { useCallback, useEffect, useState } from 'react';
import { serializeWorld, validateWorld } from '../world/document';
import type { WorldDocument } from '../world/types';
import { restoreSavedWorld } from '../world/savedWorld';

const STORAGE_KEY = 'wordscape.world.v1';
interface History {
  past: WorldDocument[];
  current: WorldDocument;
  future: WorldDocument[];
}

export function useWorldHistory(initial: WorldDocument) {
  const [history, setHistory] = useState<History>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return { past: [], current: restoreSavedWorld(saved, initial), future: [] };
    } catch {
      return { past: [], current: initial, future: [] };
    }
  });
  const world = history.current;
  const [saveError, setSaveError] = useState(false);
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, serializeWorld(world, false));
      setSaveError(false);
    } catch {
      setSaveError(true);
    }
  }, [world]);
  const update = useCallback(
    (change: WorldDocument | ((world: WorldDocument) => WorldDocument)) => {
      setHistory((previous) => {
        const current = typeof change === 'function' ? change(previous.current) : change;
        if (validateWorld(current).errors.length) return previous;
        if (JSON.stringify(current) === JSON.stringify(previous.current)) return previous;
        return { past: [...previous.past.slice(-59), previous.current], current, future: [] };
      });
    },
    [],
  );
  const undo = useCallback(
    () =>
      setHistory((h) =>
        h.past.length
          ? {
              past: h.past.slice(0, -1),
              current: h.past[h.past.length - 1],
              future: [h.current, ...h.future],
            }
          : h,
      ),
    [],
  );
  const redo = useCallback(
    () =>
      setHistory((h) =>
        h.future.length
          ? { past: [...h.past, h.current], current: h.future[0], future: h.future.slice(1) }
          : h,
      ),
    [],
  );
  return {
    world: history.current,
    update,
    undo,
    redo,
    canUndo: !!history.past.length,
    canRedo: !!history.future.length,
    saveError,
  };
}
