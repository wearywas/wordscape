"""Reproducible exact plan-polygon audit of the three retained Round 8 scenes.

Optional development tool: Python 3 + Shapely 2.1.1. No app/runtime dependency,
network request, mesh modification, geometry repair, or world-file mutation.
Run: python scripts/audit-generated-layouts.py
"""
import argparse
import hashlib
import json
import math
from datetime import datetime, timezone
from itertools import combinations
from pathlib import Path

import shapely
from shapely.geometry import Polygon

ROOT = Path(__file__).resolve().parent.parent
DEFAULTS = [
    "public/examples/lanternwater-lanes.wordscape.json",
    "public/examples/mossbell-retreat.wordscape.json",
    "public/examples/lanternwater-lanes-refined.wordscape.json",
]
AREA_EPSILON = 1e-6
CONTACT_EPSILON = 1e-7


def polygon(obj):
    points = obj.get("footprint") or [
        [-obj["width"] / 2, -obj["depth"] / 2],
        [obj["width"] / 2, -obj["depth"] / 2],
        [obj["width"] / 2, obj["depth"] / 2],
        [-obj["width"] / 2, obj["depth"] / 2],
    ]
    angle = math.radians(obj["rotation"])
    c, s = math.cos(angle), math.sin(angle)
    return Polygon([
        (obj["x"] + x * c - y * s, obj["y"] + x * s + y * c)
        for x, y in points
    ])


def record(obj):
    return {
        "id": obj["id"], "label": obj["label"], "kind": obj["kind"],
        "hasCustomRecipe": bool(obj.get("geometry")),
        "baseElevation": obj.get("elevation", 0), "height": obj["height"],
        "grounding": obj.get("grounding", "absolute"),
    }


def measure_pair(a, b, polygons):
    pa, pb = polygons[a["id"]], polygons[b["id"]]
    intersection = pa.intersection(pb)
    area = intersection.area
    gap = pa.distance(pb)
    aminx, aminy, amaxx, amaxy = pa.bounds
    bminx, bminy, bmaxx, bmaxy = pb.bounds
    box_width = min(amaxx, bmaxx) - max(aminx, bminx)
    box_depth = min(amaxy, bmaxy) - max(aminy, bminy)
    # Matches reviewWorldGeneration's conservative envelope warning condition.
    envelope_warning = box_width > 0.05 and box_depth > 0.05
    positive = area > AREA_EPSILON
    contact = not positive and gap <= CONTACT_EPSILON
    classification = "positive-area-overlap" if positive else "boundary-contact" if contact else "envelope-only"
    return {
        "a": record(a), "b": record(b),
        "classification": classification,
        "intersectionAreaM2": round(area, 9),
        "minimumGapM": round(gap, 9),
        "intersectionBounds": [round(v, 9) for v in intersection.bounds] if not intersection.is_empty else None,
        "boundaryContactLengthM": round(pa.boundary.intersection(pb.boundary).length, 9) if contact else None,
        "wouldProduceEnvelopeWarning": envelope_warning,
        "envelopeOverlapAreaM2": round(max(0, box_width) * max(0, box_depth), 9),
    }


def audit(path):
    data = path.read_bytes()
    world = json.loads(data)
    objects = world["objects"]
    parents = {o.get("parentId") for o in objects if o.get("parentId")}
    def suppressed(o):
        return (o["kind"] == "building" and not o.get("geometry") and o["id"] in parents and
                any(f["key"] == "building.isOutline" and f["value"] is True and f["evidence"] != "unknown" for f in o.get("facts", [])))
    solids = [o for o in objects if o["kind"] in ("building", "landmark") and not suppressed(o)]
    corridors = [o for o in objects if o["kind"] in ("road", "pavement", "water")]
    polygons = {o["id"]: polygon(o) for o in solids + corridors}
    invalid = [oid for oid, p in polygons.items() if not p.is_valid or p.is_empty or p.area <= 0]
    if invalid:
        raise ValueError(f"Invalid input polygons in {path.name}: {invalid}; no automatic repair is allowed.")
    solid_pairs = [measure_pair(a, b, polygons) for a, b in combinations(solids, 2)]
    route_pairs = [measure_pair(a, b, polygons) for a in solids for b in corridors]
    solid_overlaps = [p for p in solid_pairs if p["classification"] == "positive-area-overlap"]
    solid_contacts = [p for p in solid_pairs if p["classification"] == "boundary-contact"]
    relevant_routes = [p for p in route_pairs if p["wouldProduceEnvelopeWarning"] or p["classification"] in ("positive-area-overlap", "boundary-contact")]
    overlaps = [p for p in relevant_routes if p["classification"] == "positive-area-overlap"]
    warnings = [p for p in relevant_routes if p["wouldProduceEnvelopeWarning"]]
    return {
        "file": path.relative_to(ROOT).as_posix(), "sha256": hashlib.sha256(data).hexdigest(),
        "name": world["name"], "objectCount": len(objects), "solidCount": len(solids),
        "routeAndWaterObjectCount": len(corridors), "hasTerrain": "terrain" in world,
        "summary": {
            "solidPairsTested": len(solid_pairs), "solidPositiveAreaOverlaps": len(solid_overlaps),
            "solidBoundaryContacts": len(solid_contacts), "solidCorridorPairsTested": len(route_pairs),
            "conservativeEnvelopeWarnings": len(warnings),
            "solidCorridorPositiveAreaOverlaps": len(overlaps),
            "envelopeWarningsWithoutPositiveAreaOverlap": sum(p["classification"] != "positive-area-overlap" for p in warnings),
            "positiveOverlapAreaM2": round(sum(p["intersectionAreaM2"] for p in overlaps), 9),
        },
        "solidOverlaps": solid_overlaps, "solidBoundaryContacts": solid_contacts,
        "solidCorridorPairs": relevant_routes,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("worlds", nargs="*", default=DEFAULTS)
    parser.add_argument("--output", default="docs/history/world-08/layout-intersections-audit.json")
    args = parser.parse_args()
    results = [audit((ROOT / path).resolve()) for path in args.worlds]
    report = {
        "version": 1, "createdAt": datetime.now(timezone.utc).isoformat(),
        "tool": f"Python Shapely {shapely.__version__}",
        "method": "Exact intersection of declared simple plan polygons after object-local metre coordinates are rotated counterclockwise and translated into world x-east/y-north metres. Rectangular fallback matches getFootprint for buildings, landmarks, roads, pavement and water.",
        "positiveAreaThresholdM2": AREA_EPSILON, "contactDistanceThresholdM": CONTACT_EPSILON,
        "limitations": [
            "Exact refers to polygon intersection rather than bounding envelopes; floating-point tolerances remain. This is not surveying accuracy or a navigation/accessibility guarantee.",
            "Declared footprints are not mesh silhouettes. Open-sided pavilions, overhangs, decks, columns and custom recipes can make a footprint overlap intentional or physically clear.",
            "This audit does not resolve vertical separation, terrain, walking collision meshes, doorway clearance, street usability, route-network connectivity, tree trunks or fixtures.",
            "No input world is changed, repaired or moved. Source SHA-256 hashes bind each result to the precise retained output.",
            "Boundary-only contact is listed separately from positive-area overlap so intended shared walls are not counted as overlapping area.",
        ],
        "worlds": results,
    }
    destination = (ROOT / args.output).resolve()
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    for result in results:
        print(result["file"], json.dumps(result["summary"]))
        for pair in result["solidOverlaps"] + result["solidCorridorPairs"]:
            if pair["classification"] == "positive-area-overlap":
                print(f'  {pair["a"]["label"]} / {pair["b"]["label"]}: {pair["intersectionAreaM2"]} m²')
    print(f"Saved {destination.relative_to(ROOT).as_posix()}")


if __name__ == "__main__":
    main()
