import { useMemo, useState } from 'react';
import { ArrowDownToLine, ArrowUpRight, Mountain } from 'lucide-react';
import type { WorldDocument } from '../world/types';
import { getFootprint } from '../world/document';
import { sampleTerrain } from '../world/terrain';
import { analyzeSurvey, terrainOverview, terrainSlope } from '../world/survey';
import { Modal } from './Modal';

const number = (value: number | null | undefined, decimals = 1) =>
  value == null ? 'Unknown' : value.toFixed(decimals);
function shade(value: number, min: number, max: number): string {
  const t = max === min ? 0.5 : Math.max(0, Math.min(1, (value - min) / (max - min)));
  return `rgb(${Math.round(123 + 89 * t)} ${Math.round(169 + 2 * t)} ${Math.round(156 - 36 * t)})`;
}

export function TerrainReading({ world }: { world: WorldDocument }) {
  const terrain = world.terrain;
  const authored = terrain?.evidence === 'authored';
  const overview = terrainOverview(world);
  const [probe, setProbe] = useState({ x: world.bounds.width / 2, y: world.bounds.depth / 2 });
  const cells = useMemo(() => {
    if (!terrain) return [];
    const values = terrain.heights.filter((height): height is number => height !== null);
    const min = values.length ? Math.min(...values) : 0,
      max = values.length ? Math.max(...values) : 0;
    return Array.from({ length: (terrain.rows - 1) * (terrain.columns - 1) }, (_, index) => {
      const row = Math.floor(index / (terrain.columns - 1)),
        col = index % (terrain.columns - 1);
      const corners = [
        row * terrain.columns + col,
        row * terrain.columns + col + 1,
        (row + 1) * terrain.columns + col,
        (row + 1) * terrain.columns + col + 1,
      ].map((i) => terrain.heights[i]);
      if (corners.some((value) => value === null)) return null;
      const height = (corners as number[]).reduce((sum, value) => sum + value, 0) / 4;
      return (
        <rect
          key={index}
          x={terrain.origin.x + col * terrain.spacing}
          y={world.bounds.depth - terrain.origin.y - (row + 1) * terrain.spacing}
          width={terrain.spacing + 0.02}
          height={terrain.spacing + 0.02}
          fill={shade(height, min, max)}
        />
      );
    });
  }, [terrain, world.bounds.depth]);
  if (!terrain || !overview)
    return (
      <p className="modal-callout">
        This document has no terrain heightfield. Its local elevation plane is preserved; missing
        ground is not inferred.
      </p>
    );
  const height = sampleTerrain(world, probe.x, probe.y);
  const slope = terrainSlope(world, probe.x, probe.y);
  const source = world.sources.find((item) => item.id === terrain.sourceId);
  const profile = Array.from({ length: 101 }, (_, index) =>
    sampleTerrain(world, (world.bounds.width * index) / 100, probe.y),
  );
  const span = Math.max(1, (overview.max ?? 1) - (overview.min ?? 0));
  const profilePath = profile
    .map((value, index) =>
      value === undefined
        ? ''
        : `${index === 0 || profile[index - 1] === undefined ? 'M' : 'L'}${index * 4},${90 - ((value - (overview.min ?? 0)) / span) * 75}`,
    )
    .join(' ');
  return (
    <section
      className="terrain-reading"
      aria-label={authored ? 'Authored terrain' : 'Terrain observations'}
    >
      <div className="notebook-section-title">
        <Mountain size={18} />
        <h3>The ground beneath the words</h3>
      </div>
      <p>
        {authored && 'This is authored imaginary terrain, not measured elevation. '}
        Move across the map to read the sampled ground. The horizontal profile follows your north
        coordinate.
      </p>
      <div className="terrain-stats">
        <span>
          <strong>{number(overview.relief)} m</strong>Ground relief
        </span>
        <span>
          <strong>{terrain.spacing} m</strong>Stored grid spacing
        </span>
        <span>
          <strong>
            {authored
              ? 'Authored'
              : terrain.sourceResolution === undefined
                ? 'Unknown'
                : `${terrain.sourceResolution} m`}
          </strong>
          {authored ? 'Terrain provenance' : 'Native DEM resolution'}
        </span>
      </div>
      {!authored && terrain.sampledResolution !== undefined && (
        <p className="field-note">
          Served raster pixel pitch: {number(terrain.sampledResolution)} m. This is distinct from
          native DEM resolution and stored grid spacing.
        </p>
      )}
      <div className="terrain-map-layout">
        <div>
          <svg
            className="terrain-map"
            role="img"
            aria-label="North-up terrain elevation map; use the coordinate sliders for keyboard exploration"
            viewBox={`0 0 ${world.bounds.width} ${world.bounds.depth}`}
            style={{ aspectRatio: `${world.bounds.width}/${world.bounds.depth}` }}
            onPointerMove={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              setProbe({
                x: Math.max(
                  0,
                  Math.min(
                    world.bounds.width,
                    ((event.clientX - rect.left) / rect.width) * world.bounds.width,
                  ),
                ),
                y: Math.max(
                  0,
                  Math.min(
                    world.bounds.depth,
                    world.bounds.depth -
                      ((event.clientY - rect.top) / rect.height) * world.bounds.depth,
                  ),
                ),
              });
            }}
          >
            <rect width={world.bounds.width} height={world.bounds.depth} fill="#ebe9df" />
            <g shapeRendering="crispEdges">{cells}</g>
            <g
              fill="none"
              stroke="#ffffff"
              strokeOpacity="0.38"
              strokeWidth={world.bounds.width / 500}
            >
              {world.objects
                .filter((object) => object.kind !== 'tree')
                .map((object) => (
                  <polygon
                    key={object.id}
                    points={getFootprint(object)
                      .map(([x, y]) => `${x},${world.bounds.depth - y}`)
                      .join(' ')}
                  />
                ))}
            </g>
            <path
              d={`M0,${world.bounds.depth - probe.y} H${world.bounds.width}`}
              stroke="#314d49"
              strokeWidth={world.bounds.width / 400}
              strokeDasharray={`${world.bounds.width / 70} ${world.bounds.width / 100}`}
            />
            <circle
              cx={probe.x}
              cy={world.bounds.depth - probe.y}
              r={world.bounds.width / 80}
              fill="#fffef6"
              stroke="#314d49"
              strokeWidth={world.bounds.width / 240}
            />
            <text
              x={world.bounds.width * 0.94}
              y={world.bounds.depth * 0.07}
              fontSize={world.bounds.width / 24}
              textAnchor="middle"
              fill="#314d49"
            >
              N ↑
            </text>
          </svg>
          <div className="terrain-legend">
            <span>{number(overview.min)} m</span>
            <i />
            <span>{number(overview.max)} m</span>
          </div>
        </div>
        <div className="terrain-probe">
          <span className="notebook-eyebrow">Ground probe</span>
          <strong className="probe-height">
            {number(height)}
            {height === undefined ? '' : ' m'}
          </strong>
          <small>{terrain.verticalDatum}</small>
          <p>
            {number(slope)}
            {slope === undefined ? '' : '°'} sampled slope
          </p>
          <label>
            East · {number(probe.x, 0)} m
            <input
              aria-label="Probe east"
              type="range"
              min="0"
              max={world.bounds.width}
              step="1"
              value={probe.x}
              onChange={(event) => setProbe({ ...probe, x: Number(event.target.value) })}
            />
          </label>
          <label>
            North · {number(probe.y, 0)} m
            <input
              aria-label="Probe north"
              type="range"
              min="0"
              max={world.bounds.depth}
              step="1"
              value={probe.y}
              onChange={(event) => setProbe({ ...probe, y: Number(event.target.value) })}
            />
          </label>
          <svg
            className="terrain-profile"
            viewBox="0 0 400 105"
            role="img"
            aria-label="West-to-east sampled elevation profile"
          >
            <path d="M0 95 H400" stroke="#d1d8c8" />
            <path d={profilePath} stroke="#3c6b60" strokeWidth="3" fill="none" />
          </svg>
          <div className="profile-ends">
            <span>West</span>
            <span>East</span>
          </div>
          <p className="field-note">
            Profile height range: {number(overview.min)}–{number(overview.max)} m, fitted
            vertically. Use the numeric slope reading; this chart is not at equal horizontal and
            vertical scale.
          </p>
        </div>
      </div>
      <p className="field-note">
        {terrain.columns} × {terrain.rows} samples · {overview.missingSamples} unknown samples ·
        {authored ? (
          ' Authored recipe; no survey capture date or geodetic datum is claimed'
        ) : (
          <>
            {' '}
            Captured{' '}
            {terrain.acquired
              ? terrain.acquired.start === terrain.acquired.end
                ? terrain.acquired.start
                : `${terrain.acquired.start} to ${terrain.acquired.end}`
              : 'date unknown'}
          </>
        )}
        . Heights use {authored ? 'local authoring coordinates' : 'the stated vertical datum'};{' '}
        {terrain.referenceElevation} m is subtracted only for the local 3D origin. Grid spacing is
        not an accuracy claim.
      </p>
      {source &&
        (source.url ? (
          <a className="terrain-source" href={source.url} target="_blank" rel="noreferrer">
            {source.title}
            <ArrowUpRight size={12} />
          </a>
        ) : (
          <span className="terrain-source">{source.title}</span>
        ))}
    </section>
  );
}

export function SurveyNotebook({
  world,
  onClose,
  onSelect,
  onExport,
}: {
  world: WorldDocument;
  onClose: () => void;
  onSelect: (id: string) => void;
  onExport: (report: ReturnType<typeof analyzeSurvey>) => void;
}) {
  const report = useMemo(() => analyzeSurvey(world), [world]);
  const [showAll, setShowAll] = useState(false);
  const review = showAll ? report.review : report.review.slice(0, 8);
  return (
    <Modal title="Terrain & survey notebook" onClose={onClose}>
      <p className="notebook-intro">
        Read the terrain, see what we know, and find the next useful observation. This describes the
        recorded world, not the completeness of the real place.
      </p>
      <TerrainReading world={world} />
      <section className="notebook-section">
        <h3>Evidence, without a confidence score</h3>
        <div className="evidence-counts">
          {Object.entries(report.factEvidence).map(([key, count]) => (
            <span key={key}>
              <strong>{count}</strong>
              {key}
            </span>
          ))}
        </div>
        <p className="field-note">
          A source link on an estimate does not make it sourced. Attribution is retained; claims are
          not independently verified by this report.
        </p>
      </section>
      <section className="notebook-section">
        <h3>What would improve the next reconstruction?</h3>
        <p>
          Check exterior heights, floors and materials; tree species and heights; street direction,
          lanes and whole-road speeds.
        </p>
        <div className="review-summary">
          <span>{report.checkedFields.sourced} sourced fields</span>
          <span>{report.checkedFields.interpreted} interpreted</span>
          <span>{report.checkedFields.missing} unrecorded / unknown</span>
        </div>
        <div className="survey-review-list">
          {review.map((item) => (
            <button
              key={item.objectId}
              onClick={() => {
                onSelect(item.objectId);
                onClose();
              }}
            >
              <strong>
                {item.label}
                <ArrowUpRight size={13} />
              </strong>
              <span>
                {item.unresolvedGround ? 'Ground coverage missing. ' : ''}
                {item.questions
                  .filter((question) => question.status !== 'sourced')
                  .map(
                    (question) =>
                      `${question.label}: ${question.status === 'missing' ? 'unknown' : 'interpreted'}`,
                  )
                  .join(' · ')}
              </span>
            </button>
          ))}
        </div>
        {report.review.length > 8 && (
          <button className="text-button" onClick={() => setShowAll(!showAll)}>
            {showAll ? 'Show fewer objects' : `Show all ${report.review.length} objects to review`}
          </button>
        )}
        {!report.review.length && (
          <p>No gaps in these selected field checks. Other observations may still be missing.</p>
        )}
        <p className="field-note">
          A limit for one street segment does not resolve the whole road. Missing buildings,
          entrances, curbs, furniture and other unrecorded objects need a separate field survey.
        </p>
      </section>
      <section className="notebook-section">
        <h3>Patterns to carry into an imagined place</h3>
        <div className="terrain-stats">
          <span>
            <strong>{number(report.patterns.recordedObjectsPerHectare)}</strong>Recorded objects /
            ha
          </span>
          <span>
            <strong>{number(report.patterns.medianRecordedBuildingHeight.metres)} m</strong>Median
            building mass height · n={report.patterns.medianRecordedBuildingHeight.sampleCount}
          </span>
          <span>
            <strong>{number(report.patterns.medianTreeNearestNeighbor.metres)} m</strong>Median
            nearest tree · n={report.patterns.medianTreeNearestNeighbor.sampleCount}
          </span>
        </div>
        <p className="field-note">
          These describe this specimen, not universal generation rules. Building heights often come
          from estimates. Tree centers can represent crowns or groups, so their spacing is not a
          planting recommendation.
        </p>
      </section>
      <button className="button" onClick={() => onExport(report)}>
        <ArrowDownToLine size={15} />
        Export survey notebook
      </button>
      <p className="field-note">
        The JSON report includes evidence counts, review questions, descriptive patterns and
        sources. The world export remains the editable spatial document.
      </p>
    </Modal>
  );
}
