export const aerialReferences = [
  {
    id: 'noaa-2022',
    label: 'Detail · 2022 · 25 cm',
    image: '/reference/washington-square-noaa-2022.jpg',
    title: 'NOAA orthophoto, August 2022',
    url: 'https://www.fisheries.noaa.gov/inport/item/69582',
    attribution: 'NOAA · CC0',
    note: '25 cm native resolution. Sharper detail, captured August 4–7, 2022.',
  },
  {
    id: 'naip-2024',
    label: 'Baseline · 2024 · 60 cm',
    image: '/reference/washington-square-naip.jpg',
    title: 'USDA NAIP, May 2024',
    url: 'https://apps.geo.fpac.usda.gov/geo-imagery/rest/services/naip/conus_naip/ImageServer',
    attribution: 'USDA NAIP · Public domain',
    note: '60 cm native resolution. Newer capture from May 20, 2024; exported at 30 cm pixels without extra source detail.',
  },
] as const;
