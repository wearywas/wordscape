import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { getDescendants, getFootprint } from '../world/document';
import { KIND_COLORS } from '../world/types';
import { normalizeWheelDelta, zoomMapAtPoint } from '../world/mapZoom';
import type { ObjectKind, WorldDocument, WorldObject } from '../world/types';

interface WordMapProps {
  world: WorldDocument;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  visibleKinds: ObjectKind[];
  onMove: (id: string, x: number, y: number) => void;
  aerial?: boolean;
  showLabels: boolean;
  zoom: number;
  onZoomChange?: (zoom: number) => void;
  hasReference: boolean;
  isEditing?: boolean;
  aerialImage?: string;
}
interface Drag {
  id: string;
  start: [number, number];
  origin: [number, number];
  offset: [number, number];
}

export function WordMap({
  world,
  selectedId,
  onSelect,
  visibleKinds,
  onMove,
  aerial = false,
  showLabels,
  zoom,
  onZoomChange,
  hasReference,
  isEditing = false,
  aerialImage = '/reference/washington-square-naip.jpg',
}: WordMapProps) {
  const svg = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [pan, setPan] = useState<[number, number]>([0, 0]);
  const panGesture = useRef<{
    start: [number, number];
    origin: [number, number];
    scale: number;
    id: string | null;
    moved: boolean;
  } | null>(null);
  const { width, depth } = world.bounds;
  const gridStep = Math.max(20, Math.ceil(Math.max(width, depth) / 2000) * 20);
  const project = (x: number, y: number): [number, number] =>
    aerial ? [x, depth - y] : [((x + y) * Math.sqrt(3)) / 2, (x - y) / 2];
  const unproject = (x: number, y: number): [number, number] =>
    aerial ? [x, depth - y] : [x / Math.sqrt(3) + y, x / Math.sqrt(3) - y];
  const pointer = (event: ReactPointerEvent): [number, number] => {
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(
      svg.current!.getScreenCTM()!.inverse(),
    );
    return unproject(point.x, point.y);
  };
  const outline = [
    [0, 0],
    [width, 0],
    [width, depth],
    [0, depth],
  ]
    .map(([x, y]) => project(x, y).join(','))
    .join(' ');
  const fullWidth = aerial ? width : ((width + depth) * Math.sqrt(3)) / 2;
  const fullHeight = aerial ? depth : (width + depth) / 2;
  const centerX = fullWidth / 2;
  const centerY = aerial ? depth / 2 : (width - depth) / 4;
  const viewWidth = (fullWidth + 65) / zoom;
  const viewHeight = (fullHeight + 80) / zoom;
  const zoomState = useRef({ zoom, pan, centerX, centerY, onZoomChange, dragging: Boolean(drag) });
  zoomState.current = { zoom, pan, centerX, centerY, onZoomChange, dragging: Boolean(drag) };
  useEffect(() => {
    const element = svg.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      const current = zoomState.current;
      if (!current.onZoomChange) return;
      event.preventDefault();
      if (panGesture.current || current.dragging) return;
      const transform = element.getScreenCTM();
      if (!transform) return;
      const anchor = new DOMPoint(event.clientX, event.clientY).matrixTransform(
        transform.inverse(),
      );
      const next = zoomMapAtPoint(
        current.zoom,
        [current.centerX + current.pan[0], current.centerY + current.pan[1]],
        [anchor.x, anchor.y],
        normalizeWheelDelta(event.deltaY, event.deltaMode, element.clientHeight),
      );
      if (next.zoom === current.zoom) return;
      const nextPan: [number, number] = [
        next.center[0] - current.centerX,
        next.center[1] - current.centerY,
      ];
      zoomState.current = { ...current, zoom: next.zoom, pan: nextPan };
      setPan(nextPan);
      current.onZoomChange(next.zoom);
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [aerial, hasReference]);
  const objects = world.objects
    .filter((o) => visibleKinds.includes(o.kind))
    .sort((a, b) => a.layer - b.layer || a.elevation - b.elevation);
  const movingIds = new Set(
    drag ? [drag.id, ...getDescendants(world, drag.id).map((object) => object.id)] : [],
  );
  // Overview labels have priority; zoom reveals the smaller named objects.
  // Reject intersecting label boxes so language stays readable over dense footprints.
  const priority = (object: WorldObject): number =>
    object.id === selectedId
      ? 100
      : object.id === hoveredId
        ? 90
        : object.kind === 'grass'
          ? 80
          : object.kind === 'landmark'
            ? 70
            : object.kind === 'road'
              ? 60
              : object.kind === 'pavement'
                ? 50
                : object.kind === 'tree'
                  ? 30
                  : 20;
  const labels: {
    object: WorldObject;
    x: number;
    y: number;
    text: string;
    size: number;
    w: number;
    h: number;
  }[] = [];
  if (showLabels)
    for (const object of [...objects].sort((a, b) => priority(b) - priority(a))) {
      const active = object.id === selectedId || object.id === hoveredId;
      if (!active && object.kind === 'landmark' && object.width < 12 && zoom < 1.5) continue;
      const offset = drag && movingIds.has(object.id) ? drag.offset : [0, 0];
      const [x, y] = project(object.x + offset[0], object.y + offset[1]);
      const isMajor =
        (object.kind === 'grass' && object.width > 45) ||
        (object.kind === 'landmark' && object.width > 15);
      let text = object.label;
      if (!active && zoom < 1.5 && object.kind === 'building')
        text = object.label.toLowerCase().includes('school')
          ? 'school'
          : object.label.toLowerCase().includes('apartment')
            ? 'apartments'
            : 'building';
      if (!active && zoom < 1.5 && object.kind === 'tree')
        text = object.tags?.includes('palm') ? 'palm' : 'tree';
      if (text.length > 30) text = `${text.slice(0, 28)}…`;
      const size = (isMajor ? 8.4 : object.kind === 'tree' ? 6.5 : 7.2) / Math.sqrt(zoom);
      const w = text.length * size * 0.55 + 9;
      const h = size * 1.75;
      if (
        labels.some(
          (label) =>
            Math.abs(label.x - x) < (label.w + w) / 2 + 3 / zoom &&
            Math.abs(label.y - y) < (label.h + h) / 2 + 2 / zoom,
        )
      )
        continue;
      labels.push({ object, x, y, text, size, w, h });
    }
  const startDrag = (event: ReactPointerEvent<SVGGElement>, object: WorldObject) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    if (!isEditing) {
      startPan(event, object.id);
      return;
    }
    onSelect(object.id);
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ id: object.id, start: pointer(event), origin: [object.x, object.y], offset: [0, 0] });
  };
  const finishDrag = () => {
    if (isEditing && drag && Math.hypot(...drag.offset) > 0.3)
      onMove(
        drag.id,
        Math.round((drag.origin[0] + drag.offset[0]) * 10) / 10,
        Math.round((drag.origin[1] + drag.offset[1]) * 10) / 10,
      );
    setDrag(null);
  };
  const startPan = (event: ReactPointerEvent, id: string | null) => {
    if (event.button !== 0) return;
    panGesture.current = {
      start: [event.clientX, event.clientY],
      origin: pan,
      scale: svg.current!.getScreenCTM()!.a,
      id,
      moved: false,
    };
    svg.current?.setPointerCapture(event.pointerId);
  };
  if (aerial && !hasReference)
    return (
      <div className="empty-canvas">
        <h3>No aerial attached to this world</h3>
        <p>
          The bundled image belongs to the Washington Square survey. Imported documents still work
          in Words and 3D world.
        </p>
      </div>
    );
  return (
    <svg
      ref={svg}
      className={`word-map ${aerial ? 'is-aerial' : ''} ${isEditing ? 'is-editing' : 'is-viewing'}`}
      viewBox={`${centerX - viewWidth / 2 + pan[0]} ${centerY - viewHeight / 2 + pan[1]} ${viewWidth} ${viewHeight}`}
      aria-label={
        aerial ? 'Aerial image with editable object footprints' : 'Isometric map of world objects'
      }
      onPointerDown={(event) => startPan(event, null)}
      onPointerMove={(event) => {
        const gesture = panGesture.current;
        if (!gesture) return;
        const dx = event.clientX - gesture.start[0],
          dy = event.clientY - gesture.start[1];
        if (Math.hypot(dx, dy) > 4) gesture.moved = true;
        if (gesture.moved)
          setPan([gesture.origin[0] - dx / gesture.scale, gesture.origin[1] - dy / gesture.scale]);
      }}
      onPointerUp={() => {
        if (panGesture.current && !panGesture.current.moved) onSelect(panGesture.current.id);
        panGesture.current = null;
      }}
      onPointerCancel={() => {
        panGesture.current = null;
        setDrag(null);
      }}
    >
      <defs>
        <pattern id="paper-dots" width="12" height="12" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r=".5" fill="#546c5b" opacity=".14" />
        </pattern>
        <filter id="map-shadow" x="-30%" y="-30%" width="160%" height="180%">
          <feDropShadow dx="0" dy="9" stdDeviation="10" floodColor="#334e3e" floodOpacity=".15" />
        </filter>
      </defs>
      <polygon points={outline} fill="#c7cfbd" transform="translate(0 7)" />
      <polygon
        points={outline}
        fill="#f7f6ec"
        filter="url(#map-shadow)"
        stroke="#c8cfbf"
        strokeWidth="1"
      />
      {aerial ? (
        <image
          href={aerialImage}
          x="0"
          y="0"
          width={width}
          height={depth}
          preserveAspectRatio="none"
        />
      ) : (
        <>
          <polygon points={outline} fill="url(#paper-dots)" />
          {Array.from({ length: Math.floor(width / gridStep) + 1 }, (_, i) => (
            <line
              key={`x${i}`}
              x1={project(i * gridStep, 0)[0]}
              y1={project(i * gridStep, 0)[1]}
              x2={project(i * gridStep, depth)[0]}
              y2={project(i * gridStep, depth)[1]}
              stroke="#b8c4b1"
              strokeWidth=".45"
              opacity=".48"
            />
          ))}
          {Array.from({ length: Math.floor(depth / gridStep) + 1 }, (_, i) => (
            <line
              key={`y${i}`}
              x1={project(0, i * gridStep)[0]}
              y1={project(0, i * gridStep)[1]}
              x2={project(width, i * gridStep)[0]}
              y2={project(width, i * gridStep)[1]}
              stroke="#b8c4b1"
              strokeWidth=".45"
              opacity=".48"
            />
          ))}
        </>
      )}
      {objects.map((object) => {
        const isSelected = selectedId === object.id;
        const offset = drag && movingIds.has(object.id) ? drag.offset : [0, 0];
        const moved = { ...object, x: object.x + offset[0], y: object.y + offset[1] };
        const points = getFootprint(moved)
          .map(([x, y]) => project(x, y).join(','))
          .join(' ');
        return (
          <g
            key={object.id}
            role="button"
            tabIndex={0}
            aria-label={`Select ${object.label}`}
            className={`map-object ${isSelected ? 'selected' : ''}`}
            onPointerEnter={() => setHoveredId(object.id)}
            onPointerLeave={() => setHoveredId(null)}
            onFocus={() => setHoveredId(object.id)}
            onBlur={() => setHoveredId(null)}
            onPointerDown={(event) => startDrag(event, object)}
            onPointerMove={(event) => {
              if (!isEditing || drag?.id !== object.id) return;
              const p = pointer(event);
              setDrag({
                ...drag,
                offset: [
                  Math.min(width, Math.max(0, drag.origin[0] + p[0] - drag.start[0])) -
                    drag.origin[0],
                  Math.min(depth, Math.max(0, drag.origin[1] + p[1] - drag.start[1])) -
                    drag.origin[1],
                ],
              });
            }}
            onPointerUp={finishDrag}
            onPointerCancel={() => setDrag(null)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onSelect(object.id);
              }
              const delta = event.shiftKey ? 10 : 1;
              const steps: Record<string, [number, number]> = {
                ArrowLeft: [-delta, 0],
                ArrowRight: [delta, 0],
                ArrowUp: [0, delta],
                ArrowDown: [0, -delta],
              };
              if (isEditing && steps[event.key]) {
                event.preventDefault();
                onMove(
                  object.id,
                  Math.min(width, Math.max(0, object.x + steps[event.key][0])),
                  Math.min(depth, Math.max(0, object.y + steps[event.key][1])),
                );
              }
            }}
          >
            <title>
              {object.label} — {object.description}
            </title>
            <polygon
              points={points}
              fill={KIND_COLORS[object.kind]}
              fillOpacity={
                aerial ? (isSelected ? 0.32 : 0.08) : object.kind === 'tree' ? 0.7 : 0.88
              }
              stroke={isSelected ? '#183f34' : aerial ? '#f9ffe9' : '#647d64'}
              strokeWidth={isSelected ? 1.8 : aerial ? 0.65 : 0.45}
              strokeDasharray={object.evidence === 'inferred' && !isSelected ? '2 1.4' : undefined}
            />
          </g>
        );
      })}
      {labels.map(({ object, x, y, text, size, w, h }) => {
        const selected = object.id === selectedId;
        return (
          <g
            key={object.id}
            className="map-label"
            transform={`translate(${x} ${y})`}
            pointerEvents="none"
          >
            <rect
              x={-w / 2}
              y={-h / 2}
              width={w}
              height={h}
              rx="2"
              fill={selected ? '#274f40' : '#fafbf3'}
              fillOpacity={selected ? 1 : 0.95}
            />
            <text
              textAnchor="middle"
              dominantBaseline="central"
              fill={selected ? '#fff' : '#304b3b'}
              fontSize={size}
              fontWeight={
                selected || object.kind === 'grass' || object.kind === 'landmark' ? 600 : 500
              }
            >
              {text}
            </text>
          </g>
        );
      })}
      {!aerial && (
        <g transform={`translate(${fullWidth / 2} ${fullHeight / 2 + 25})`}>
          <text textAnchor="middle" fontSize="6" fill="#647460">
            Each footprint is an object. Each object is a description.
          </text>
        </g>
      )}
    </svg>
  );
}
