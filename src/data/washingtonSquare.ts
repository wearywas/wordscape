import type {
  ObjectKind,
  WorldDocument,
  WorldFact,
  WorldObject,
  WorldSource,
  WorldTerrain,
} from '../world/types';
import terrain from '../../public/reference/washington-square-terrain.json';
import terrainSource from '../../public/reference/washington-square-dem-source.json';
import { getObjectBaseElevation } from '../world/terrain';
import edgeEnrichment from './washingtonSquareEdges.json';
import {
  washingtonSquareCirculation,
  washingtonSquareCirculationRelations,
  washingtonSquareCirculationSource,
} from './washingtonSquareCirculation';

/**
 * A hand-traced interpretation of USDA NAIP, acquired 2024-05-20.
 * The 1200 px reference covers 360 m: image (u,v) -> world (.3u, 360-.3v).
 * Roof edges / tree crowns are observed; heights and hidden ground edges are estimates.
 * These deliberately simple polygons are not cadastral or engineering survey data.
 */
type Pixel = [number, number];
const round = (value: number) => Math.round(value * 100) / 100;
const sourceId = 'naip-2024';

function polygon(
  id: string,
  label: string,
  kind: ObjectKind,
  pixels: Pixel[],
  height: number,
  description: string,
  tags: string[] = [],
): WorldObject {
  const points = pixels.map(([u, v]) => [round(u * 0.3), round(360 - v * 0.3)] as Pixel);
  const xs = points.map(([x]) => x),
    ys = points.map(([, y]) => y);
  const left = Math.min(...xs),
    right = Math.max(...xs);
  const bottom = Math.min(...ys),
    top = Math.max(...ys);
  const x = round((left + right) / 2),
    y = round((bottom + top) / 2);
  return {
    id,
    label,
    kind,
    description,
    x,
    y,
    width: round(right - left),
    depth: round(top - bottom),
    height,
    elevation: kind === 'grass' ? 0.08 : 0,
    rotation: 0,
    layer: kind === 'road' ? 0 : kind === 'pavement' ? 1 : kind === 'grass' ? 2 : 3,
    evidence: 'observed',
    sourceId,
    footprint: points.map(([px, py]) => [round(px - x), round(py - y)]),
    tags: [
      'aerial-trace',
      ...(kind === 'building' || kind === 'landmark' ? ['height-estimate'] : []),
      ...tags,
    ],
  };
}

const streets: WorldObject[] = [
  polygon(
    'filbert',
    'Filbert Street',
    'road',
    [
      [0, 480],
      [1200, 313],
      [1200, 350],
      [0, 518],
    ],
    0.08,
    'Observed east–west street separating the church from the square; curb edges simplified.',
  ),
  polygon(
    'union',
    'Union Street',
    'road',
    [
      [0, 836],
      [1200, 669],
      [1200, 713],
      [0, 880],
    ],
    0.08,
    'Observed southern edge of the square; road width varies near Columbus.',
  ),
  polygon(
    'powell',
    'Powell Street',
    'road',
    [
      [270, 0],
      [304, 0],
      [472, 1200],
      [430, 1200],
    ],
    0.08,
    'Observed street west of the main square; extends through the study boundary.',
  ),
  polygon(
    'stockton',
    'Stockton Street',
    'road',
    [
      [755, 0],
      [793, 0],
      [973, 1200],
      [935, 1200],
    ],
    0.08,
    'Observed eastern park frontage; straightened between visible junctions.',
  ),
  polygon(
    'columbus',
    'Columbus Avenue',
    'road',
    [
      [0, 232],
      [1055, 1200],
      [974, 1200],
      [0, 291],
    ],
    0.09,
    'Observed northwest–southeast diagonal that cuts off Marini Plaza from the main park.',
  ),
  polygon(
    'greenwich',
    'Greenwich Street',
    'road',
    [
      [0, 142],
      [998, 0],
      [1200, 0],
      [0, 181],
    ],
    0.08,
    'Observed northern cross street, clipped to the image boundary.',
  ),
  polygon(
    'green',
    'Green Street',
    'road',
    [
      [0, 1173],
      [1200, 1002],
      [1200, 1044],
      [102, 1200],
      [0, 1200],
    ],
    0.08,
    'Observed southern cross street, clipped to the image boundary.',
  ),
];

const landscape: WorldObject[] = [
  polygon(
    'park-walk',
    'Perimeter promenade',
    'pavement',
    [
      [386, 477],
      [803, 420],
      [819, 493],
      [848, 690],
      [575, 742],
      [401, 577],
    ],
    0.12,
    'Observed paved park perimeter, simplified as a base beneath lawn and canopy; hidden edges interpolated.',
  ),
  polygon(
    'main-lawn',
    'Washington Square lawn',
    'grass',
    [
      [534, 541],
      [568, 517],
      [622, 498],
      [674, 482],
      [720, 480],
      [754, 493],
      [780, 517],
      [799, 558],
      [800, 601],
      [785, 643],
      [762, 668],
      [729, 682],
      [690, 684],
      [660, 674],
      [629, 655],
      [588, 647],
      [553, 650],
      [532, 624],
      [521, 584],
    ],
    0.12,
    'Broad continuous lawn traced from visible green edge. Tree crowns obscure portions of the western boundary.',
  ),
  polygon(
    'south-garden',
    'South garden',
    'grass',
    [
      [569, 689],
      [605, 674],
      [642, 687],
      [660, 713],
      [621, 730],
      [582, 727],
      [555, 711],
    ],
    0.12,
    'Small planted island between paths near the southern park entrance; planting type not identified.',
  ),
  polygon(
    'playground',
    'Children’s play area',
    'pavement',
    [
      [416, 496],
      [449, 494],
      [470, 520],
      [465, 553],
      [445, 574],
      [422, 562],
      [409, 531],
    ],
    0.14,
    'Observed pale green play surface northwest of the lawn; equipment is represented by the area only.',
    ['playground'],
  ),
  polygon(
    'marini-plaza',
    'Marini Plaza',
    'pavement',
    [
      [394, 653],
      [486, 743],
      [500, 761],
      [417, 778],
      [404, 733],
    ],
    0.14,
    'The triangular public space west of Columbus, visible mostly beneath mature tree crowns.',
  ),
  polygon(
    'church-forecourt',
    'Church forecourt',
    'pavement',
    [
      [540, 387],
      [659, 370],
      [663, 398],
      [544, 415],
    ],
    0.14,
    'Narrow visible paved approach between the church frontage and Filbert Street.',
  ),
];

const buildings: WorldObject[] = [
  polygon(
    'church',
    'Saints Peter and Paul',
    'landmark',
    [
      [532, 231],
      [629, 216],
      [653, 372],
      [555, 387],
    ],
    23,
    'Observed church roof and approximate ground footprint. Parish reports 100 × 160 ft overall; nave mass height estimated at 23 m. Towers are separate objects.',
    ['church', 'gabled-roof'],
  ),
  polygon(
    'church-west-tower',
    'West bell tower',
    'landmark',
    [
      [550, 356],
      [575, 352],
      [580, 378],
      [555, 382],
    ],
    58.22,
    'Approximate tower base inferred beneath the visible roof. Total spire height is parish-reported 191 ft (58.22 m).',
    ['church', 'tower', 'reported-height'],
  ),
  polygon(
    'church-east-tower',
    'East bell tower',
    'landmark',
    [
      [624, 345],
      [649, 341],
      [653, 367],
      [628, 371],
    ],
    58.22,
    'Approximate tower base inferred beneath the visible roof. Total spire height is parish-reported 191 ft (58.22 m).',
    ['church', 'tower', 'reported-height'],
  ),
  polygon(
    'school-north',
    'School building',
    'building',
    [
      [359, 233],
      [484, 214],
      [497, 288],
      [370, 307],
    ],
    13,
    'Observed large light roof west of the church; school use inferred from the church campus. Height estimated.',
  ),
  polygon(
    'school-hall',
    'Campus hall',
    'building',
    [
      [373, 309],
      [488, 291],
      [504, 402],
      [390, 420],
    ],
    11,
    'Observed broad pale roof on the church campus. East edge follows the seam beside the terracotta annex; hidden ground boundary, program and height inferred.',
    ['flat-roof'],
  ),
  polygon(
    'campus-annex',
    'Campus annex',
    'building',
    [
      [495, 336],
      [540, 329],
      [550, 391],
      [507, 399],
    ],
    10,
    'Observed terracotta roof beside the hall; height estimated.',
  ),
  polygon(
    'filbert-west-corner',
    'Corner apartments',
    'building',
    [
      [227, 334],
      [296, 324],
      [309, 421],
      [251, 431],
      [236, 416],
    ],
    12,
    'Observed corner roof west of Powell; residential use and height inferred.',
  ),
  polygon(
    'filbert-east-1',
    'Filbert row 1',
    'building',
    [
      [669, 288],
      [711, 281],
      [721, 355],
      [679, 362],
    ],
    12,
    'Observed attached roof east of the church; property boundary and height approximate.',
  ),
  polygon(
    'filbert-east-2',
    'Filbert row 2',
    'building',
    [
      [713, 281],
      [770, 273],
      [782, 347],
      [724, 356],
    ],
    13,
    'Observed attached roof on Filbert; property boundary and height approximate.',
  ),
  polygon(
    'campus-northeast',
    'North courtyard block',
    'building',
    [
      [661, 209],
      [765, 193],
      [777, 269],
      [674, 285],
    ],
    13,
    'Observed roof group behind the Filbert row; courtyards omitted and height estimated.',
  ),
  polygon(
    'greenwich-row-1',
    'Greenwich row 1',
    'building',
    [
      [345, 143],
      [416, 131],
      [429, 211],
      [358, 222],
    ],
    11,
    'Observed north-block roof; detailed parcel divisions omitted. Height estimated.',
  ),
  polygon(
    'greenwich-row-2',
    'Greenwich row 2',
    'building',
    [
      [427, 128],
      [478, 119],
      [492, 200],
      [440, 208],
    ],
    12,
    'Observed north-block roof; height estimated.',
  ),
  polygon(
    'greenwich-row-3',
    'Greenwich row 3',
    'building',
    [
      [490, 118],
      [551, 108],
      [565, 193],
      [504, 203],
    ],
    13,
    'Observed north-block roof; height estimated.',
  ),
  polygon(
    'greenwich-row-4',
    'Greenwich row 4',
    'building',
    [
      [563, 105],
      [646, 93],
      [661, 180],
      [578, 193],
    ],
    12,
    'Observed north-block light roof; height estimated.',
  ),
  polygon(
    'greenwich-row-5',
    'Greenwich row 5',
    'building',
    [
      [666, 89],
      [749, 76],
      [763, 163],
      [680, 176],
    ],
    13,
    'Observed corner roof at Greenwich and Stockton; height estimated.',
  ),
  polygon(
    'stockton-northwest',
    'Stockton north block',
    'building',
    [
      [821, 64],
      [900, 53],
      [912, 127],
      [834, 139],
    ],
    14,
    'Observed northeast neighborhood roof; height and residential use inferred.',
  ),
  polygon(
    'stockton-northeast',
    'Stockton roof cluster',
    'building',
    [
      [844, 160],
      [922, 149],
      [940, 253],
      [860, 266],
    ],
    12,
    'Observed contiguous roofs east of Stockton, aggregated into one simplified mass.',
  ),
  polygon(
    'filbert-northeast',
    'Filbert corner block',
    'building',
    [
      [865, 269],
      [959, 253],
      [969, 321],
      [877, 336],
    ],
    13,
    'Observed roof group on the northeast side of the Filbert intersection; height estimated.',
  ),
  polygon(
    'park-east-1',
    'East frontage 1',
    'building',
    [
      [881, 410],
      [965, 396],
      [977, 475],
      [893, 489],
    ],
    12,
    'Observed corner building opposite the park. Street-level uses and height not measured.',
  ),
  polygon(
    'park-east-2',
    'East frontage 2',
    'building',
    [
      [895, 495],
      [993, 480],
      [1003, 544],
      [905, 558],
    ],
    11,
    'Observed light roofs east of the park; adjacent structures grouped. Height estimated.',
  ),
  polygon(
    'park-east-3',
    'East frontage 3',
    'building',
    [
      [910, 563],
      [993, 551],
      [1012, 675],
      [927, 688],
    ],
    13,
    'Observed large light roof opposite the southeast park corner; height estimated.',
  ),
  polygon(
    'park-east-back',
    'East block rooftops',
    'building',
    [
      [1005, 493],
      [1073, 483],
      [1099, 660],
      [1028, 671],
    ],
    14,
    'Observed deeper east-block roofs, represented by one envelope; height estimated.',
  ),
  polygon(
    'union-south-1',
    'Union south frontage',
    'building',
    [
      [665, 796],
      [781, 778],
      [793, 844],
      [712, 858],
    ],
    12,
    'Observed sloping roof envelope on the block south of Union; clipped near the diagonal frontage.',
  ),
  polygon(
    'union-south-2',
    'South block corner',
    'building',
    [
      [787, 777],
      [865, 765],
      [877, 834],
      [799, 846],
    ],
    14,
    'Observed building at Union and Stockton; height estimated.',
  ),
  polygon(
    'columbus-south',
    'Columbus south frontage',
    'building',
    [
      [755, 868],
      [879, 849],
      [888, 905],
      [811, 919],
    ],
    12,
    'Observed pale roof along Columbus southeast of the square; height estimated.',
  ),
  polygon(
    'west-frontage-1',
    'Columbus west frontage',
    'building',
    [
      [218, 610],
      [333, 593],
      [347, 655],
      [230, 673],
    ],
    11,
    'Observed pale roof west of Columbus; height estimated.',
  ),
  polygon(
    'west-frontage-2',
    'Union west corner',
    'building',
    [
      [246, 689],
      [350, 674],
      [368, 787],
      [264, 804],
    ],
    12,
    'Observed west-block roof group beside Union; fine parcel divisions omitted.',
  ),
  polygon(
    'southwest-block',
    'Southwest rooftops',
    'building',
    [
      [441, 910],
      [622, 884],
      [637, 942],
      [450, 969],
    ],
    12,
    'Observed broad roof south of Union and west of Columbus; grouped mass and height estimated.',
  ),
];

// Selected visible canopy centres and diameters in image pixels, not a tree inventory.
const canopySamples: [string, string, number, number, number, number][] = [
  ['north-1', 'North grove 1', 496, 505, 72, 16],
  ['north-2', 'North grove 2', 543, 495, 68, 15],
  ['north-3', 'North grove 3', 583, 493, 68, 16],
  ['north-4', 'North grove 4', 644, 482, 58, 14],
  ['north-5', 'North grove 5', 687, 459, 48, 12],
  ['north-6', 'North grove 6', 735, 458, 52, 13],
  ['east-1', 'East edge 1', 806, 438, 43, 12],
  ['east-2', 'East edge 2', 802, 486, 45, 12],
  ['east-3', 'East edge 3', 813, 522, 43, 13],
  ['east-4', 'East edge 4', 822, 560, 35, 11],
  ['east-5', 'East grove', 821, 621, 87, 17],
  ['south-1', 'South edge 1', 846, 699, 42, 11],
  ['south-2', 'South edge 2', 790, 685, 57, 13],
  ['south-3', 'South edge 3', 755, 699, 54, 14],
  ['south-4', 'South edge 4', 730, 720, 34, 10],
  ['south-5', 'South grove', 564, 705, 66, 16],
  ['west-1', 'West grove 1', 515, 648, 77, 16],
  ['west-2', 'West grove 2', 503, 612, 71, 15],
  ['west-3', 'West grove 3', 484, 562, 57, 14],
  ['west-4', 'West grove 4', 488, 714, 51, 12],
  ['marini-1', 'Marini canopy 1', 408, 662, 69, 16],
  ['marini-2', 'Marini canopy 2', 427, 709, 62, 15],
  ['marini-3', 'Marini canopy 3', 416, 755, 58, 15],
  ['central-1', 'Lawn poplar 1', 658, 557, 28, 17],
  ['central-2', 'Lawn poplar 2', 665, 582, 25, 16],
  ['central-3', 'Lawn poplar 3', 650, 602, 26, 16],
  ['filbert-1', 'Filbert street tree 1', 408, 426, 25, 8],
  ['filbert-2', 'Filbert street tree 2', 445, 421, 24, 8],
  ['filbert-3', 'Filbert street tree 3', 472, 417, 24, 8],
];

const trees: WorldObject[] = canopySamples.map(([id, label, u, v, diameter, height]) => ({
  id: `tree-${id}`,
  label,
  kind: 'tree',
  x: round(u * 0.3),
  y: round(360 - v * 0.3),
  width: round(diameter * 0.3),
  depth: round(diameter * 0.3),
  height,
  elevation: 0,
  rotation: 0,
  layer: 4,
  evidence: 'observed',
  sourceId,
  description:
    'Selected canopy visible in the 2024 aerial. Crown centre and size are approximate; trunk position, species and height are inferred. Overlapping crowns may contain more than one tree.',
  tags: [
    'canopy-observation',
    'height-estimate',
    ...(id.startsWith('central') ? ['columnar'] : []),
  ],
}));

// Facts distinguish measured/reported attributes from visual inference and missing data.
const fact = (
  key: string,
  value: WorldFact['value'],
  evidence: WorldFact['evidence'],
  sourceIds: string[] = [],
  note?: string,
  unit?: string,
): WorldFact => ({
  key,
  value,
  evidence,
  ...(sourceIds.length ? { sourceIds } : {}),
  ...(note ? { note } : {}),
  ...(unit ? { unit } : {}),
});
const unknown = (key: string, note: string) => fact(key, null, 'unknown', [], note);

const detailSources: WorldSource[] = [
  {
    id: 'noaa-2022',
    title: 'NOAA orthophoto · August 2022 · 25 cm',
    url: 'https://www.fisheries.noaa.gov/inport/item/69582',
    attribution: 'NOAA National Geodetic Survey / Office for Coastal Management. CC0-1.0.',
    accessed: '2026-11-15',
    notes:
      'Acquired 4–7 August 2022; nominal 0.25 m GSD. Higher detail but older than the 2024 NAIP reference. Metadata explicitly dedicates imagery to CC0.',
  },
  {
    id: 'sf-aerial-viewer',
    title: 'SF Planning aerial viewer · 8 cm layers',
    url: 'https://sfplanninggis.org/1938/',
    attribution: 'City and County of San Francisco, Planning Department',
    accessed: '2026-11-15',
    notes:
      'External inspection link. Includes p2024_rgb8cm and p2025_rgb8cm. Dataset-specific redistribution rights were not established from official metadata, so city tiles are not bundled.',
  },
  {
    id: 'park-arbor-2017',
    title: 'Washington Square · 2017 tree assessment / 2018 plans',
    url: 'https://commissions.sfplanning.org/hpcpackets/2018-003700COA.pdf',
    attribution: 'SF Planning / SF Recreation and Parks / HortScience',
    accessed: '2026-11-15',
    notes:
      'Pages 45–46, 58 and 65 identify central Lombardy poplars and provide a schematic tree map. Pages 2–5 describe wood benches with CMU legs and perimeter improvements. Historical inventory, not proof of every present tree.',
  },
  {
    id: 'street-trees',
    title: 'SF Public Works street tree inventory',
    url: 'https://data.sf.gov/City-Infrastructure/Street-Tree-List/tkzw-k3nq',
    attribution: 'San Francisco Public Works; Open Data Commons PDDL',
    accessed: '2026-11-15',
    notes:
      '668 Filbert records 142751–142754 locate four London planes. Positions imported; no DBH used as crown diameter. Extract saved in public/reference.',
  },
  {
    id: 'street-directions',
    title: 'SF streets · active centerlines and direction',
    url: 'https://data.sf.gov/Geographic-Locations-and-Boundaries/Streets-Active-and-Retired/3psu-pn9h',
    attribution: 'City and County of San Francisco; Open Data Commons PDDL',
    accessed: '2026-11-15',
    notes:
      'Active crop-intersecting segments: B means traffic legal both directions. Powell contains B/F/T segments, so no single direction is assigned to its aggregate road object.',
  },
  {
    id: 'street-speeds',
    title: 'SFMTA speed limits per street segment',
    url: 'https://data.sf.gov/Transportation/Speed-Limits-per-Street-Segment/3t7b-gebn',
    attribution: 'SFMTA; Open Data Commons PDDL',
    accessed: '2026-11-15',
    notes:
      'Columbus 20 mph; Union/Stockton/Green have 20 mph sections. Preserve segment scope. Zero is a default-data code, not a 0 mph restriction. Filbert school-zone record is 15 mph and dated 2018. These are reference attributes, not live driving advice.',
  },
  {
    id: 'sfac-franklin',
    title: 'Benjamin Franklin · city art collection',
    url: 'https://kiosk.sfartscommission.org/objects-1/info?objectName=Benjamin+Franklin+%281706-1790%29&query=keywordPath+%3D+%22CE%22+and+Creation_Place2+%3D+%22%22%22%22&sort=0',
    attribution: 'San Francisco Arts Commission; accession 1879.1',
    accessed: '2026-11-15',
    notes:
      'Catalog reports installed dimensions of 204 × 40 × 40 in, sculpture 66 in tall, base 138 in tall; pot metal on concrete. Photos remain external.',
  },
  {
    id: 'church-guide',
    title: 'Sacred Space International · church architecture',
    url: 'https://www.pbs.org/godinamerica/art/sfo_cityguide.pdf#page=7',
    attribution: 'Sacred Space International / PBS, 2010',
    accessed: '2026-11-15',
    notes:
      'Pages 5–7: Charles Fantoni; Gothic Revival with Romanesque details; steel and reinforced concrete; school on fifth level; nave interior 60 ft high. Interior clearance is not roof height.',
  },
  {
    id: 'park-history',
    title: 'Washington Square · city landmark history',
    url: 'https://sfplanninggis.org/docs/landmarks_and_districts/LM226.pdf',
    attribution: 'San Francisco Planning, landmark 226, 1999',
    accessed: '2026-11-15',
    notes:
      'Park history and context, including Franklin statue relocation 1904, predominance of three-story buildings on park perimeter and surviving historic landscape.',
  },
  {
    id: 'maps-detail',
    title: 'Washington Square · map and street-level reference',
    url: 'https://www.google.com/maps/@37.8008,-122.4102,19z/data=!3m1!1e3',
    attribution: 'Google Maps; imagery attribution shown by the provider',
    accessed: '2026-11-15',
    notes:
      'External inspection only. Used qualitatively for visible benches and monument comparison; no Google imagery is redistributed.',
  },
];

function fixture(
  id: string,
  label: string,
  type: string,
  u: number,
  v: number,
  width: number,
  depth: number,
  height: number,
  rotation = 0,
): WorldObject {
  return {
    id,
    label,
    kind: 'fixture',
    x: round(u * 0.3),
    y: round(360 - v * 0.3),
    width,
    depth,
    height,
    elevation: 0.15,
    rotation,
    layer: 5,
    evidence: 'inferred',
    sourceId: 'naip-2024',
    parentId: 'park-walk',
    tags: [type, 'detail-sample'],
    description:
      'Selected visible park detail, placed approximately from imagery. Dimensions and exact orientation are estimates; this is not a complete furniture inventory.',
    facts: [fact('fixture.type', type, 'observed', ['naip-2024', 'maps-detail'])],
    references: [{ sourceId: 'maps-detail', role: 'map', view: 'Park detail' }],
  };
}

const details: WorldObject[] = [
  {
    ...trees.find((tree) => tree.id === 'tree-filbert-3')!,
    id: 'tree-filbert-4',
    label: 'Filbert plane 4',
    x: 145.7,
    y: 233.43,
    sourceId: 'street-trees',
    width: 7.2,
    depth: 7.2,
    description:
      'Fourth London plane at 668 Filbert, located from city inventory record 142751. Crown size and height are estimates.',
  },
  {
    ...fixture(
      'franklin-statue',
      'Benjamin Franklin memorial',
      'statue',
      643,
      579,
      1.016,
      1.016,
      5.1816,
    ),
    sourceId: 'sfac-franklin',
    parentId: 'main-lawn',
    description:
      'Benjamin Franklin memorial on the central lawn. Overall dimensions and material are catalogued by SFAC; location is approximate from the aerial and park plan. The figure is rendered symbolically.',
    facts: [
      fact('fixture.type', 'statue', 'sourced', ['sfac-franklin']),
      fact('fixture.material', 'pot metal on concrete', 'sourced', ['sfac-franklin']),
      fact(
        'fixture.totalHeight',
        5.1816,
        'sourced',
        ['sfac-franklin'],
        'Installed overall height: 204 in.',
        'm',
      ),
      fact('fixture.baseHeight', 3.5052, 'sourced', ['sfac-franklin'], '138 in base.', 'm'),
      fact('fixture.figureHeight', 1.6764, 'sourced', ['sfac-franklin'], '66 in figure.', 'm'),
      fact('history.created', 1879, 'sourced', ['sfac-franklin']),
      fact('history.parkRelocation', 1904, 'sourced', ['park-history']),
    ],
    references: [
      { sourceId: 'sfac-franklin', role: 'photo', view: 'Catalog object and detail photos' },
      { sourceId: 'park-history', role: 'history' },
    ],
  },
  fixture('bench-east-1', 'East promenade bench 1', 'bench', 807, 506, 2.1, 0.65, 0.85, 98),
  fixture('bench-east-2', 'East promenade bench 2', 'bench', 814, 535, 2.1, 0.65, 0.85, 98),
  fixture('bench-south-1', 'South promenade bench 1', 'bench', 805, 702, 2.1, 0.65, 0.85, 8),
  fixture('bench-south-2', 'South promenade bench 2', 'bench', 765, 709, 2.1, 0.65, 0.85, 8),
  fixture('bench-south-3', 'South promenade bench 3', 'bench', 706, 708, 2.1, 0.65, 0.85, 8),
  fixture('bench-south-4', 'South promenade bench 4', 'bench', 706, 719, 2.1, 0.65, 0.85, 8),
  {
    ...fixture('play-structure', 'Play structure', 'playground', 438, 532, 5, 4, 2.6),
    parentId: 'playground',
    description:
      'A representative play structure within the verified playground. Its exact equipment layout is an authored simplification, not a manufacturer model.',
    evidence: 'authored',
    facts: [
      fact('fixture.type', 'playground', 'sourced', ['sf-parks']),
      fact('fixture.geometry', 'representative play equipment', 'authored'),
    ],
  },
  ...[
    [
      'crosswalk-north-east',
      'Filbert / Stockton crossing',
      'stockton',
      [
        [801, 392],
        [852, 384],
        [855, 399],
        [803, 407],
      ],
    ],
    [
      'crosswalk-north-west',
      'Filbert park crossing',
      'filbert',
      [
        [373, 447],
        [386, 446],
        [391, 480],
        [378, 482],
      ],
    ],
    [
      'crosswalk-south-east',
      'Union / Stockton crossing',
      'stockton',
      [
        [854, 695],
        [905, 688],
        [907, 701],
        [856, 708],
      ],
    ],
    [
      'crosswalk-union',
      'Union park crossing',
      'union',
      [
        [870, 708],
        [884, 706],
        [889, 741],
        [875, 743],
      ],
    ],
  ].map(([id, label, parentId, points]) => ({
    ...polygon(
      id as string,
      label as string,
      'fixture',
      points as Pixel[],
      0.03,
      'Visible striped pedestrian crossing; envelope traced approximately. Stripe count and paint condition are not inventoried.',
    ),
    elevation: 0.11,
    layer: 5,
    parentId: parentId as string,
    tags: ['crosswalk'],
    facts: [fact('fixture.type', 'crosswalk', 'observed', ['naip-2024'])],
  })),
  polygon(
    'park-restroom',
    'Park restroom',
    'building',
    [
      [445, 482],
      [473, 478],
      [477, 493],
      [450, 497],
    ],
    3.5,
    'Small roof at the northwest park entrance, identified as the restroom from official park plans. Footprint and exterior height are approximate.',
    ['park-facility'],
  ),
];

function enrich(object: WorldObject): WorldObject {
  const out: WorldObject = {
    ...object,
    facts: [...(object.facts ?? [])],
    references: [
      ...(object.references ?? []),
      { sourceId: object.sourceId ?? 'naip-2024', role: 'dataset' },
      { sourceId: 'sf-aerial-viewer', role: 'photo', view: 'North-up city aerial' },
    ],
  };
  const facts = out.facts!;
  if (object.kind === 'building') {
    facts.push(
      fact(
        'building.roofShape',
        'flat',
        'inferred',
        ['naip-2024'],
        'Simplified roof form; aerial does not resolve every roof plane.',
      ),
      unknown('building.material', 'Wall material is not established by this overhead survey.'),
      fact(
        'building.levels',
        object.id === 'park-restroom' ? 1 : object.id === 'school-hall' ? 1 : 3,
        'inferred',
        ['park-history'],
        'Scene estimate from mass height and neighborhood context, not a property record.',
      ),
      fact(
        'building.roofColor',
        object.id === 'campus-annex' ? '#a85d42' : '#c6c4b9',
        'inferred',
        ['naip-2024'],
        'Approximate roof color in aerial; lighting affects appearance.',
      ),
    );
  }
  if (object.id === 'church' || object.tags?.includes('tower')) {
    out.references!.push(
      { sourceId: 'parish', role: 'history' },
      { sourceId: 'church-guide', role: 'photo', view: 'Architecture and sanctuary' },
    );
    facts.push(
      fact(
        'building.material',
        'concrete',
        'sourced',
        ['church-guide'],
        'Steel and reinforced-concrete structure; finish not separately measured.',
      ),
      fact('building.style', 'Gothic Revival with Romanesque details', 'sourced', ['church-guide']),
      fact(
        'building.color',
        '#eee8da',
        'inferred',
        ['parish'],
        'Approximate pale facade appearance.',
      ),
      fact('building.facade', object.id === 'church' ? 'front-church' : 'church-tower', 'sourced', [
        'parish',
      ]),
      fact('building.roofShape', object.id === 'church' ? 'gabled' : 'spire', 'observed', [
        'naip-2024',
        'parish',
      ]),
    );
    if (object.tags?.includes('tower')) {
      out.parentId = 'church';
      out.evidence = 'inferred';
      out.sourceId = 'parish';
      out.tags = out.tags?.filter((t) => t !== 'height-estimate');
      facts.push(
        fact(
          'building.reportedHeight',
          58.22,
          'sourced',
          ['parish'],
          '191 ft includes the spire.',
          'm',
        ),
      );
    } else
      facts.push(
        fact(
          'building.reportedWidth',
          30.48,
          'sourced',
          ['parish'],
          '100 ft overall, not axis-aligned trace width.',
          'm',
        ),
        fact('building.reportedLength', 48.768, 'sourced', ['parish'], '160 ft overall.', 'm'),
        fact(
          'building.interiorHeight',
          18.288,
          'sourced',
          ['church-guide'],
          'Nave interior 60 ft; not exterior roof height.',
          'm',
        ),
        fact(
          'building.levels',
          5,
          'sourced',
          ['church-guide'],
          'Historical school occupied fifth level; not five equal nave floors.',
        ),
        fact('history.completed', 1924, 'sourced', ['parish']),
      );
  }
  if (object.kind === 'tree') {
    const central = object.id.startsWith('tree-central');
    out.parentId = central
      ? 'main-lawn'
      : object.id.startsWith('tree-marini')
        ? 'marini-plaza'
        : object.id.startsWith('tree-filbert')
          ? 'filbert'
          : 'park-walk';
    facts.push(
      fact(
        'tree.form',
        central ? 'columnar' : 'spreading',
        'inferred',
        central ? ['park-arbor-2017'] : ['naip-2024'],
      ),
      central
        ? fact(
            'tree.species',
            "Populus nigra 'Italica' — Lombardy poplar",
            'inferred',
            ['park-arbor-2017'],
            'Historical central group identified; crown-to-inventory matching is approximate.',
          )
        : unknown(
            'tree.species',
            'No reliable individual species match; crown appearance alone is insufficient.',
          ),
      fact(
        'tree.canopyDiameter',
        object.width,
        'observed',
        ['naip-2024'],
        'Approximate crown envelope; not trunk diameter.',
        'm',
      ),
      fact('tree.height', object.height, 'inferred', [], 'Unmeasured scene estimate.', 'm'),
    );
    out.references!.push({
      sourceId: 'park-arbor-2017',
      role: 'dataset',
      view: '2017 tree assessment and schematic map',
    });
    if (central)
      out.description =
        'Selected central canopy group. The 2017 arbor report identifies Lombardy poplars here; the earlier palm interpretation was incorrect. Crown location and height remain approximate.';
    const streetTreeRows: Record<string, [number, number, number]> = {
      'tree-filbert-1': [142754, 123, 229.65],
      'tree-filbert-2': [142753, 130.74, 231.21],
      'tree-filbert-3': [142752, 138.13, 231.88],
      'tree-filbert-4': [142751, 145.7, 233.43],
    };
    const inventory = streetTreeRows[object.id];
    if (inventory) {
      out.x = inventory[1];
      out.y = inventory[2];
      out.sourceId = 'street-trees';
      out.label = `Filbert plane ${object.id.slice(-1)}`;
      out.description =
        'London plane at 668 Filbert, positioned from the city street-tree inventory. The original canopy sketch was matched in west-to-east order. Inventory coordinates are not a new ground survey; crown size and height remain estimates.';
      out.facts = out.facts!.filter((f) => f.key !== 'tree.species');
      out.facts.push(
        fact('tree.species', 'Platanus × hispanica — London plane', 'sourced', ['street-trees']),
        fact('tree.inventoryId', inventory[0], 'sourced', ['street-trees']),
        fact(
          'tree.positionMethod',
          'city inventory coordinate',
          'sourced',
          ['street-trees'],
          'WGS84 converted to the shared local frame.',
        ),
      );
      out.references!.push({
        sourceId: 'street-trees',
        role: 'dataset',
        view: `Tree record ${inventory[0]}`,
      });
    }
  }
  if (object.kind === 'road') {
    facts.push(
      object.id === 'powell'
        ? unknown(
            'road.direction',
            'Aggregate includes both one-way and two-way segments; split before routing.',
          )
        : fact(
            'road.direction',
            'two-way',
            'sourced',
            ['street-directions'],
            'All active centerline segments intersecting this crop are coded B.',
          ),
      unknown('road.lanes', 'Lane count varies around intersections; not reliably inventoried.'),
      object.id === 'columbus'
        ? fact(
            'road.speedLimit',
            20,
            'sourced',
            ['street-speeds'],
            'Implemented 2023; crop-intersecting Columbus segments.',
            'mph',
          )
        : unknown(
            'road.speedLimit',
            'The aggregate road may span different segment or school-zone restrictions.',
          ),
    );
    if (['union', 'stockton', 'green'].includes(object.id))
      facts.push(
        fact(
          'road.parkFrontageSpeedLimit',
          20,
          'sourced',
          ['street-speeds'],
          object.id === 'union'
            ? 'Powell–Columbus–Stockton, implemented 2023-10-05.'
            : object.id === 'stockton'
              ? 'Green–Union–Filbert, implemented 2023-02-14; north of Filbert differs.'
              : 'Powell–Stockton, implemented 2024-02-29; western segment differs.',
          'mph',
        ),
      );
    if (object.id === 'filbert')
      facts.push(
        fact(
          'road.schoolZoneLimit',
          15,
          'sourced',
          ['street-speeds'],
          'Record dated 2018; conditions and current signs require verification.',
          'mph',
        ),
      );
    out.references!.push(
      { sourceId: 'street-directions', role: 'dataset' },
      { sourceId: 'street-speeds', role: 'dataset' },
    );
  }
  if (
    object.id === 'main-lawn' ||
    object.id === 'south-garden' ||
    object.id === 'playground' ||
    object.id === 'park-restroom'
  )
    out.parentId = 'park-walk';
  if (object.id === 'park-walk')
    facts.push(
      fact('landscape.designDate', 1958, 'sourced', ['park-history']),
      fact('landscape.material', 'concrete walks with planted edges', 'sourced', [
        'park-arbor-2017',
      ]),
    );
  if (object.tags?.includes('bench'))
    facts.push(
      fact(
        'fixture.material',
        'wood seating on masonry supports',
        'sourced',
        ['park-arbor-2017'],
        'Historic bench specification; individual replacement condition unknown.',
      ),
    );
  return out;
}

export const washingtonSquare: WorldDocument = {
  format: 'wordscape',
  version: '0.4',
  name: 'Washington Square, San Francisco',
  description:
    'A 360 × 360 metre interpretation of North Beach, traced from 2024 NAIP and audited against official park, art and street records. The 2023 USGS bare-earth DEM supplies a 5 m terrain grid; mapped OpenStreetMap footways add explicit circulation. Structured facts distinguish sourced measurements, observations, estimates and unknowns. The 2022 NOAA reference offers finer detail at an older date. Foundations are modeled supports, not measured floor elevations. This is a spatial sketch, not a measured survey.',
  units: 'metres',
  bounds: { width: 360, depth: 360 },
  origin: {
    latitude: 37.799183014789826,
    longitude: -122.41224641494269,
    note: 'Southwest corner. x east, y north. Scaled Web Mercator local frame (cos 37.8008°); reference image 1200 × 1200 px at 0.3 local m/px. See public/reference/washington-square-georeference.json.',
  },
  seed: 20240520,
  terrain: terrain as WorldTerrain,
  sources: [
    washingtonSquareCirculationSource,
    terrainSource,
    ...detailSources,
    {
      id: sourceId,
      title: 'USDA NAIP aerial · 20 May 2024',
      url: 'https://apps.geo.fpac.usda.gov/geo-imagery/rest/services/naip/conus_naip/ImageServer',
      attribution:
        'USDA Farm Production and Conservation, National Agriculture Imagery Program. Public-domain U.S. government imagery.',
      accessed: '2026-11-15',
      notes:
        'Raster m_3712213_se_10_060_20240520 (OBJECTID 11934), 0.6 m source. Downloaded north-up as 1200 px JPEG, 0.3 local m/px (resampled, not additional detail). Local reference: /reference/washington-square-naip.jpg. Original geometry hand-traced; later OSM circulation has a separate source.',
    },
    {
      id: 'parish',
      title: 'Saints Peter and Paul · parish history',
      url: 'https://www.salesiansspp.org/our-history',
      attribution: 'Saints Peter and Paul Church',
      accessed: '2026-11-15',
      notes:
        'Reports 100 × 160 ft church dimensions and 191 ft twin spires. Tower bases and nave mass remain approximate.',
    },
    {
      id: 'sf-parks',
      title: 'Washington Square · San Francisco Recreation and Parks',
      url: 'https://www.sfrecpark.org/902/Washington-Square',
      attribution: 'San Francisco Recreation and Parks',
      accessed: '2026-11-15',
      notes:
        'Confirms park identity, lawn setting, Filbert/Stockton address, and 3.17 acre area. Scene includes surrounding blocks.',
    },
    edgeEnrichment.source,
  ],
  objects: [...streets, ...landscape, ...buildings, ...trees, ...details]
    .map(enrich)
    .map((object): WorldObject => ({
      ...object,
      grounding: 'terrain',
      ...(object.kind === 'building' || object.kind === 'landmark'
        ? { terrainAnchor: 'highest-footprint' as const }
        : {}),
    }))
    .concat(washingtonSquareCirculation, edgeEnrichment.objects as WorldObject[]),
  relations: [
    ...washingtonSquareCirculationRelations,
    {
      from: 'main-lawn',
      to: 'park-walk',
      type: 'within',
      note: 'Lawn is enclosed by the perimeter promenade.',
    },
    {
      from: 'church',
      to: 'main-lawn',
      type: 'near',
      note: 'The church faces the square across Filbert Street.',
    },
    {
      from: 'church-west-tower',
      to: 'church',
      type: 'overlaps',
      note: 'Tower is part of the church frontage.',
    },
    {
      from: 'church-east-tower',
      to: 'church',
      type: 'overlaps',
      note: 'Tower is part of the church frontage.',
    },
    { from: 'playground', to: 'park-walk', type: 'within' },
    { from: 'filbert', to: 'stockton', type: 'connects' },
    { from: 'union', to: 'columbus', type: 'connects' },
    { from: 'marini-plaza', to: 'columbus', type: 'near' },
    ...(edgeEnrichment.relations as WorldDocument['relations']),
  ],
};

// Architectural parts share one modeled floor elevation. parentId remains a semantic
// container; these absolute local bases are explicit, not a hidden parent transform.
const church = washingtonSquare.objects.find((object) => object.id === 'church')!;
const churchBase = getObjectBaseElevation(washingtonSquare, church);
if (churchBase === undefined)
  throw new Error('The church foundation needs complete terrain coverage.');
for (const tower of washingtonSquare.objects.filter(
  (object) => object.id.startsWith('church-') && object.id.endsWith('-tower'),
)) {
  tower.grounding = 'absolute';
  delete tower.terrainAnchor;
  tower.elevation = churchBase;
  tower.facts!.push(
    fact(
      'placement.foundation',
      'Shares the modeled church floor elevation',
      'inferred',
      ['usgs-dem-2023'],
      'Ground beneath buildings is interpolated; this is not a measured architectural floor.',
    ),
  );
}
