# -*- coding: utf-8 -*-
"""Generates the PWA icons. Pure stdlib - no Pillow needed."""
import os
import zlib
import struct

OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets")

BG = (18, 18, 20)
WHITE = (245, 245, 247)
RED = (225, 29, 72)


def write_png(path, width, height, pixels):
    """pixels: list of rows, each a list of (r, g, b) tuples."""
    raw = bytearray()
    for row in pixels:
        raw.append(0)                       # filter type: none
        for r, g, b in row:
            raw += bytes((r, g, b))

    def chunk(tag, data):
        payload = tag + data
        return struct.pack(">I", len(data)) + payload + struct.pack(">I", zlib.crc32(payload) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")

    with open(path, "wb") as handle:
        handle.write(png)


def build(size, maskable=False):
    """A rounded tile with the Polish flag; maskable variants keep a safe margin."""
    pad = int(size * 0.16) if maskable else int(size * 0.07)
    radius = int((size - 2 * pad) * (0.5 if maskable else 0.24))
    inner = size - 2 * pad
    split = pad + inner // 2

    rows = []
    for y in range(size):
        row = []
        for x in range(size):
            if maskable:
                colour = BG
            else:
                colour = BG

            inside = pad <= x < size - pad and pad <= y < size - pad
            if inside and radius > 0:
                # Round the corners of the inner tile.
                cx = min(max(x, pad + radius), size - pad - radius - 1)
                cy = min(max(y, pad + radius), size - pad - radius - 1)
                if (x - cx) ** 2 + (y - cy) ** 2 > radius ** 2:
                    inside = False

            if inside:
                colour = WHITE if y < split else RED

            row.append(colour)
        rows.append(row)
    return rows


def main():
    if not os.path.isdir(OUT_DIR):
        os.makedirs(OUT_DIR)

    targets = [
        ("icon-192.png", 192, False),
        ("icon-512.png", 512, False),
        ("icon-180.png", 180, False),
        ("icon-maskable-512.png", 512, True),
    ]
    for name, size, maskable in targets:
        path = os.path.join(OUT_DIR, name)
        write_png(path, size, size, build(size, maskable))
        print("wrote %s (%d bytes)" % (name, os.path.getsize(path)))

    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">'
        '<rect width="512" height="512" rx="112" fill="#121214"/>'
        '<path d="M36 148a76 76 0 0 1 76-76h288a76 76 0 0 1 76 76v108H36z" fill="#f5f5f7"/>'
        '<path d="M36 256h440v108a76 76 0 0 1-76 76H112a76 76 0 0 1-76-76z" fill="#e11d48"/>'
        '</svg>'
    )
    with open(os.path.join(OUT_DIR, "icon.svg"), "w", encoding="utf-8") as handle:
        handle.write(svg)
    print("wrote icon.svg")


if __name__ == "__main__":
    main()
