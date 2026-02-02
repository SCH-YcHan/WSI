#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
03_tileset_wsi_eval_from_yolo_labels.py

- fold_info/TEST/images + fold_info/TEST/labels 를 사용
- labels(txt)의 YOLO-seg polygon(정규화 좌표)을 GT로 복원
- images 타일에 대해 YOLO-seg predict 수행
- 타일 파일명 좌표(__x0000640_y0008960)를 이용해 GT/Pred polygon을 WSI 좌표로 변환
- WSI-level GeoJSON 저장 (gt, pred)
- IoU 기반 1:1 매칭으로 P/R/F1 평가 (WSI-level instance)
- (옵션) 원본 WSI 썸네일(overview)에 GT(초록) / Pred(파랑) 오버레이 저장

주의:
- Ultralytics의 --iou 는 "NMS IoU threshold" (predict/val에서 동일 의미)
- 이 스크립트의 --iou_thrs 는 "평가 매칭 IoU threshold" (기본 0.5:0.95:0.05)
"""

import re
import json
import argparse
from pathlib import Path
from typing import List, Dict, Any, Tuple, Optional

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

try:
    from shapely.geometry import shape, Polygon, MultiPolygon, GeometryCollection, box as sbox
    from shapely.affinity import translate
except Exception as e:
    raise RuntimeError("shapely가 필요합니다. conda/pip로 설치하세요.") from e

try:
    from ultralytics import YOLO
except Exception as e:
    raise RuntimeError("ultralytics가 필요합니다. pip install -U ultralytics") from e


# -----------------------------
# Utils
# -----------------------------
def ensure_dir(p: Path) -> None:
    p.mkdir(parents=True, exist_ok=True)


_TILE_RE = re.compile(r"^(?P<wsi>.+?)__x(?P<x>\d+)_y(?P<y>\d+)$")


def parse_tile_name(stem: str) -> Tuple[str, int, int]:
    """
    stem: 확장자 제외 파일명
    return: (wsi_id, x0, y0)
    """
    m = _TILE_RE.match(stem)
    if not m:
        raise ValueError(f"타일 파일명 파싱 실패: {stem} (expected: <wsi>__x0000000_y0000000)")
    return m.group("wsi"), int(m.group("x")), int(m.group("y"))


def parse_iou_thrs(vals: Optional[List[str]]) -> List[float]:
    """
    --iou_thrs:
      1) 리스트: --iou_thrs 0.5 0.75
      2) range:  --iou_thrs 0.5:0.95:0.05
    지정 안 하면 COCO 기본 (0.5~0.95 step 0.05)
    """
    if not vals or len(vals) == 0:
        return [round(x, 2) for x in np.arange(0.50, 0.96, 0.05).tolist()]
    if len(vals) == 1 and ":" in vals[0]:
        a, b, c = vals[0].split(":")
        start = float(a); end = float(b); step = float(c)
        out = []
        x = start
        while x <= end + 1e-9:
            out.append(float(round(x, 2)))
            x += step
        return out
    return [float(x) for x in vals]


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


def safe_fix(geom) -> Any:
    if geom is None or getattr(geom, "is_empty", True):
        return geom
    if getattr(geom, "is_valid", True):
        return geom
    try:
        return geom.buffer(0)
    except Exception:
        return geom


# -----------------------------
# YOLO label (GT) -> Polygon
# -----------------------------
def yolo_seg_line_to_polygon(line: str, w: int, h: int) -> Optional[Tuple[int, Polygon]]:
    """
    line: "<cls> x1 y1 x2 y2 ..."
    coords normalized [0,1] in tile
    return: (class_id, polygon_pixel)
    """
    line = line.strip()
    if not line:
        return None
    parts = line.split()
    if len(parts) < 1 + 6:
        return None

    try:
        cls = int(float(parts[0]))
    except Exception:
        return None

    vals = parts[1:]
    if len(vals) % 2 != 0:
        return None

    pts = []
    for i in range(0, len(vals), 2):
        try:
            xn = float(vals[i]); yn = float(vals[i + 1])
        except Exception:
            return None
        xn = 0.0 if xn < 0 else (1.0 if xn > 1 else xn)
        yn = 0.0 if yn < 0 else (1.0 if yn > 1 else yn)
        x = xn * float(w)
        y = yn * float(h)
        pts.append((x, y))

    # 닫힘점 제거(있으면)
    if len(pts) >= 2 and np.allclose(pts[0], pts[-1]):
        pts = pts[:-1]
    if len(pts) < 3:
        return None

    try:
        poly = Polygon(pts)
    except Exception:
        return None
    if poly is None or poly.is_empty:
        return None
    poly = safe_fix(poly)
    # buffer(0) 후 MultiPolygon이 될 수 있음 → 호출부에서 flatten
    return cls, poly


def load_gt_polygons_from_labels(
    tile_paths: List[Path],
    labels_dir: Path,
    min_area_px: float,
    fix_invalid: bool = True,
    clip_to_wsi_bounds: Optional[Tuple[int, int]] = None,
) -> Tuple[List[Polygon], List[int]]:
    """
    각 타일에 대응하는 txt를 읽어 GT polygon을 WSI 좌표로 변환
    return: (gt_polys_wsi, gt_cls)
    """
    gt_polys: List[Polygon] = []
    gt_cls: List[int] = []

    for img_path in tile_paths:
        stem = img_path.stem
        wsi_id, x0, y0 = parse_tile_name(stem)
        txt = labels_dir / f"{stem}.txt"
        if not txt.exists():
            # background tile일 수도 있으니 조용히 skip
            continue

        # 타일 크기(안전하게 이미지에서 읽음)
        try:
            with Image.open(img_path) as im:
                w, h = im.size
        except Exception:
            w = h = 640  # fallback

        lines = txt.read_text(encoding="utf-8").splitlines()
        for line in lines:
            out = yolo_seg_line_to_polygon(line, w=w, h=h)
            if out is None:
                continue
            cls, poly = out
            if fix_invalid:
                poly = safe_fix(poly)
            # flatten
            for p in geom_to_polygons(poly):
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
                        gt_polys.append(q)
                        gt_cls.append(int(cls))

    return gt_polys, gt_cls


# -----------------------------
# Pred (Ultralytics) -> Polygon
# -----------------------------
def predict_from_tileset(
    model: "YOLO",
    tile_paths: List[Path],
    imgsz: int,
    conf: float,
    iou: float,                 # NMS IoU threshold (Ultralytics와 동일 의미)
    device: str,
    half: bool,
    max_det: int,
    classes: Optional[List[int]],
    agnostic_nms: bool,
    retina_masks: bool,
    min_area_px: float,
    fix_invalid: bool = True,
    clip_to_wsi_bounds: Optional[Tuple[int, int]] = None,
) -> Tuple[List[Polygon], List[float], List[int], Dict[str, Any]]:
    """
    return: (pred_polys_wsi, pred_scores, pred_cls, stats)
    """
    if not tile_paths:
        return [], [], [], {"n_tiles": 0, "n_pred": 0}

    results = model.predict(
        source=[str(p) for p in tile_paths],
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

    pr_polys: List[Polygon] = []
    pr_scores: List[float] = []
    pr_cls: List[int] = []

    for pth, r in zip(tile_paths, results):
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

    return pr_polys, pr_scores, pr_cls, {"n_tiles": len(tile_paths), "n_pred": len(pr_polys)}


# -----------------------------
# GeoJSON I/O
# -----------------------------
def polygons_to_featurecollection(polys: List[Polygon], scores: Optional[List[float]] = None, classes: Optional[List[int]] = None) -> Dict[str, Any]:
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


# -----------------------------
# Eval (WSI-level instance matching)
# -----------------------------
def bbox_of_poly(poly: Polygon) -> Tuple[float, float, float, float]:
    minx, miny, maxx, maxy = poly.bounds
    return float(minx), float(miny), float(maxx), float(maxy)


def bbox_iou(a: Tuple[float, float, float, float], b: Tuple[float, float, float, float]) -> float:
    ax0, ay0, ax1, ay1 = a
    bx0, by0, bx1, by1 = b
    ix0 = max(ax0, bx0); iy0 = max(ay0, by0)
    ix1 = min(ax1, bx1); iy1 = min(ay1, by1)
    iw = max(0.0, ix1 - ix0); ih = max(0.0, iy1 - iy0)
    inter = iw * ih
    if inter <= 0:
        return 0.0
    area_a = max(0.0, (ax1 - ax0)) * max(0.0, (ay1 - ay0))
    area_b = max(0.0, (bx1 - bx0)) * max(0.0, (by1 - by0))
    union = area_a + area_b - inter
    return float(inter / union) if union > 0 else 0.0


def poly_iou_and_dice(a: Polygon, b: Polygon) -> Tuple[float, float]:
    inter = a.intersection(b).area
    if inter <= 0:
        return 0.0, 0.0
    ua = a.area; ub = b.area
    union = ua + ub - inter
    iou = float(inter / union) if union > 0 else 0.0
    dice = float(2.0 * inter / (ua + ub)) if (ua + ub) > 0 else 0.0
    return iou, dice


def match_by_iou(
    gt_polys: List[Polygon],
    pr_polys: List[Polygon],
    gt_cls: Optional[List[int]],
    pr_cls: Optional[List[int]],
    thr: float,
    class_agnostic: bool = False,
) -> Dict[str, Any]:
    ng = len(gt_polys); npred = len(pr_polys)

    if ng == 0 and npred == 0:
        return dict(tp=0, fp=0, fn=0, precision=1.0, recall=1.0, f1=1.0,
                    mean_iou_tp=0.0, mean_dice_tp=0.0, n_gt=0, n_pred=0)

    if ng == 0:
        return dict(tp=0, fp=npred, fn=0, precision=0.0, recall=1.0, f1=0.0,
                    mean_iou_tp=0.0, mean_dice_tp=0.0, n_gt=0, n_pred=npred)

    if npred == 0:
        return dict(tp=0, fp=0, fn=ng, precision=1.0, recall=0.0, f1=0.0,
                    mean_iou_tp=0.0, mean_dice_tp=0.0, n_gt=ng, n_pred=0)

    gt_bb = [bbox_of_poly(g) for g in gt_polys]
    pr_bb = [bbox_of_poly(p) for p in pr_polys]

    pairs: List[Tuple[float, float, int, int]] = []  # (iou, dice, pi, gi)
    for pi, p in enumerate(pr_polys):
        pb = pr_bb[pi]
        for gi, g in enumerate(gt_polys):
            # class match
            if (not class_agnostic) and (gt_cls is not None) and (pr_cls is not None):
                if gi < len(gt_cls) and pi < len(pr_cls):
                    if int(gt_cls[gi]) != int(pr_cls[pi]):
                        continue

            if bbox_iou(pb, gt_bb[gi]) <= 0:
                continue

            iou, dice = poly_iou_and_dice(p, g)
            if iou > 0:
                pairs.append((iou, dice, pi, gi))

    pairs.sort(key=lambda x: x[0], reverse=True)

    used_p = set(); used_g = set()
    tp_iou = []; tp_dice = []; tp = 0

    for iou, dice, pi, gi in pairs:
        if iou < thr:
            break
        if pi in used_p or gi in used_g:
            continue
        used_p.add(pi); used_g.add(gi)
        tp += 1
        tp_iou.append(iou); tp_dice.append(dice)

    fp = npred - tp
    fn = ng - tp
    precision = float(tp / (tp + fp)) if (tp + fp) > 0 else 0.0
    recall = float(tp / (tp + fn)) if (tp + fn) > 0 else 0.0
    f1 = float(2 * precision * recall / (precision + recall)) if (precision + recall) > 0 else 0.0
    mean_iou_tp = float(np.mean(tp_iou)) if tp_iou else 0.0
    mean_dice_tp = float(np.mean(tp_dice)) if tp_dice else 0.0

    return dict(tp=tp, fp=fp, fn=fn,
                precision=precision, recall=recall, f1=f1,
                mean_iou_tp=mean_iou_tp, mean_dice_tp=mean_dice_tp,
                n_gt=ng, n_pred=npred)


# -----------------------------
# Overview
# -----------------------------
def open_vips(path: Path, page: int = 0) -> "pyvips.Image":
    return pyvips.Image.new_from_file(str(path), access="random", page=page)


def make_overview(
    wsi_path: Path,
    gt_polys: List[Polygon],
    pr_polys: List[Polygon],
    out_png: Path,
    page: int = 0,
    scale: float = 0.05,
    max_side: int = 3000,
) -> None:
    img = open_vips(wsi_path, page=page)
    W = int(img.width); H = int(img.height)

    s = float(scale)
    if max(W, H) * s > max_side:
        s = float(max_side / max(W, H))

    thumb = img.resize(s)
    tw, th = int(thumb.width), int(thumb.height)
    mem = thumb.write_to_memory()
    arr = np.frombuffer(mem, dtype=np.uint8).reshape(th, tw, int(thumb.bands))
    if int(thumb.bands) >= 3:
        arr = arr[:, :, :3]
    else:
        arr = np.repeat(arr, 3, axis=2)

    im = Image.fromarray(arr, mode="RGB").convert("RGBA")
    draw = ImageDraw.Draw(im)

    def draw_poly_list(polys: List[Polygon], color, width: int):
        for p in polys:
            coords = list(p.exterior.coords)
            pts = [(float(x) * s, float(y) * s) for (x, y) in coords]
            if len(pts) >= 2:
                draw.line(pts, fill=color, width=width)

    draw_poly_list(gt_polys, color=(0, 255, 0, 200), width=10)      # GT green
    draw_poly_list(pr_polys, color=(0, 120, 255, 220), width=10)    # Pred blue

    ensure_dir(out_png.parent)
    im.save(out_png)


# -----------------------------
# Main
# -----------------------------
def main():
    ap = argparse.ArgumentParser()

    ap.add_argument("--fold_info", required=True, help="예: .../WT_3fold/Fold0")
    ap.add_argument("--weights", required=True)
    ap.add_argument("--out_root", required=True)
    ap.add_argument("--exp_name", default="model")

    ap.add_argument("--wsi_dir", default=None, help="overview 만들 때만 필요")
    ap.add_argument("--wsi_ext", default=".tif")

    # ---- Ultralytics predict/val 스타일 인자 ----
    ap.add_argument("--imgsz", type=int, default=640)
    ap.add_argument("--conf", type=float, default=0.25)
    ap.add_argument("--iou", type=float, default=0.70)  # NMS IoU threshold
    ap.add_argument("--device", default="0")
    ap.add_argument("--half", action="store_true")
    ap.add_argument("--max_det", type=int, default=300)
    ap.add_argument("--classes", nargs="+", type=int, default=None)
    ap.add_argument("--agnostic_nms", action="store_true")
    ap.add_argument("--retina_masks", action="store_true")

    # ---- 평가 IoU thresholds ----
    ap.add_argument("--iou_thrs", nargs="+", default=None,
                    help="예: --iou_thrs 0.5 0.75  또는  --iou_thrs 0.5:0.95:0.05")

    ap.add_argument("--min_area_px", type=float, default=1500.0)
    ap.add_argument("--fix_invalid", action="store_true")

    ap.add_argument("--class_agnostic_eval", action="store_true",
                    help="기본은 class match로 평가. 이 옵션 켜면 class 무시.")

    ap.add_argument("--make_overview", action="store_true")
    ap.add_argument("--page", type=int, default=0)
    ap.add_argument("--overview_scale", type=float, default=0.05)
    ap.add_argument("--overview_max_side", type=int, default=3000)

    ap.add_argument("--wsi_id", default=None, help="특정 WSI만 처리")

    args = ap.parse_args()
    eval_iou_thrs = parse_iou_thrs(args.iou_thrs)

    fold = Path(args.fold_info)
    tiles_dir = fold / "TEST" / "images"
    labels_dir = fold / "TEST" / "labels"
    if not tiles_dir.exists():
        raise FileNotFoundError(f"tiles_dir not found: {tiles_dir}")
    if not labels_dir.exists():
        raise FileNotFoundError(f"labels_dir not found: {labels_dir}")

    out_root = Path(args.out_root)
    ensure_dir(out_root)

    wsi_dir = Path(args.wsi_dir) if args.wsi_dir else None

    # 타일 수집
    exts = ("*.jpg", "*.jpeg", "*.png")
    all_tiles = []
    for pat in exts:
        all_tiles.extend(sorted(tiles_dir.glob(pat)))
    if not all_tiles:
        raise FileNotFoundError(f"No tiles in: {tiles_dir}")

    # WSI별 그룹핑
    wsi_to_tiles: Dict[str, List[Path]] = {}
    for p in all_tiles:
        wsi_id, _, _ = parse_tile_name(p.stem)
        if args.wsi_id and wsi_id != args.wsi_id:
            continue
        wsi_to_tiles.setdefault(wsi_id, []).append(p)

    if not wsi_to_tiles:
        raise RuntimeError("처리할 WSI가 없습니다. --wsi_id 또는 tiles_dir를 확인하세요.")

    print("[WSIs]", sorted(wsi_to_tiles.keys()))
    print("[Eval IoU thrs]", eval_iou_thrs)
    if args.class_agnostic_eval:
        print("[Eval] class_agnostic=True")

    model = YOLO(str(args.weights))

    pred_root = out_root / "pred"
    gt_root = out_root / "gt"
    ov_root = out_root / "overview"
    eval_outdir = out_root / "eval"
    ensure_dir(pred_root); ensure_dir(gt_root); ensure_dir(eval_outdir)
    if args.make_overview:
        ensure_dir(ov_root)

    per_wsi_rows: List[Dict[str, Any]] = []
    micro = {thr: dict(tp=0, fp=0, fn=0, tp_iou_sum=0.0, tp_dice_sum=0.0, tp_cnt=0) for thr in eval_iou_thrs}

    for wsi_id, tile_paths in wsi_to_tiles.items():
        print(f"\n[WSI] {wsi_id} tiles={len(tile_paths)}")

        # WSI bounds(옵션: clip/overview용)
        clip_wh = None
        wsi_path = None
        if wsi_dir is not None:
            cand = wsi_dir / f"{wsi_id}{args.wsi_ext}"
            if cand.exists():
                wsi_path = cand
                try:
                    imgv = open_vips(wsi_path, page=int(args.page))
                    clip_wh = (int(imgv.width), int(imgv.height))
                except Exception:
                    clip_wh = None

        # GT from labels
        gt_polys, gt_cls = load_gt_polygons_from_labels(
            tile_paths=tile_paths,
            labels_dir=labels_dir,
            min_area_px=float(args.min_area_px),
            fix_invalid=bool(args.fix_invalid),
            clip_to_wsi_bounds=clip_wh,
        )

        # Pred
        pr_polys, pr_scores, pr_cls, st = predict_from_tileset(
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
            clip_to_wsi_bounds=clip_wh,
        )

        # Save GT geojson
        out_gt = gt_root / wsi_id / "geojson" / f"{wsi_id}.geojson"
        ensure_dir(out_gt.parent)
        out_gt.write_text(json.dumps(polygons_to_featurecollection(gt_polys, scores=None, classes=gt_cls),
                                     ensure_ascii=False),
                          encoding="utf-8")
        print(f"[OK] gt  geojson: {out_gt} (gt={len(gt_polys)})")

        # Save Pred geojson
        out_pr = pred_root / wsi_id / "geojson" / f"{wsi_id}.geojson"
        ensure_dir(out_pr.parent)
        out_pr.write_text(json.dumps(polygons_to_featurecollection(pr_polys, scores=pr_scores, classes=pr_cls),
                                     ensure_ascii=False),
                          encoding="utf-8")
        print(f"[OK] pred geojson: {out_pr} (pred={len(pr_polys)})")

        # Overview
        if args.make_overview:
            if wsi_path is None:
                print("[WARN] --make_overview였지만 wsi 파일을 찾지 못해 skip")
            else:
                out_png = ov_root / wsi_id / f"{wsi_id}_overview.png"
                make_overview(
                    wsi_path=wsi_path,
                    gt_polys=gt_polys,
                    pr_polys=pr_polys,
                    out_png=out_png,
                    page=int(args.page),
                    scale=float(args.overview_scale),
                    max_side=int(args.overview_max_side),
                )
                print(f"[OK] overview: {out_png}")

        # Eval
        for thr in eval_iou_thrs:
            m = match_by_iou(
                gt_polys=gt_polys,
                pr_polys=pr_polys,
                gt_cls=gt_cls,
                pr_cls=pr_cls,
                thr=float(thr),
                class_agnostic=bool(args.class_agnostic_eval),
            )
            row = {
                "model": str(args.exp_name),
                "wsi_id": wsi_id,
                "iou_thr": float(thr),
                "n_tiles": int(st.get("n_tiles", len(tile_paths))),
                "n_gt": int(m["n_gt"]),
                "n_pred": int(m["n_pred"]),
                "tp": int(m["tp"]),
                "fp": int(m["fp"]),
                "fn": int(m["fn"]),
                "precision": float(m["precision"]),
                "recall": float(m["recall"]),
                "f1": float(m["f1"]),
                "mean_iou_tp": float(m["mean_iou_tp"]),
                "mean_dice_tp": float(m["mean_dice_tp"]),
            }
            per_wsi_rows.append(row)

            micro[thr]["tp"] += row["tp"]
            micro[thr]["fp"] += row["fp"]
            micro[thr]["fn"] += row["fn"]
            if row["tp"] > 0:
                micro[thr]["tp_iou_sum"] += row["mean_iou_tp"] * row["tp"]
                micro[thr]["tp_dice_sum"] += row["mean_dice_tp"] * row["tp"]
                micro[thr]["tp_cnt"] += row["tp"]

        # 콘솔에는 대표로 0.5/0.75만 출력(있으면)
        for key_thr in [0.5, 0.75]:
            if key_thr in eval_iou_thrs:
                rr = next(x for x in per_wsi_rows[::-1] if x["wsi_id"] == wsi_id and abs(x["iou_thr"]-key_thr) < 1e-9)
                print(f"  [EVAL@IoU{key_thr}] P={rr['precision']:.4f} R={rr['recall']:.4f} F1={rr['f1']:.4f} "
                      f"(TP={rr['tp']} FP={rr['fp']} FN={rr['fn']})")

    # MICRO
    micro_rows = []
    for thr in eval_iou_thrs:
        tp = micro[thr]["tp"]; fp = micro[thr]["fp"]; fn = micro[thr]["fn"]
        precision = float(tp / (tp + fp)) if (tp + fp) > 0 else 0.0
        recall = float(tp / (tp + fn)) if (tp + fn) > 0 else 0.0
        f1 = float(2 * precision * recall / (precision + recall)) if (precision + recall) > 0 else 0.0
        mean_iou_tp = float(micro[thr]["tp_iou_sum"] / micro[thr]["tp_cnt"]) if micro[thr]["tp_cnt"] > 0 else 0.0
        mean_dice_tp = float(micro[thr]["tp_dice_sum"] / micro[thr]["tp_cnt"]) if micro[thr]["tp_cnt"] > 0 else 0.0
        micro_rows.append({
            "model": str(args.exp_name),
            "wsi_id": "__MICRO__",
            "iou_thr": float(thr),
            "tp": int(tp), "fp": int(fp), "fn": int(fn),
            "precision": float(precision), "recall": float(recall), "f1": float(f1),
            "mean_iou_tp": float(mean_iou_tp), "mean_dice_tp": float(mean_dice_tp),
        })

    mean_f1 = float(np.mean([r["f1"] for r in micro_rows])) if micro_rows else 0.0

    payload = {
        "exp_name": str(args.exp_name),
        "weights": str(args.weights),
        "fold_info": str(Path(args.fold_info)),
        "tiles_dir": str(tiles_dir),
        "labels_dir": str(labels_dir),
        "wsi_dir": str(wsi_dir) if wsi_dir else None,
        "predict_params_ultralytics_style": {
            "imgsz": args.imgsz, "conf": args.conf, "iou": args.iou, "device": args.device,
            "half": bool(args.half), "max_det": args.max_det, "classes": args.classes,
            "agnostic_nms": bool(args.agnostic_nms), "retina_masks": bool(args.retina_masks),
        },
        "eval_iou_thrs": eval_iou_thrs,
        "class_agnostic_eval": bool(args.class_agnostic_eval),
        "micro": micro_rows,
        "micro_meanF1_over_iou_thrs": mean_f1,
        "per_wsi": per_wsi_rows,
    }

    out_json = eval_outdir / "results.json"
    out_json.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    out_csv = eval_outdir / "results.csv"
    header = ["model","wsi_id","iou_thr","n_tiles","n_gt","n_pred","tp","fp","fn","precision","recall","f1","mean_iou_tp","mean_dice_tp"]
    lines = [",".join(header)]
    for r in per_wsi_rows + micro_rows:
        lines.append(",".join([
            str(r.get("model","")),
            str(r.get("wsi_id","")),
            f"{float(r.get('iou_thr',0)):.2f}",
            str(r.get("n_tiles","")),
            str(r.get("n_gt","")),
            str(r.get("n_pred","")),
            str(r.get("tp","")),
            str(r.get("fp","")),
            str(r.get("fn","")),
            f"{float(r.get('precision',0)):.6f}",
            f"{float(r.get('recall',0)):.6f}",
            f"{float(r.get('f1',0)):.6f}",
            f"{float(r.get('mean_iou_tp',0)):.6f}",
            f"{float(r.get('mean_dice_tp',0)):.6f}",
        ]))
    out_csv.write_text("\n".join(lines) + "\n", encoding="utf-8")

    print("\n==== MICRO AGGREGATE (WSI-level matching) ====")
    for key_thr in [0.5, 0.75]:
        if key_thr in eval_iou_thrs:
            r = next(x for x in micro_rows if abs(x["iou_thr"]-key_thr) < 1e-9)
            print(f"{args.exp_name} @IoU{key_thr}: P={r['precision']:.4f} R={r['recall']:.4f} F1={r['f1']:.4f} "
                  f"meanIoU_TP={r['mean_iou_tp']:.4f} meanDice_TP={r['mean_dice_tp']:.4f}")
    print(f"[COCO-style mean over IoU thrs] meanF1={mean_f1:.4f}")

    print("\n[DONE]")
    print(f"- GT   geojson root: {gt_root}")
    print(f"- Pred geojson root: {pred_root}")
    if args.make_overview:
        print(f"- Overview root     : {ov_root}")
    print(f"- Eval outputs      : {eval_outdir} (results.json / results.csv)")


if __name__ == "__main__":
    main()
