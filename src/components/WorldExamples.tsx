import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowRight, Box, Landmark, Mountain, Trees, Waves } from 'lucide-react';
import { Modal } from './Modal';
import { washingtonSquare } from '../data/washingtonSquare';
import { parseWorld, serializeWorld } from '../world/document';
import type { WorldDocument } from '../world/types';
import './WorldExamples.css';

interface WorldExamplesProps {
  onClose: () => void;
  onOpen: (world: WorldDocument) => void | Promise<void>;
}

const EXAMPLES = [
  {
    id: 'washington-square',
    title: 'Washington Square',
    type: 'Surveyed place',
    description:
      'The San Francisco reference scene with sourced terrain, mapped paths and documented estimates.',
    count: washingtonSquare.objects.length,
    path: null,
    icon: Landmark,
  },
  {
    id: 'lanternwater',
    title: 'Lanternwater Lanes · refined',
    type: 'Imaginary world',
    description:
      'The retained refined canal village: workshops, small courts and a copper-domed archive.',
    count: 46,
    path: '/examples/lanternwater-lanes-refined.wordscape.json',
    icon: Waves,
  },
  {
    id: 'mossbell-terrain',
    title: 'Mossbell Retreat · terrain',
    type: 'Authored terrain revision',
    description:
      'The original woodland placements regrounded on a stored 33 × 33 height grid, with a hill and pond basin. All elevations are invented.',
    count: 29,
    path: '/examples/mossbell-terrain.wordscape.json',
    icon: Mountain,
  },
  {
    id: 'alderfold',
    title: 'Alderfold',
    type: 'Imaginary world with authored terrain',
    description:
      'A newly generated hillside clearing with five huts, a pavilion, paths and a broad 25 m ridge.',
    count: 24,
    path: '/examples/alderfold-terrain.wordscape.json',
    icon: Mountain,
  },
  {
    id: 'mossbell',
    title: 'Mossbell Retreat · flat',
    type: 'Original imaginary world',
    description:
      'Five woodland huts, an open pavilion and a winding path around a generous clearing.',
    count: 29,
    path: '/examples/mossbell-retreat.wordscape.json',
    icon: Trees,
  },
  {
    id: 'pavilion',
    title: 'Reading pavilion',
    type: 'Fictional recipe example',
    description: 'One open-air pavilion built from ten editable geometry parts.',
    count: 1,
    path: '/examples/reading-pavilion.wordscape.json',
    icon: Box,
  },
] as const;

/** Only fixed bundled example paths enter this loader. The caller owns saving and switching. */
export function WorldExamples({ onClose, onOpen }: WorldExamplesProps) {
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current?.abort();
    };
  }, []);

  const handleClose = () => {
    request.current?.abort();
    onClose();
  };
  const handleOpen = async (example: (typeof EXAMPLES)[number]) => {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setLoadingId(example.id);
    setError('');
    try {
      let world: WorldDocument;
      if (example.path === null) {
        world = parseWorld(serializeWorld(washingtonSquare));
      } else {
        const response = await fetch(example.path, { signal: controller.signal });
        if (!response.ok || !response.body)
          throw new Error('The bundled example could not be loaded.');
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let bytes = 0;
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > 2 * 1024 * 1024) {
            await reader.cancel();
            throw new Error('This example exceeds the loading limit.');
          }
          chunks.push(value);
        }
        const data = new Uint8Array(bytes);
        let offset = 0;
        for (const chunk of chunks) {
          data.set(chunk, offset);
          offset += chunk.byteLength;
        }
        world = parseWorld(new TextDecoder().decode(data));
      }
      if (!mounted.current || controller.signal.aborted) return;
      await onOpen(world);
    } catch (cause) {
      if (mounted.current && !controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : 'The example could not be opened.');
    } finally {
      if (request.current === controller) request.current = null;
      if (mounted.current) setLoadingId(null);
    }
  };

  return (
    <Modal title="Example worlds" className="world-examples-modal" onClose={handleClose}>
      <p className="world-examples-intro">
        No model connection needed. Opening keeps your current world in Saved worlds.
      </p>
      {error && (
        <p className="world-examples-error" role="alert">
          {error}
        </p>
      )}
      <div className="world-examples-grid" aria-busy={loadingId !== null}>
        {EXAMPLES.map((example) => {
          const Icon = example.icon;
          return (
            <article className="world-example-card" key={example.id}>
              <div className="world-example-heading">
                <Icon size={24} aria-hidden="true" />
                <span>{example.type}</span>
              </div>
              <h3>{example.title}</h3>
              <p>{example.description}</p>
              <small>
                {example.count} {example.count === 1 ? 'object' : 'objects'}
              </small>
              <div className="world-example-actions">
                <button
                  type="button"
                  className="button primary"
                  disabled={loadingId !== null}
                  onClick={() => void handleOpen(example)}
                  aria-label={`Open ${example.title}`}
                >
                  {loadingId === example.id ? 'Opening…' : 'Open world'}
                  <ArrowRight size={14} aria-hidden="true" />
                </button>
                {example.path && (
                  <a
                    href={example.path}
                    download
                    className="world-example-download"
                    aria-label={`Download ${example.title} JSON`}
                  >
                    <ArrowDownToLine size={14} aria-hidden="true" /> JSON
                  </a>
                )}
              </div>
            </article>
          );
        })}
      </div>
      {loadingId && (
        <p className="world-examples-status" role="status">
          Opening the bundled example…
        </p>
      )}
    </Modal>
  );
}
