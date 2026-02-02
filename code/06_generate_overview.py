#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
06_generate_overview.py

- WSI에서 overview PNG 생성 (모델 예측 없음)
"""

import argparse
from pathlib import Path

try:
    import pyvips
except Exception as e:
    raise RuntimeError(
        "pyvips가 필요합니다.\n"
        "  (Ubuntu) sudo apt-get install -y libvips libvips-dev\n"
        "  (conda)  conda install -c conda-forge -y libvips pyvips\n"
    ) from e


def open_vips(path: Path, page: int = 0) -> "pyvips.Image":
    ext = path.suffix.lower()
    if ext in {".tif", ".tiff"}:
        return pyvips.Image.new_from_file(str(path), access="random", page=page)
    return pyvips.Image.new_from_file(str(path), access="random")


def make_overview(
    wsi_path: Path,
    out_png: Path,
    page: int = 0,
    max_side: int = 2400,
    scale: float | None = None,
    max_width: int | None = None,
    max_height: int | None = None,
) -> None:
    img = open_vips(wsi_path, page=page)
    W = int(img.width)
    H = int(img.height)
    if scale is None:
        if max_width and max_height:
            scale = min(float(max_width) / float(W), float(max_height) / float(H))
        else:
            scale = float(max_side / max(W, H)) if max(W, H) > max_side else 1.0
    thumb = img.resize(float(scale))
    out_png.parent.mkdir(parents=True, exist_ok=True)
    thumb.write_to_file(str(out_png))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--wsi_path", required=True)
    ap.add_argument("--out_png", required=True)
    ap.add_argument("--page", type=int, default=0)
    ap.add_argument("--overview_max_side", type=int, default=2400)
    ap.add_argument("--overview_scale", type=float, default=0.0)
    ap.add_argument("--overview_max_width", type=int, default=0)
    ap.add_argument("--overview_max_height", type=int, default=0)
    args = ap.parse_args()

    make_overview(
        wsi_path=Path(args.wsi_path),
        out_png=Path(args.out_png),
        page=int(args.page),
        max_side=int(args.overview_max_side),
        scale=float(args.overview_scale) if float(args.overview_scale) > 0 else None,
        max_width=int(args.overview_max_width) if int(args.overview_max_width) > 0 else None,
        max_height=int(args.overview_max_height) if int(args.overview_max_height) > 0 else None,
    )


if __name__ == "__main__":
    main()
