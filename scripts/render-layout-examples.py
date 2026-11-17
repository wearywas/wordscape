"""Render the actual processed world polygons as a static plan contact sheet.
Optional preview helper: Python + Pillow. Does not read imagery or call the network.
"""
import json
import math
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
EXAMPLES = json.loads((ROOT / "src/data/layoutExamples.json").read_text(encoding="utf-8"))["examples"]
SCALE = 2
image = Image.new("RGB", (1665 * SCALE, 880 * SCALE), "white")
draw = ImageDraw.Draw(image)
font_path = Path("C:/Windows/Fonts/segoeui.ttf")
def font(size):
    return ImageFont.truetype(str(font_path), size * SCALE) if font_path.exists() else ImageFont.load_default(size=size * SCALE)
def text(x, y, value, size=12):
    draw.text((x * SCALE, y * SCALE), value, fill="#283c32", font=font(size))
def polygon(points, color):
    draw.polygon([(x * SCALE, y * SCALE) for x, y in points], fill=color)

text(15, 5, "Ten real layouts processed into Wordscapes", 23)
text(15, 39, "North up · actual converted polygons and route corridors · dashed red = contiguous prompt context window", 13)
text(15, 62, "Mapped geometry is incomplete; heights/route widths may be inferred. © OpenStreetMap contributors · ODbL 1.0. No terrain or imagery.", 12)
colors = {"grass":"#c4d2b5", "water":"#95c7d8", "road":"#9da9ad", "pavement":"#d8cba6", "building":"#775d4b", "tree":"#64835b", "fixture":"#545e5a", "landmark":"#775d4b"}
for index, example in enumerate(EXAMPLES):
    world = json.loads((ROOT / "public" / example["source"]["worldPath"].lstrip("/")).read_text(encoding="utf-8"))
    ox, oy = index % 5 * 330 + 15, index // 5 * 390 + 100
    text(ox, oy - 15, example["name"], 12)
    text(ox, oy + 7, f'{world["bounds"]["width"]:.0f} m · {len(world["objects"])} objects · {len(example["cluster"]["objects"])} context records', 11)
    oy += 34
    scale = 305 / max(world["bounds"]["width"], world["bounds"]["depth"])
    polygon([(ox,oy),(ox+305,oy),(ox+305,oy+305),(ox,oy+305)], "#f5f3ee")
    for obj in sorted(world["objects"], key=lambda o:o["layer"]):
        points = obj.get("footprint") or [[-obj["width"]/2,-obj["depth"]/2],[obj["width"]/2,-obj["depth"]/2],[obj["width"]/2,obj["depth"]/2],[-obj["width"]/2,obj["depth"]/2]]
        angle = math.radians(obj["rotation"])
        transformed = [(ox+(obj["x"]+x*math.cos(angle)-y*math.sin(angle))*scale, oy+305-(obj["y"]+x*math.sin(angle)+y*math.cos(angle))*scale) for x,y in points]
        polygon(transformed, colors[obj["kind"]])
    box=example["cluster"]["bounds"]
    x0,y0=ox+box["x"]*scale,oy+305-(box["y"]+box["depth"])*scale
    x1,y1=x0+box["width"]*scale,y0+box["depth"]*scale
    for start,end in [((x0,y0),(x1,y0)),((x1,y0),(x1,y1)),((x1,y1),(x0,y1)),((x0,y1),(x0,y0))]:
        length=math.dist(start,end)
        for offset in range(0,math.ceil(length),8):
            a=offset/length;b=min(offset+5,length)/length
            draw.line([(SCALE*(start[0]+(end[0]-start[0])*t),SCALE*(start[1]+(end[1]-start[1])*t)) for t in [a,b]],fill="#ce4e56",width=2*SCALE)
    draw.rectangle((ox*SCALE,oy*SCALE,(ox+305)*SCALE,(oy+305)*SCALE),outline="#b7beb5",width=SCALE)
    image.crop((ox*SCALE,oy*SCALE,(ox+305)*SCALE,(oy+305)*SCALE)).resize((320,320), Image.Resampling.LANCZOS).save(ROOT / "public/reference/layout-examples" / f'{example["id"]}.plan.png', optimize=True)
image.resize((1665,880), Image.Resampling.LANCZOS).save(ROOT / "public/reference/layout-examples/contact-sheet.png", optimize=True)
print("Rendered the ten processed plans from world polygons.")
