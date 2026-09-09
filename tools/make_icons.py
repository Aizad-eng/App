#!/usr/bin/env python3
"""Generate the PWA icons (pure Python, no dependencies). Run: python3 tools/make_icons.py"""
import math, struct, zlib, os

OUT = os.path.join(os.path.dirname(__file__), '..', 'www', 'icons')

def smooth(edge0, edge1, x):
    t = max(0.0, min(1.0, (x - edge0) / (edge1 - edge0)))
    return t * t * (3 - 2 * t)

def lerp(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))

def render(size, maskable=False):
    """A white ball inside a four-colour ring on a dark rounded square."""
    px = []
    S = size
    c = S / 2
    cols = [(0xf6, 0xdf, 0x0e), (0xff, 0x2d, 0x8a), (0x8c, 0x2b, 0xff), (0x35, 0xe2, 0xf2)]
    for y in range(S):
        row = bytearray()
        for x in range(S):
            v = (y + 0.5) / S
            bg = lerp((0x26, 0x26, 0x4a), (0x12, 0x12, 0x1d), v)
            if maskable:
                a_bg = 1.0
            else:
                r = S * 0.22
                dx = max(abs(x + 0.5 - c) - (c - r), 0)
                dy = max(abs(y + 0.5 - c) - (c - r), 0)
                d = math.hypot(dx, dy) - r
                a_bg = 1 - smooth(-1.0, 1.0, d)
            col = bg
            scale = 0.78 if maskable else 1.0
            R = S * 0.30 * scale
            thick = S * 0.085 * scale
            ex, ey = x + 0.5 - c, y + 0.5 - c
            dist = math.hypot(ex, ey)
            ring = 1 - smooth(thick / 2 - 1, thick / 2 + 1, abs(dist - R))
            ang = (math.atan2(ey, ex) + math.pi / 4) % (2 * math.pi)
            seg = int(ang / (math.pi / 2)) % 4
            col = lerp(col, cols[seg], ring)
            ball = 1 - smooth(S * 0.11 * scale - 1, S * 0.11 * scale + 1, dist)
            col = lerp(col, (255, 255, 255), ball)
            a = int(round(a_bg * 255))
            row += bytes((int(col[0]), int(col[1]), int(col[2]), a))
        px.append(bytes(row))
    return px

def write_png(path, size, rows):
    raw = b''.join(b'\x00' + r for r in rows)
    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)
    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(png)

def downsample(rows, size, target):
    # box filter from `size` to `target`
    factor = size / target
    out = []
    for ty in range(target):
        row = bytearray()
        y0, y1 = int(ty * factor), max(int((ty + 1) * factor), int(ty * factor) + 1)
        for tx in range(target):
            x0, x1 = int(tx * factor), max(int((tx + 1) * factor), int(tx * factor) + 1)
            acc = [0, 0, 0, 0]; n = 0
            for y in range(y0, y1):
                r = rows[y]
                for x in range(x0, x1):
                    i = x * 4
                    acc[0] += r[i]; acc[1] += r[i + 1]; acc[2] += r[i + 2]; acc[3] += r[i + 3]; n += 1
            row += bytes(int(round(v / n)) for v in acc)
        out.append(bytes(row))
    return out

if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    big = render(512)
    write_png(os.path.join(OUT, 'icon-512.png'), 512, big)
    write_png(os.path.join(OUT, 'icon-192.png'), 192, downsample(big, 512, 192))
    # iOS home-screen icons are opaque: flatten on the background colour
    touch = []
    for r in big:
        row = bytearray()
        for i in range(0, len(r), 4):
            a = r[i + 3] / 255
            row += bytes((int(r[i] * a + 0x12 * (1 - a)), int(r[i + 1] * a + 0x12 * (1 - a)), int(r[i + 2] * a + 0x1d * (1 - a)), 255))
        touch.append(bytes(row))
    write_png(os.path.join(OUT, 'apple-touch-icon.png'), 180, downsample(touch, 512, 180))
    mask = render(512, maskable=True)
    write_png(os.path.join(OUT, 'icon-512-maskable.png'), 512, mask)
    print('icons written to', os.path.abspath(OUT))
