"""Reproduce Washington Square terrain from USGS 3DEP, without a citywide download.

Requires rasterio and numpy. Uses the retained native 1 m subset by default;
--refresh-source reads that window again from the original public GeoTIFF.
No vertical datum conversion, terrain exaggeration, or missing-data fill occurs.
"""

import argparse
import hashlib
import json
import math
from pathlib import Path

import numpy as np
import rasterio
from affine import Affine
from rasterio.warp import Resampling, reproject, transform_bounds
from rasterio.windows import Window, from_bounds

ROOT = Path(__file__).resolve().parent
URL = ('https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/1m/Projects/'
       'CA_SanFrancisco_B23/TIFF/USGS_1M_10_x55y419_CA_SanFrancisco_B23.tif')
NATIVE = ROOT / 'washington-square-dem-2023-native.tif'
METADATA = 'https://www.fisheries.noaa.gov/inport/item/73506'
args = argparse.ArgumentParser(description=__doc__)
args.add_argument('--refresh-source', action='store_true')
options = args.parse_args()

geo = json.loads((ROOT / 'washington-square-georeference.json').read_text())
b = geo['exportBoundsEPSG3857']
bounds = (b['xmin'], b['ymin'], b['xmax'], b['ymax'])

if options.refresh_source or not NATIVE.exists():
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN='EMPTY_DIR',
                      GDAL_HTTP_TIMEOUT='35', CPL_VSIL_CURL_ALLOWED_EXTENSIONS='.tif'):
        with rasterio.open('/vsicurl/' + URL) as src:
            utm = transform_bounds('EPSG:3857', src.crs, *bounds, densify_pts=21)
            window = from_bounds(utm[0] - 10, utm[1] - 10,
                                 utm[2] + 10, utm[3] + 10, src.transform)
            left, top = math.floor(window.col_off), math.floor(window.row_off)
            window = Window(left, top,
                            math.ceil(window.col_off + window.width) - left,
                            math.ceil(window.row_off + window.height) - top)
            raw = src.read(1, window=window)
            profile = src.profile.copy()
            profile.update(width=raw.shape[1], height=raw.shape[0],
                           transform=src.window_transform(window), compress='deflate')
            with rasterio.open(NATIVE, 'w', **profile) as dst:
                dst.write(raw, 1)

with rasterio.open(NATIVE) as src:
    raw = src.read(1)
    valid = np.isfinite(raw) & (raw != src.nodata)
    # Pixel centers, not cell edges, lie on world nodes x/y = 0, 5, ..., 360.
    step = 5 / geo['metresPerMercatorUnit']
    target = Affine(step, 0, bounds[0] - step / 2,
                    0, -step, bounds[3] + step / 2)
    grid = np.full((73, 73), np.nan, dtype=np.float32)
    reproject(raw, grid, src_transform=src.transform, src_crs=src.crs,
              src_nodata=src.nodata, dst_transform=target, dst_crs='EPSG:3857',
              dst_nodata=np.nan, resampling=Resampling.bilinear)
    # Raster rows start north; the world contract starts at the southwest.
    grid = np.flipud(grid)
    source_info = {
        'url': URL, 'horizontalCrs': str(src.crs), 'resolutionMetres': list(src.res),
        'nodata': src.nodata, 'nativeSubsetSize': {'columns': src.width, 'rows': src.height},
        'nativeSubsetBounds': list(src.bounds), 'nativeSubsetTransform': list(src.transform)[:6],
        'nativeSubsetNodataCount': int((~valid).sum()),
        'nativeSubsetMin': float(raw[valid].min()), 'nativeSubsetMax': float(raw[valid].max()),
        'nativeSubsetNote': 'Original raster values and 1 m grid; includes a 10 m interpolation buffer.',
        'nativeSubsetSha256': hashlib.sha256(NATIVE.read_bytes()).hexdigest(),
    }

terrain = {
    'type': 'height-grid', 'columns': 73, 'rows': 73, 'spacing': 5,
    'origin': {'x': 0, 'y': 0},
    'heights': [round(float(z), 3) if np.isfinite(z) else None for z in grid.flat],
    'verticalDatum': 'NAVD88 (GEOID18)', 'referenceElevation': 10,
    'sourceId': 'usgs-dem-2023', 'sourceResolution': 1, 'interpolation': 'bilinear',
    'acquired': {'start': '2023-04-20', 'end': '2023-04-20'},
    'notes': 'Absolute bare-earth elevations in metres. Row-major south to north, west to east. '
             'USGS 1 m standard DEM sampled onto 5 m nodes. Three decimal places preserve '
             'interpolation, not millimetre accuracy. The 10 m reference is only a render origin. '
             'Small walls, curbs and steps are not reliably represented; no vertical exaggeration.',
}
source_record = {
    'id': 'usgs-dem-2023',
    'title': 'USGS 3DEP bare-earth terrain · 20 April 2023',
    'url': METADATA,
    'attribution': 'U.S. Geological Survey / NV5 Geospatial. Public-domain 3DEP data; NOAA metadata.',
    'accessed': '2026-11-15',
    'notes': 'CA_SanFrancisco_B23 lidar, acquired 2023-04-20. Native project DEM 0.25 m; '
             'this world uses the standardized USGS 1 m DEM, sampled onto 5 m nodes. '
             'Absolute NAVD88 (GEOID18) metres. Source project accuracy tests are not local '
             'accuracy claims for this sampled grid. Native subset, metadata and extraction '
             'script are retained under public/reference. Ground beneath buildings is interpolated.',
}
gy, gx = np.gradient(grid.astype(float), 5, 5)
slopes = np.degrees(np.arctan(np.hypot(gx, gy)))
manifest = {
    'sourceId': terrain['sourceId'], 'title': 'USGS 3DEP 2023 San Francisco bare-earth DEM',
    'metadataUrl': METADATA, 'catalogRecord': 'washington-square-dem-catalog.json',
    'attribution': 'U.S. Geological Survey / NV5 Geospatial; NOAA metadata catalog.',
    'license': 'Public domain; the USGS product catalog states all 3DEP products are public domain.',
    'accessed': '2026-11-15', 'acquired': terrain['acquired'],
    'acquisitionNote': 'NOAA project metadata lists a discrete ground-condition date of 2023-04-20.',
    'verticalDatum': terrain['verticalDatum'], 'verticalCrs': 'EPSG:5703',
    'sourceProjectHorizontalCrs': 'EPSG:7131 (NAD83(2011) / San Francisco CS13)',
    'sourceProjectResolutionMetres': 0.25,
    'sourceProjectAccuracy': {
        'nonVegetatedRmseMetres': 0.0163, 'vegetated95thPercentileMetres': 0.1105,
        'note': 'Project-wide reported tests, not independently verified local accuracy of the 1 m product or 5 m world grid.',
    },
    'sourceRaster': source_info,
    'geographicBoundsEPSG4326': geo['geographicBoundsEPSG4326'],
    'worldBoundsMetres': geo['worldBoundsMetres'], 'exportBoundsEPSG3857': b,
    'metresPerMercatorUnit': geo['metresPerMercatorUnit'],
    'grid': {'columns': 73, 'rows': 73, 'spacingMetres': 5,
             'sampleConvention': 'Nodes include all four boundaries; heights[row * columns + column], x = column * 5, y = row * 5.',
             'nodata': None, 'nodataCount': int((~np.isfinite(grid)).sum()),
             'minElevation': float(np.nanmin(grid)), 'maxElevation': float(np.nanmax(grid)),
             'cornerElevationsSW_SE_NW_NE': [float(grid[0, 0]), float(grid[0, -1]), float(grid[-1, 0]), float(grid[-1, -1])],
             'medianSlopeDegrees': float(np.nanmedian(slopes)),
             'p95SlopeDegrees': float(np.nanpercentile(slopes, 95)),
             'maxSlopeDegrees': float(np.nanmax(slopes)),
             'slopeNote': 'Finite differences of the 5 m grid; local terrain breaks and source artifacts may influence extrema.'},
    'processing': 'Retain original 1 m raster window; horizontally reproject with bilinear resampling to matching 5 m node centers; reverse rows. No vertical transformation or gap fill.',
    'limitations': 'Buildings and tree canopies are excluded by the source ground classification. Ground beneath buildings and dense cover is interpolated. Later construction, retaining walls, steps and curbs require separate observations.',
}
(ROOT / 'washington-square-terrain.json').write_text(json.dumps(terrain, separators=(',', ':')) + '\n')
(ROOT / 'washington-square-dem-georeference.json').write_text(json.dumps(manifest, indent=2) + '\n')
(ROOT / 'washington-square-dem-source.json').write_text(json.dumps(source_record, indent=2) + '\n')
print(json.dumps(manifest['grid'], indent=2))
