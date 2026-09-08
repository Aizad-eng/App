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
    px = []
    S = size
    c = S / 2
    for y in range(S):
        row = bytearray()
        for x in range(S):
            u, v = (x + 0.5) / S, (y + 0.5) / S
            # background: rounded square (or full bleed for maskable) with vertical gradient
            bg = lerp((0x2b, 0x2f, 0x7a), (0x14, 0x16, 0x33), v)
            if maskable:
                a_bg = 1.0
            else:
                r = S * 0.22
                dx = max(abs(x + 0.5 - c) - (c - r), 0)
                dy = max(abs(y + 0.5 - c) - (c - r), 0)
                d = math.hypot(dx, dy) - r
                a_bg = 1 - smooth(-1.0, 1.0, d)
            col = bg
            # crosshair ring
            scale = 0.78 if maskable else 1.0
            R = S * 0.30 * scale
            thick = S * 0.045 * scale
            dist = math.hypot(x + 0.5 - c, y + 0.5 - c)
            ring = 1 - smooth(thick / 2 - 1, thick / 2 + 1, abs(dist - R))
            # crosshair lines (with gaps near the centre)
            lw = S * 0.032 * scale
            gap = S * 0.12 * scale
            ext = S * 0.40 * scale
            ax, ay = abs(x + 0.5 - c), abs(y + 0.5 - c)
            hline = 1 - smooth(lw / 2 - 1, lw / 2 + 1, ay)
            hline *= smooth(gap - 1, gap + 1, ax) * (1 - smooth(ext - 1, ext + 1, ax))
            vline = 1 - smooth(lw / 2 - 1, lw / 2 + 1, ax)
            vline *= smooth(gap - 1, gap + 1, ay) * (1 - smooth(ext - 1, ext + 1, ay))
            pink = (0xff, 0x4f, 0x7d)
            k = max(ring, hline, vline)
            col = lerp(col, pink, k)
            # bottle silhouette in the middle (gold)
            bw, bh = S * 0.075 * scale, S * 0.20 * scale
            bx, by = x + 0.5 - c, y + 0.5 - c + S * 0.02 * scale
            inside = 0.0
            if -bh / 2 <= by <= bh / 2:
                t = (by + bh / 2) / bh  # 0 top .. 1 bottom
                if t < 0.28:
                    half = bw * 0.32
                else:
                    half = bw * (0.32 + 0.68 * smooth(0.28, 0.5, t))
                inside = 1 - smooth(half - 1, half + 1, abs(bx))
                if by < -bh / 2 + 1.5 or by > bh / 2 - 1.5:
                    inside *= 0.5
            gold = (0xff, 0xd1, 0x66)
            col = lerp(col, gold, inside)
            # red label band
            if inside > 0 and 0.58 <= (by + bh / 2) / bh <= 0.78:
                col = lerp(col, (0xd1, 0x1a, 0x2a), inside)
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
            row += bytes((int(r[i] * a + 0x14 * (1 - a)), int(r[i + 1] * a + 0x16 * (1 - a)), int(r[i + 2] * a + 0x33 * (1 - a)), 255))
        touch.append(bytes(row))
    write_png(os.path.join(OUT, 'apple-touch-icon.png'), 180, downsample(touch, 512, 180))
    mask = render(512, maskable=True)
    write_png(os.path.join(OUT, 'icon-512-maskable.png'), 512, mask)
    print('icons written to', os.path.abspath(OUT))
