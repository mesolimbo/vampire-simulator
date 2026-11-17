# Cut the HUD's top bar and footer frame pieces out of the concept art (assets/hud/concept-atlas.png), so every line
# and colour of the bars comes from the one painting: each bar's left end, its right end, and a plain column of its
# frame that the CSS stretches along the middle. Painted widgets that sit inside an end piece are covered with that
# bar's plain frame.
#   python scripts/hud_bars.py
from PIL import Image

SRC, OUT = 'assets/hud/concept-atlas.png', 'assets/hud/'
atlas = Image.open(SRC).convert('RGBA')

BARS = {
    # rows of the bar in the art; left end up to the medallion; right end from just past the last widget; a plain
    # column of frame; and rectangles of painted widgets to cover, as (x0, x1, y0, y1).
    'top': dict(rows=(1, 71), left=48, right=1604, plain=1454, cover=[(1604, 1634, 16, 48)]),
    'bot': dict(rows=(850, 936), left=46, right=1606, plain=1362, cover=[]),
}

for name, b in BARS.items():
    y0, y1 = b['rows']
    plain = atlas.crop((b['plain'], y0, b['plain'] + 6, y1))
    plain.save(OUT + f'bar-{name}-mid.png')
    atlas.crop((0, y0, b['left'], y1)).save(OUT + f'bar-{name}-left.png')
    right = atlas.crop((b['right'], y0, atlas.width, y1))
    for x0, x1, ry0, ry1 in b['cover']:
        # the frame here is horizontal bands, so a stretched plain column fills it seamlessly
        patch = atlas.crop((b['plain'], y0 + ry0, b['plain'] + 1, y0 + ry1)).resize((x1 - x0, ry1 - ry0))
        right.paste(patch, (x0 - b['right'], ry0))
    # soften each end piece's inner edge into the stretched middle, so no seam shows
    left = Image.open(OUT + f'bar-{name}-left.png')
    for img, cols in ((left, range(left.width - 6, left.width)), (right, range(0, 10))):
        a = img.getchannel('A'); px = a.load()
        for i, x in enumerate(cols):
            k = (i + 1) / (len(cols) + 1) if img is right else 1 - (i + 1) / (len(cols) + 1)
            for y in range(img.height): px[x, y] = int(px[x, y] * k)
        img.putalpha(a)
    left.save(OUT + f'bar-{name}-left.png')
    right.save(OUT + f'bar-{name}-right.png')
    print(name, 'height', y1 - y0, 'left', b['left'], 'right', atlas.width - b['right'])
