#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
04_predict_wsi_glomeruli.py

- 단일 WSI를 타일링하고 YOLO-seg 예측을 수행
- WSI 좌표계로 폴리곤 복원 후 GeoJSON 저장
- (옵션) WSI overview 썸네일 PNG 저장
"""

import json
import argparse
from pathlib import Path
from typing import List, Tuple, Optional, Dict, Any
import time

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
    from shapely.geometry import Polygon, MultiPolygon, GeometryCollection, box as sbox
    from shapely.affinity import translate
except Exception as e:
    raise RuntimeError("shapely가 필요합니다. conda/pip로 설치하세요.") from e

try:
    from ultralytics import YOLO
except Exception as e:
    raise RuntimeError("ultralytics가 필요합니다. pip install -U ultralytics") from e


def ensure_dir(p: Path) -> None:
    p.mkdir(parents=True, exist_ok=True)


def open_vips(path: Path, page: int = 0) -> "pyvips.Image":
    ext = path.suffix.lower()
    if ext in {".tif", ".tiff"}:
        return pyvips.Image.new_from_file(str(path), access="random", page=page)
    return pyvips.Image.new_from_file(str(path), access="random")


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
    return Image.fromarray(arr, mode="RGB")


def tissue_ratio_rgb(pil: Image.Image, white_thr: int = 235, downsample: int = 128) -> float:
    if downsample and (pil.size[0] > downsample or pil.size[1] > downsample):
        pil = pil.resize((downsample, downsample), resample=Image.BILINEAR)
    arr = np.asarray(pil, dtype=np.uint8)
    if arr.ndim != 3 or arr.shape[2] < 3:
        return 0.0
    rgb = arr[:, :, :3]
    mask = np.any(rgb < white_thr, axis=2)
    return float(mask.mean())


def parse_tile_name(stem: str) -> Tuple[str, int, int]:
    # format: <wsi>__x0000000_y0000000
    parts = stem.split("__x")
    if len(parts) != 2:
        raise ValueError(f"타일 파일명 파싱 실패: {stem}")
    wsi_id = parts[0]
    xy = parts[1].split("_y")
    if len(xy) != 2:
        raise ValueError(f"타일 파일명 파싱 실패: {stem}")
    return wsi_id, int(xy[0]), int(xy[1])


def geom_to_polygons(geom) -> List[Polygon]:
    if geom is None or getattr(geom, "is_empty", True):
        return []
    if isinstance(geom, Polygon):
        return [geom] if not geom.is_empty else []
    if isinstance(geom, MultiPolygon):
        return [p for p in geom.geoms if isinstance(p, Polygon) and (not p.is_empty)]
    if isinstance(geom, GeometryCollection):
        out: List[Polygon] = []
        for g in geom.geoms:
            out.extend(geom_to_polygons(g))
        return out
    return []


def safe_fix(geom):
    if geom is None or getattr(geom, "is_empty", True):
        return geom
    if getattr(geom, "is_valid", True):
        return geom
    try:
        return geom.buffer(0)
    except Exception:
        return geom


def predict_from_tileset(
    model: "YOLO",
    tile_paths: List[Path],
    imgsz: int,
    conf: float,
    iou: float,
    device: str,
    half: bool,
    max_det: int,
    classes: Optional[List[int]],
    agnostic_nms: bool,
    retina_masks: bool,
    min_area_px: float,
    fix_invalid: bool = True,
    clip_to_wsi_bounds: Optional[Tuple[int, int]] = None,
    batch_size: int = 32,
    progress_file: Optional[Path] = None,
) -> Tuple[List[Polygon], List[float], List[int], Dict[str, Any]]:
    if not tile_paths:
        return [], [], [], {"n_tiles": 0, "n_pred": 0}

    pr_polys: List[Polygon] = []
    pr_scores: List[float] = []
    pr_cls: List[int] = []

    total = len(tile_paths)
    processed = 0
    def write_progress(state: str, extra: Optional[Dict[str, Any]] = None):
        if progress_file is None:
            return
        payload = {
            "state": state,
            "total_tiles": int(total),
            "processed_tiles": int(processed),
            "predicted_objects": int(len(pr_polys)),
            "updated_at": time.time(),
        }
        if extra:
            payload.update(extra)
        progress_file.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    write_progress("predicting")
    for i in range(0, total, batch_size):
        batch = tile_paths[i : i + batch_size]
        results = model.predict(
            source=[str(p) for p in batch],
            imgsz=imgsz,
            conf=conf,
            iou=iou,
            device=device,
            half=half,
            max_det=max_det,
            classes=classes,
            agnostic_nms=agnostic_nms,
            retina_masks=retina_masks,
            verbose=False,
        )

        for pth, r in zip(batch, results):
            stem = Path(pth).stem
            _, x0, y0 = parse_tile_name(stem)

            if r.masks is None or r.masks.xy is None:
                continue

            scores = None
            classes_out = None
            try:
                if r.boxes is not None:
                    if r.boxes.conf is not None:
                        scores = r.boxes.conf.detach().cpu().numpy().tolist()
                    if r.boxes.cls is not None:
                        classes_out = r.boxes.cls.detach().cpu().numpy().tolist()
            except Exception:
                scores = None
                classes_out = None

            for k, xy in enumerate(r.masks.xy):
                if xy is None or len(xy) < 3:
                    continue
                try:
                    geom = Polygon([(float(x), float(y)) for x, y in xy])
                except Exception:
                    continue

                if geom is None or geom.is_empty:
                    continue
                if fix_invalid:
                    geom = safe_fix(geom)
                if geom is None or geom.is_empty:
                    continue

                sc = float(scores[k]) if (scores is not None and k < len(scores)) else 1.0
                cc = int(classes_out[k]) if (classes_out is not None and k < len(classes_out)) else -1

                for p in geom_to_polygons(geom):
                    if p is None or p.is_empty:
                        continue
                    if fix_invalid:
                        p = safe_fix(p)
                    for pp in geom_to_polygons(p):
                        if pp is None or pp.is_empty:
                            continue
                        if float(pp.area) < float(min_area_px):
                            continue

                        pw = translate(pp, xoff=float(x0), yoff=float(y0))

                        if clip_to_wsi_bounds is not None:
                            W, H = clip_to_wsi_bounds
                            bb = sbox(0, 0, float(W), float(H))
                            try:
                                pw = pw.intersection(bb)
                            except Exception:
                                pass

                        for q in geom_to_polygons(pw):
                            if q is None or q.is_empty:
                                continue
                            if float(q.area) < float(min_area_px):
                                continue
                            pr_polys.append(q)
                            pr_scores.append(sc)
                            pr_cls.append(cc)

        processed += len(batch)
        write_progress("predicting")

    return pr_polys, pr_scores, pr_cls, {"n_tiles": len(tile_paths), "n_pred": len(pr_polys)}


def polygons_to_featurecollection(
    polys: List[Polygon],
    scores: Optional[List[float]] = None,
    classes: Optional[List[int]] = None,
) -> Dict[str, Any]:
    feats: List[Dict[str, Any]] = []
    for i, poly in enumerate(polys):
        for p in geom_to_polygons(poly):
            coords = [[float(x), float(y)] for (x, y) in list(p.exterior.coords)]
            props = {}
            if scores is not None and i < len(scores):
                props["score"] = float(scores[i])
            if classes is not None and i < len(classes):
                props["class_id"] = int(classes[i])
            feats.append({
                "type": "Feature",
                "properties": props,
                "geometry": {"type": "Polygon", "coordinates": [coords]},
            })
    return {"type": "FeatureCollection", "features": feats}


def build_tiles(
    wsi_path: Path,
    out_dir: Path,
    tile_size: int,
    stride: int,
    page: int,
    tissue_ratio_thr: float,
    tissue_white_thr: int,
    tissue_downsample: int,
    max_tiles: Optional[int],
) -> Tuple[List[Path], Tuple[int, int]]:
    ensure_dir(out_dir)
    img = open_vips(wsi_path, page=page)
    W, H = int(img.width), int(img.height)
    wsi_id = wsi_path.stem

    tile_paths: List[Path] = []
    count = 0
    for y in range(0, H, stride):
        for x in range(0, W, stride):
            if max_tiles is not None and count >= max_tiles:
                return tile_paths, (W, H)
            pil = vips_crop_to_pil(img, x, y, tile_size, tile_size)
            if tissue_ratio_thr > 0:
                tr = tissue_ratio_rgb(pil, white_thr=tissue_white_thr, downsample=tissue_downsample)
                if tr < tissue_ratio_thr:
                    continue

            tile_name = f"{wsi_id}__x{x:07d}_y{y:07d}.jpg"
            tile_path = out_dir / tile_name
            pil.save(tile_path, format="JPEG", quality=90)
            tile_paths.append(tile_path)
            count += 1

    return tile_paths, (W, H)


def make_overview(
    wsi_path: Path,
    out_png: Path,
    page: int = 0,
    max_side: int = 3000,
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
    ensure_dir(out_png.parent)
    thumb.write_to_file(str(out_png))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--wsi_path", required=True)
    ap.add_argument("--weights", required=True)
    ap.add_argument("--out_geojson", required=True)
    ap.add_argument("--out_overview", default=None)

    ap.add_argument("--tile_size", type=int, default=640)
    ap.add_argument("--stride", type=int, default=640)
    ap.add_argument("--page", type=int, default=0)
    ap.add_argument("--tissue_ratio_thr", type=float, default=0.02)
    ap.add_argument("--tissue_white_thr", type=int, default=235)
    ap.add_argument("--tissue_downsample", type=int, default=128)
    ap.add_argument("--max_tiles", type=int, default=None)

    ap.add_argument("--imgsz", type=int, default=640)
    ap.add_argument("--conf", type=float, default=0.25)
    ap.add_argument("--iou", type=float, default=0.70)
    ap.add_argument("--device", default="cpu")
    ap.add_argument("--half", action="store_true")
    ap.add_argument("--max_det", type=int, default=300)
    ap.add_argument("--classes", nargs="+", type=int, default=None)
    ap.add_argument("--agnostic_nms", action="store_true")
    ap.add_argument("--retina_masks", action="store_true")
    ap.add_argument("--min_area_px", type=float, default=1500.0)
    ap.add_argument("--fix_invalid", action="store_true")

    ap.add_argument("--overview_max_side", type=int, default=2400)
    ap.add_argument("--overview_scale", type=float, default=0.0)
    ap.add_argument("--overview_max_width", type=int, default=0)
    ap.add_argument("--overview_max_height", type=int, default=0)
    ap.add_argument("--batch_size", type=int, default=32)
    ap.add_argument("--progress_file", default=None)

    args = ap.parse_args()

    wsi_path = Path(args.wsi_path)
    if not wsi_path.exists():
        raise FileNotFoundError(f"WSI not found: {wsi_path}")

    tiles_dir = Path(args.out_geojson).parent / "tiles"
    progress_file = Path(args.progress_file) if args.progress_file else None
    if progress_file:
        progress_file.parent.mkdir(parents=True, exist_ok=True)
        progress_file.write_text(json.dumps({"state": "tiling", "updated_at": time.time()}), encoding="utf-8")
    tile_paths, (W, H) = build_tiles(
        wsi_path=wsi_path,
        out_dir=tiles_dir,
        tile_size=int(args.tile_size),
        stride=int(args.stride),
        page=int(args.page),
        tissue_ratio_thr=float(args.tissue_ratio_thr),
        tissue_white_thr=int(args.tissue_white_thr),
        tissue_downsample=int(args.tissue_downsample),
        max_tiles=args.max_tiles,
    )
    if progress_file:
        progress_file.write_text(
            json.dumps(
                {
                    "state": "tiling_done",
                    "total_tiles": int(len(tile_paths)),
                    "processed_tiles": 0,
                    "predicted_objects": 0,
                    "updated_at": time.time(),
                }
            ),
            encoding="utf-8",
        )

    model = YOLO(str(args.weights))
    pr_polys, pr_scores, pr_cls, _ = predict_from_tileset(
        model=model,
        tile_paths=tile_paths,
        imgsz=int(args.imgsz),
        conf=float(args.conf),
        iou=float(args.iou),
        device=str(args.device),
        half=bool(args.half),
        max_det=int(args.max_det),
        classes=args.classes,
        agnostic_nms=bool(args.agnostic_nms),
        retina_masks=bool(args.retina_masks),
        min_area_px=float(args.min_area_px),
        fix_invalid=bool(args.fix_invalid),
        clip_to_wsi_bounds=(W, H),
        batch_size=int(args.batch_size),
        progress_file=progress_file,
    )

    out_geo = Path(args.out_geojson)
    ensure_dir(out_geo.parent)
    out_geo.write_text(
        json.dumps(polygons_to_featurecollection(pr_polys, scores=pr_scores, classes=pr_cls), ensure_ascii=False),
        encoding="utf-8",
    )

    if args.out_overview:
        out_overview = Path(args.out_overview)
        make_overview(
            wsi_path=wsi_path,
            out_png=out_overview,
            page=int(args.page),
            max_side=int(args.overview_max_side),
            scale=float(args.overview_scale) if float(args.overview_scale) > 0 else None,
            max_width=int(args.overview_max_width) if int(args.overview_max_width) > 0 else None,
            max_height=int(args.overview_max_height) if int(args.overview_max_height) > 0 else None,
        )
    if progress_file:
        progress_file.write_text(
            json.dumps(
                {
                    "state": "done",
                    "total_tiles": int(len(tile_paths)),
                    "processed_tiles": int(len(tile_paths)),
                    "predicted_objects": int(len(pr_polys)),
                    "updated_at": time.time(),
                }
            ),
            encoding="utf-8",
        )


if __name__ == "__main__":
    main()
