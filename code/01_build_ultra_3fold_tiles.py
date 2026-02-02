#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
01_build_ultra_3fold_tiles.py (v3) - NO GT-based pos-tile selection

Ultralytics-style dataset 구조 생성 (TRAIN/TEST):
Fold0/Fold1/Fold2
  TRAIN/images, TRAIN/labels
  TEST/images,  TEST/labels
  data.yaml

v3 핵심 변경:
- 타일 선택(추출) 시 GT geojson을 "절대 사용하지 않음"
  -> grid 타일링 + (옵션) tissue_ratio 기반 필터링만 사용
- 단, labels 생성은 (옵션) GT geojson을 이용해 타일 내 polygon을 잘라 YOLO-seg txt 생성 가능
- GT가 없거나 --skip_labels이면 labels는 빈 파일로 생성(또는 생성만 하고 내용 없음)

기타:
- labels.cache를 "절대 생성하지 않음"(스크립트 차원)
- --clean_cache로 기존 *.cache 파일 삭제 가능
- --force로 images/labels 재생성

Label format (YOLO segmentation):
  <cls> x1 y1 x2 y2 ...   (normalized in tile coordinates [0,1])

Classes:
  0: glomerulus_adenine
  1: glomerulus_normal
"""

import os
import json
import math
import random
import argparse
from pathlib import Path
from typing import List, Dict, Any, Optional, Tuple

import numpy as np
from PIL import Image

try:
    import pyvips
except Exception as e:
    raise RuntimeError(
        "pyvips가 필요합니다.\n"
        "  (Ubuntu) sudo apt-get install -y libvips libvips-dev\n"
        "  (conda)  conda install -c conda-forge -y libvips pyvips\n"
    ) from e

try:
    from shapely.geometry import shape, box as sbox, Polygon, MultiPolygon, GeometryCollection
    from shapely.strtree import STRtree
    from shapely.affinity import translate, scale as shp_scale
except Exception as e:
    raise RuntimeError("shapely가 필요합니다. conda/pip로 설치하세요.") from e


# -----------------------------
# Fixed fold split
# -----------------------------
FOLDS = {
    "Fold0": {"TEST": ["WT1-Adenine_x20", "WT4-Normal_x20"]},
    "Fold1": {"TEST": ["WT2-Adenine_x20", "WT5-Normal_x20"]},
    "Fold2": {"TEST": ["WT3-Adenine_x20", "WT6-Normal_x20"]},
}

ALL_WSIS = [
    "WT1-Adenine_x20", "WT2-Adenine_x20", "WT3-Adenine_x20",
    "WT4-Normal_x20",  "WT5-Normal_x20",  "WT6-Normal_x20",
]

WSI_EXTS = {".tif", ".tiff"}
GT_EXT = ".geojson"


# -----------------------------
# Utils
# -----------------------------
def ensure_dir(p: Path) -> None:
    p.mkdir(parents=True, exist_ok=True)


def wsi_to_class_id(wsi_id: str) -> int:
    s = wsi_id.lower()
    if "adenine" in s:
        return 0
    if "normal" in s:
        return 1
    raise ValueError(f"Adenine/Normal 판별 불가: {wsi_id}")


def collect_wsi_map(wsi_dir: Path) -> Dict[str, Path]:
    out = {}
    for p in sorted(wsi_dir.iterdir()):
        if p.is_file() and p.suffix.lower() in WSI_EXTS:
            out[p.stem] = p
    return out


def load_geojson_polygons(path: Path, fix_invalid: bool = True) -> List[Any]:
    obj = json.loads(path.read_text(encoding="utf-8"))
    feats = obj.get("features", [])
    geoms: List[Any] = []
    for ft in feats:
        g = ft.get("geometry", None)
        if not g:
            continue
        try:
            geom = shape(g)
        except Exception:
            continue
        if geom is None or geom.is_empty:
            continue
        if fix_invalid and (not geom.is_valid):
            try:
                geom = geom.buffer(0)
            except Exception:
                pass
        if geom is None or geom.is_empty:
            continue
        try:
            if float(geom.area) <= 0:
                continue
        except Exception:
            continue
        geoms.append(geom)

    out: List[Polygon] = []
    for g in geoms:
        if isinstance(g, Polygon):
            out.append(g)
        elif isinstance(g, MultiPolygon):
            out.extend([p for p in g.geoms if isinstance(p, Polygon)])
        elif isinstance(g, GeometryCollection):
            for gg in g.geoms:
                if isinstance(gg, Polygon):
                    out.append(gg)
                elif isinstance(gg, MultiPolygon):
                    out.extend([p for p in gg.geoms if isinstance(p, Polygon)])
    return out


def extract_polygons(geom) -> List[Polygon]:
    if geom.is_empty:
        return []
    if isinstance(geom, Polygon):
        return [geom]
    if isinstance(geom, MultiPolygon):
        return [p for p in geom.geoms if isinstance(p, Polygon)]
    if isinstance(geom, GeometryCollection):
        out = []
        for g in geom.geoms:
            out.extend(extract_polygons(g))
        return out
    return []


# Shapely 1/2 호환 STRtree query indices
def _query_indices(tree: STRtree, gt_geoms: List[Any], q_geom: Any) -> List[int]:
    try:
        cand = tree.query(q_geom, predicate="intersects")
    except TypeError:
        cand = tree.query(q_geom)

    if cand is None or len(cand) == 0:
        return []

    first = cand[0]
    if isinstance(first, (int, np.integer)):
        return [int(x) for x in cand]

    gt_id_to_idx = {id(g): i for i, g in enumerate(gt_geoms)}
    out = []
    for gg in cand:
        gi = gt_id_to_idx.get(id(gg), None)
        if gi is None:
            try:
                gi = gt_geoms.index(gg)
            except Exception:
                gi = None
        if gi is not None:
            out.append(int(gi))
    return out


def polygon_to_yolo_line(poly_tile: Polygon, class_id: int, tile_size: int) -> Optional[str]:
    coords = list(poly_tile.exterior.coords)
    if len(coords) < 4:
        return None
    if np.allclose(coords[0], coords[-1]):
        coords = coords[:-1]
    if len(coords) < 3:
        return None

    vals = []
    for (x, y) in coords:
        xn = float(x) / float(tile_size)
        yn = float(y) / float(tile_size)
        xn = 0.0 if xn < 0 else (1.0 if xn > 1 else xn)
        yn = 0.0 if yn < 0 else (1.0 if yn > 1 else yn)
        vals.append(f"{xn:.6f}")
        vals.append(f"{yn:.6f}")
    return f"{class_id} " + " ".join(vals)


def tissue_ratio_rgb(pil: Image.Image, white_thr: int = 235, downsample: int = 128) -> float:
    """
    아주 단순/빠른 tissue 비율 추정:
    - 거의 흰색(배경) 픽셀을 제외한 비율
    """
    if downsample and (pil.size[0] > downsample or pil.size[1] > downsample):
        pil = pil.resize((downsample, downsample), resample=Image.BILINEAR)
    arr = np.asarray(pil, dtype=np.uint8)
    if arr.ndim != 3 or arr.shape[2] < 3:
        return 0.0
    rgb = arr[:, :, :3]
    mask = np.any(rgb < white_thr, axis=2)  # 하나라도 white_thr보다 어두우면 tissue로 간주
    return float(mask.mean())


# -----------------------------
# VIPS IO
# -----------------------------
def open_vips(path: Path, page: int = 0) -> "pyvips.Image":
    return pyvips.Image.new_from_file(str(path), access="random", page=page)


def vips_crop_to_pil(img: "pyvips.Image", x: int, y: int, w: int, h: int) -> Image.Image:
    x = max(0, min(img.width - 1, x))
    y = max(0, min(img.height - 1, y))
    cw = min(w, img.width - x)
    ch = min(h, img.height - y)

    crop = img.crop(x, y, cw, ch)
    mem = crop.write_to_memory()
    arr = np.frombuffer(mem, dtype=np.uint8)
    bands = crop.bands
    arr = arr.reshape(ch, cw, bands)

    if bands >= 3:
        arr = arr[:, :, :3]
    else:
        arr = np.repeat(arr, 3, axis=2)

    pil = Image.fromarray(arr, mode="RGB")

    # 패딩
    if cw != w or ch != h:
        out = Image.new("RGB", (w, h))
        out.paste(pil, (0, 0))
        pil = out
    return pil


# -----------------------------
# Dataset layout
# -----------------------------
def write_data_yaml(fold_dir: Path) -> None:
    y = (
        f"path: {fold_dir.resolve()}\n"
        f"train: TRAIN/images\n"
        f"val: TRAIN/images\n"
        f"test: TEST/images\n"
        f"nc: 2\n"
        f"names: ['glomerulus_adenine', 'glomerulus_normal']\n"
    )
    (fold_dir / "data.yaml").write_text(y, encoding="utf-8")


def make_split_dirs(fold_dir: Path) -> None:
    for split in ["TRAIN", "TEST"]:
        ensure_dir(fold_dir / split / "images")
        ensure_dir(fold_dir / split / "labels")


def clean_cache_files(root_dir: Path) -> int:
    n = 0
    for p in root_dir.rglob("*.cache"):
        if p.is_file():
            p.unlink(missing_ok=True)
            n += 1
    return n


def clear_images_labels(split_dir: Path) -> None:
    for sub in ["images", "labels"]:
        d = split_dir / sub
        if not d.exists():
            continue
        for p in d.glob("*"):
            if p.is_file() or p.is_symlink():
                p.unlink(missing_ok=True)


# -----------------------------
# Tile builder (NO GT-based selection)
# -----------------------------
def build_tiles_one_wsi_v3(
    wsi_path: Path,
    gt_path: Optional[Path],
    out_images: Path,
    out_labels: Path,
    tile_size: int,
    stride: int,
    page: int,
    jpeg_quality: int,
    fix_invalid: bool,
    coord_scale: float,
    min_area_px: float,
    tissue_ratio_thr: float,
    tissue_white_thr: int,
    tissue_downsample: int,
    max_tiles: Optional[int],
    skip_labels: bool,
    rng: random.Random,
) -> None:
    wsi_id = wsi_path.stem
    class_id = wsi_to_class_id(wsi_id)

    img = open_vips(wsi_path, page=page)
    W, H = int(img.width), int(img.height)

    # GT는 "라벨 생성용"으로만 사용 (타일 선택에는 절대 관여 X)
    polys: List[Polygon] = []
    tree = None
    if (not skip_labels) and gt_path is not None and gt_path.exists():
        polys = load_geojson_polygons(gt_path, fix_invalid=fix_invalid)
        if coord_scale != 1.0 and polys:
            polys = [shp_scale(p, xfact=coord_scale, yfact=coord_scale, origin=(0, 0)) for p in polys]
        if polys:
            tree = STRtree(polys)
    else:
        polys = []
        tree = None

    # --- grid 타일 좌표 생성 (GT 사용 금지) ---
    coords: List[Tuple[int, int]] = []
    for y0 in range(0, H, stride):
        for x0 in range(0, W, stride):
            coords.append((x0, y0))

    if max_tiles is not None and len(coords) > max_tiles:
        coords = rng.sample(coords, k=max_tiles)

    kept = 0
    for (x0, y0) in coords:
        # crop
        pil = vips_crop_to_pil(img, int(x0), int(y0), tile_size, tile_size)

        # tissue filter (GT 비의존)
        if tissue_ratio_thr > 0.0:
            tr = tissue_ratio_rgb(pil, white_thr=tissue_white_thr, downsample=tissue_downsample)
            if tr < tissue_ratio_thr:
                continue

        stem = f"{wsi_id}__x{int(x0):07d}_y{int(y0):07d}"
        out_img = out_images / f"{stem}.jpg"
        out_lbl = out_labels / f"{stem}.txt"

        pil.save(out_img, quality=jpeg_quality)

        # labels 생성
        if skip_labels or (tree is None) or (not polys):
            # 빈 라벨 파일 생성(ultralytics 호환)
            out_lbl.write_text("", encoding="utf-8")
        else:
            tile_box = sbox(x0, y0, x0 + tile_size, y0 + tile_size)
            cand_idx = _query_indices(tree, polys, tile_box)

            label_lines = []
            for gi in cand_idx:
                p0 = polys[gi]
                try:
                    inter = p0.intersection(tile_box)
                except Exception:
                    continue
                for g in extract_polygons(inter):
                    try:
                        if float(g.area) < float(min_area_px):
                            continue
                    except Exception:
                        continue
                    g_rel = translate(g, xoff=-x0, yoff=-y0)
                    line = polygon_to_yolo_line(g_rel, class_id=class_id, tile_size=tile_size)
                    if line:
                        label_lines.append(line)

            out_lbl.write_text(("\n".join(label_lines) + "\n") if label_lines else "", encoding="utf-8")

        kept += 1

    print(f"[WSI] {wsi_id}: size=({W},{H}) grid={len(coords)} kept={kept} "
          f"(tissue_thr={tissue_ratio_thr}) labels={'OFF' if skip_labels else 'ON'}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--wsi_dir", required=True)
    ap.add_argument("--gt_dir", default=None, help="라벨 생성용(없으면 빈 라벨)")
    ap.add_argument("--out_root", required=True)

    ap.add_argument("--tile_size", type=int, default=640)
    ap.add_argument("--stride", type=int, default=640)
    ap.add_argument("--page", type=int, default=0)
    ap.add_argument("--jpeg_quality", type=int, default=90)
    ap.add_argument("--fix_invalid", action="store_true")
    ap.add_argument("--max_tiles", type=int, default=None)

    ap.add_argument("--min_area_px", type=float, default=1500.0)

    # v3: GT 비의존 타일링 옵션
    ap.add_argument("--tissue_ratio_thr", type=float, default=0.02,
                    help="tissue 비율 필터(0이면 끔). 예: 0.02~0.10")
    ap.add_argument("--tissue_white_thr", type=int, default=235,
                    help="배경(흰색) 판정 임계값(0~255). 낮출수록 tissue로 더 많이 잡힘")
    ap.add_argument("--tissue_downsample", type=int, default=128,
                    help="tissue ratio 계산용 다운샘플 크기(작을수록 빠름)")

    # 유지 옵션
    ap.add_argument("--force", action="store_true", help="images/labels 재생성(기존 삭제)")
    ap.add_argument("--clean_cache", action="store_true", help="Fold 내부 *.cache 삭제")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--coord_scale", type=float, default=1.0,
                    help="GT 좌표 스케일 보정(예: GT가 1/4 스케일이면 coord_scale=4.0)")

    ap.add_argument("--skip_labels", action="store_true",
                    help="GT를 읽지 않고 labels는 빈 파일로 생성(새 WSI inference용)")

    ap.add_argument("--only_fold", default=None, choices=[None, "Fold0", "Fold1", "Fold2"],
                    help="특정 fold만 생성")

    args = ap.parse_args()
    rng = random.Random(args.seed)

    wsi_dir = Path(args.wsi_dir)
    gt_dir = Path(args.gt_dir) if args.gt_dir else None
    out_root = Path(args.out_root)
    ensure_dir(out_root)

    wsi_map = collect_wsi_map(wsi_dir)
    wsi_map = {k: v for k, v in wsi_map.items() if k in set(ALL_WSIS)}
    missing = [x for x in ALL_WSIS if x not in wsi_map]
    if missing:
        raise FileNotFoundError(f"wsi_dir에서 tif 못 찾음: {missing}")

    folds = ["Fold0", "Fold1", "Fold2"]
    if args.only_fold:
        folds = [args.only_fold]

    for fold_name in folds:
        fold_dir = out_root / fold_name
        ensure_dir(fold_dir)
        make_split_dirs(fold_dir)
        write_data_yaml(fold_dir)

        if args.clean_cache:
            n = clean_cache_files(fold_dir)
            if n:
                print(f"[CLEAN] {fold_name}: removed {n} cache file(s)")

        test_ids = FOLDS[fold_name]["TEST"]
        train_ids = [x for x in ALL_WSIS if x not in set(test_ids)]

        for split, ids in [("TRAIN", train_ids), ("TEST", test_ids)]:
            split_dir = fold_dir / split
            out_images = split_dir / "images"
            out_labels = split_dir / "labels"

            if args.force:
                clear_images_labels(split_dir)
                clean_cache_files(split_dir)

            for wsi_id in ids:
                wsi_path = wsi_map[wsi_id]

                gp = None
                if (not args.skip_labels) and gt_dir is not None:
                    cand = gt_dir / f"{wsi_id}{GT_EXT}"
                    if cand.exists():
                        gp = cand
                    else:
                        print(f"[WARN] GT geojson 없음 -> 빈 라벨로 진행: {cand}")

                build_tiles_one_wsi_v3(
                    wsi_path=wsi_path,
                    gt_path=gp,
                    out_images=out_images,
                    out_labels=out_labels,
                    tile_size=int(args.tile_size),
                    stride=int(args.stride),
                    page=int(args.page),
                    jpeg_quality=int(args.jpeg_quality),
                    fix_invalid=bool(args.fix_invalid),
                    coord_scale=float(args.coord_scale),
                    min_area_px=float(args.min_area_px),
                    tissue_ratio_thr=float(args.tissue_ratio_thr),
                    tissue_white_thr=int(args.tissue_white_thr),
                    tissue_downsample=int(args.tissue_downsample),
                    max_tiles=args.max_tiles,
                    skip_labels=bool(args.skip_labels),
                    rng=rng,
                )

        print(f"[OK] built: {fold_name} -> {fold_dir}")

    print("[DONE] all folds created (NO GT-based tile selection).")


if __name__ == "__main__":
    main()
