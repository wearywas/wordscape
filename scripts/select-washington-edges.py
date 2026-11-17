"""Read-only conservative selection audit, using retained OSM and preserved baseline polygons.
Development dependencies: Shapely 2.1.1 and Pillow. No network or source repair.
"""
import json
from pathlib import Path
from shapely.geometry import Polygon, box
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / '.wordscape/washington-enrichment'
data = json.loads((CACHE / 'candidate-input.json').read_text(encoding='utf-8'))
baseline = data['baseline']['objects']
blockers = [(o, Polygon(o['worldFootprint'])) for o in baseline if o['kind'] in ('building','landmark','road','pavement','grass')]
occupied = unary_union([p for _,p in blockers])
selected = []
excluded = []
for obj in data['candidates']:
    p = Polygon(obj['worldFootprint'])
    reason = None
    if obj.get('parentId') or 'building-part' in obj.get('tags', []):
        reason = 'Mapped part excluded; no partial architectural assembly added.'
    elif p.area < 15:
        reason = 'Small clipped fragment under 15 m² excluded.'
    elif p.intersects(box(70,70,290,290)) and p.intersection(box(70,70,290,290)).area > p.area * .25:
        reason = 'Outside the peripheral 70 m audit band.'
    else:
        overlap = p.intersection(occupied).area
        if overlap > .01:
            reason = 'Overlaps a preserved building, road, park or path footprint.'
        elif p.distance(unary_union([poly for old,poly in blockers if old['kind'] in ('building','landmark')])) < .5:
            reason = 'Within 0.5 m of a preserved building aggregate; ambiguous touching roof boundaries.'
    if reason:
        excluded.append({'id':obj['id'],'areaM2':round(p.area,3),'reason':reason})
    else:
        selected.append(obj)

# Stable largest-first preference avoids filling the specimen with tiny slivers.
selected.sort(key=lambda o:(-Polygon(o['worldFootprint']).area,o['id']))
accepted=[]
for obj in selected:
    p=Polygon(obj['worldFootprint'])
    if any(p.intersection(Polygon(other['worldFootprint'])).area > .01 for other in accepted):
        excluded.append({'id':obj['id'],'areaM2':round(p.area,3),'reason':'Overlaps another accepted mapped footprint.'})
    elif len(accepted)>=24:
        excluded.append({'id':obj['id'],'areaM2':round(p.area,3),'reason':'Beyond the explicit 24-building scope cap.'})
    else:
        accepted.append(obj)
route_blockers=unary_union([Polygon(o['worldFootprint']) for o in data['candidates']]+[p for o,p in blockers if o['kind'] != 'road'])
route_groups={}
for obj in data.get('routeCandidates',[]):
    key=next(f['value'] for f in obj['facts'] if f['key']=='osm.element')
    route_groups.setdefault(key,[]).append(obj)
accepted_routes=[]
route_audit=[]
for key,objects in route_groups.items():
    overlap=sum(Polygon(o['worldFootprint']).intersection(route_blockers).area for o in objects)
    safe=overlap<=.01
    route_audit.append({'sourceId':key,'label':objects[0]['label'],'segments':len(objects),'overlapWithRecordedBuildingsAndGroundsM2':round(overlap,6),'accepted':safe,'note':'All segments of the bounded way retained together; mapped centerline, inferred corridor width.' if safe else 'Whole bounded way omitted: inferred corridor width intersects recorded building/ground polygons.'})
    if safe:accepted_routes.extend(objects)
report={'source':data['source'],'beforeObjects':data['baseline']['objectCount'],'candidateCount':len(data['candidates']),'selectedCount':len(accepted),'selectedRouteSegments':len(accepted_routes),'selectionRules':{'peripheralBandMetres':70,'maximumFractionInsideCentralRectangle':.25,'minimumFootprintAreaM2':15,'maximumOverlapM2':.01,'minimumExistingBuildingGapM':.5,'scopeCap':24},'selected':accepted,'routes':accepted_routes,'routeAudit':route_audit,'excluded':excluded,'converterDiagnostics':data['diagnostics']}
(CACHE/'selection-audit.json').write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
print(f'{len(accepted)} conservative peripheral candidates; {len(excluded)} excluded. No baseline changes made.')
for obj in accepted:
    print(obj['id'],obj['label'],'area',round(Polygon(obj['worldFootprint']).area,1),'height',obj['height'],'center',obj['x'],obj['y'])

from PIL import Image, ImageDraw
reference=ROOT/'public/reference/washington-square-noaa-2022.jpg'
if not reference.exists():
    reference=ROOT/'public/reference/washington-square-naip.jpg'
image=Image.open(reference).convert('RGB')
draw=ImageDraw.Draw(image)
scale=image.width/360
def pixels(o):return [(round(x*scale),round((360-y)*scale)) for x,y in o['worldFootprint']]
for obj in baseline:
    if obj['kind'] in ('building','landmark'):
        draw.line(pixels(obj)+pixels(obj)[:1],fill='#f5d54b',width=2)
for index,obj in enumerate(accepted,1):
    draw.line(pixels(obj)+pixels(obj)[:1],fill='#00ffff',width=4)
    point=(round(obj['x']*scale),round((360-obj['y'])*scale))
    draw.text(point,str(index),fill='white',stroke_width=2,stroke_fill='black')
for obj in accepted_routes:
    draw.line(pixels(obj)+pixels(obj)[:1],fill='#ee60ff',width=4)
image.save(CACHE/'candidate-overlay.png')
