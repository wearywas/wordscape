"""Reproduce the CC0 NOAA 2022 crop; requires rasterio and Pillow.

Native source: EPSG:6339, 0.25 m. Output: shared north-up study bounds,
1440 pixels across 360 local metres. Metadata: fisheries.noaa.gov/inport/item/69582.
"""

from pathlib import Path

import rasterio
from rasterio.vrt import WarpedVRT
from rasterio.transform import from_bounds
from rasterio.enums import Resampling
from PIL import Image

url = ('https://coastalimagery.blob.core.windows.net/digitalcoast/'
       'SanFranciscoCA_RGBN_2022_9784/SanFranciscoCA_RGBN_2022_EPSG-6339.vrt')
bounds = (-13626868.937772121, 4551095.820916071,
          -13626413.32603338, 4551551.432654811)
output = Path(__file__).with_name('washington-square-noaa-2022.jpg')

with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN='EMPTY_DIR',
                  GDAL_HTTP_TIMEOUT='40', GDAL_HTTP_MULTIRANGE='YES'):
    with rasterio.open('/vsicurl/' + url) as src:
        print('Source', src.crs, src.res, src.count, flush=True)
        with WarpedVRT(src, crs='EPSG:3857',
                       transform=from_bounds(*bounds, 1440, 1440),
                       width=1440, height=1440,
                       resampling=Resampling.bilinear) as vrt:
            data = vrt.read([1, 2, 3])
        Image.fromarray(data.transpose(1, 2, 0)).save(output, quality=95)

print('Saved NOAA 2022', data.shape, 'range', int(data.min()), int(data.max()))
