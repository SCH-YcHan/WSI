#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
05_render_overlay_png.py

- WSI 전체 크기 기준 GeoJSON 폴리곤을 overview PNG 위에 합성
"""

import json
import argparse
from pathlib import Path
from typing import List, Tuple

import numpy as np
from PIL import Image, ImageDraw

try:
    import pyvips
except Exception as e:
    raise RuntimeError(
        "pyvips가 필요합니다.\n"
        "  (Ubuntu) sudo apt-get install -y libvips libvips-dev\n"
        "  (conda)  conda install -c conda-forge -y libvips pyvips\n"
    ) from e


def open_vips(path: Path, page: int = 0) -> "pyvips.Image":
    return pyvips.Image.new_from_file(str(path), access="random", page=page)


def load_geojson_polygons(path: Path) -> List[List[Tuple[float, float]]]:
    obj = json.loads(path.read_text(encoding="utf-8"))
    feats = obj.get("features", [])
    out: List[List[Tuple[float, float]]] = []
    for ft in feats:
        geom = ft.get("geometry")
        if not geom:
            continue
        gtype = geom.get("type")
        coords = geom.get("coordinates")
        if not coords:
            continue
        if gtype == "Polygon":
            rings = coords
            if rings and rings[0]:
                out.append([(float(x), float(y)) for x, y in rings[0]])
        elif gtype == "MultiPolygon":
            for poly in coords:
                if poly and poly[0]:
                    out.append([(float(x), float(y)) for x, y in poly[0]])
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--wsi_path", required=True)
    ap.add_argument("--overview_png", required=True)
    ap.add_argument("--geojson", required=True)
    ap.add_argument("--out_png", required=True)
    ap.add_argument("--page", type=int, default=0)
    ap.add_argument("--stroke", default="rgba(39,174,96,0.85)")
    ap.add_argument("--fill", default="rgba(46,204,113,0.14)")
    ap.add_argument("--width", type=int, default=2)
    args = ap.parse_args()

    wsi = open_vips(Path(args.wsi_path), page=int(args.page))
    W, H = int(wsi.width), int(wsi.height)

    ov = Image.open(args.overview_png).convert("RGBA")
    ow, oh = ov.size
    sx = ow / float(W)
    sy = oh / float(H)

    polys = load_geojson_polygons(Path(args.geojson))
    overlay = Image.new("RGBA", ov.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay, "RGBA")

    # parse rgba("r,g,b,a") with a in 0..1
    def parse_rgba(text: str):
        t = text.strip().lower()
        if t.startswith("rgba"):
            nums = t[t.find("(") + 1 : t.find(")")].split(",")
            r, g, b = [int(float(x)) for x in nums[:3]]
            a = float(nums[3]) if len(nums) > 3 else 1.0
            return (r, g, b, int(a * 255))
        if t.startswith("#") and len(t) == 7:
            r = int(t[1:3], 16)
            g = int(t[3:5], 16)
            b = int(t[5:7], 16)
            return (r, g, b, 255)
        return (0, 255, 0, 180)

    stroke = parse_rgba(args.stroke)
    fill = parse_rgba(args.fill)

    for poly in polys:
        pts = [(x * sx, y * sy) for (x, y) in poly]
        if len(pts) < 3:
            continue
        draw.polygon(pts, outline=stroke, fill=fill)
        if args.width > 1:
            draw.line(pts + [pts[0]], fill=stroke, width=int(args.width))

    out = Image.alpha_composite(ov, overlay)
    out.save(args.out_png)


if __name__ == "__main__":
    main()
