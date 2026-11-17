"""Offline bounded selections from six small Geofabrik extracts; requires osmium==4.3.2.
No network calls, contributor identity fields, names, addresses, or contact tags are read.
"""
import gzip
import hashlib
import json
import math
from pathlib import Path
import osmium

ROOT = Path(__file__).resolve().parent.parent
CONFIG = json.loads((ROOT / "scripts/layout-study-places.json").read_text(encoding="utf-8"))
CACHE = ROOT / ".wordscape/layout-study"
OUT = ROOT / "public/reference/layout-study"
KEYS = {"building", "building:part", "highway", "landuse", "leisure", "natural", "area", "layer", "bridge", "tunnel", "height", "building:levels"}

def bounds(p):
    radius = 6378137
    scale = math.cos(math.radians(p["lat"]))
    cy = radius * math.log(math.tan(math.pi / 4 + math.radians(p["lat"]) / 2))
    half = p["size"] / (2 * scale)
    latitude = lambda y: math.degrees(2 * math.atan(math.exp(y / radius)) - math.pi / 2)
    dx = math.degrees(half / radius)
    return {"west": p["lon"] - dx, "east": p["lon"] + dx, "south": latitude(cy-half), "north": latitude(cy+half)}

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for region, url in CONFIG["regions"].items():
        path = CACHE / f"{region}.osm.pbf"
        if not path.exists():
            print(f"{region}: unavailable", flush=True)
            continue
        selected = [dict(p, bounds=bounds(p), elements=[], omittedLongWays=0) for p in CONFIG["places"] if p.get("region") == region]
        with osmium.io.Reader(str(path)) as reader:
            header = reader.header()
            snapshot = header.get("osmosis_replication_timestamp") or None
        for way in osmium.FileProcessor(str(path)).with_locations().with_filter(osmium.filter.EntityFilter(osmium.osm.WAY)):
            tags = {tag.k: tag.v for tag in way.tags if tag.k in KEYS}
            if not any(key in tags for key in ("building", "highway", "landuse", "leisure", "natural")):
                continue
            if not all(n.location.valid() for n in way.nodes):
                continue
            geometry = [{"lat": n.lat, "lon": n.lon} for n in way.nodes]
            if not geometry:
                continue
            xs, ys = [p["lon"] for p in geometry], [p["lat"] for p in geometry]
            for place in selected:
                b = place["bounds"]
                if max(xs) < b["west"] or min(xs) > b["east"] or max(ys) < b["south"] or min(ys) > b["north"]:
                    continue
                if len(geometry) > 5000:
                    place["omittedLongWays"] += 1
                    continue
                place["elements"].append({"type":"way", "id":way.id, "nodes":[n.ref for n in way.nodes], "geometry":geometry, "tags":tags})
        metadata_path = CACHE / f"{region}.download.json"
        metadata = json.loads(metadata_path.read_text(encoding="utf-8")) if metadata_path.exists() else {}
        for place in selected:
            record = {"version":1, "sample":{k:v for k,v in place.items() if k != "elements"}, "source":{"provider":"Geofabrik", "url":url, "snapshotAt":snapshot, "sha256":hashlib.sha256(path.read_bytes()).hexdigest(), "downloadBytes":path.stat().st_size, **metadata}, "elements":place["elements"]}
            output = json.dumps(record, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
            (OUT / f"{place['id']}.osm.json.gz").write_bytes(gzip.compress(output, mtime=0))
            print(f"{place['id']}: {len(place['elements'])} bounded candidate ways; snapshot {snapshot}", flush=True)

if __name__ == "__main__":
    main()
