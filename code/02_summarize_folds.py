#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import argparse
from pathlib import Path
from collections import Counter, defaultdict

from PIL import Image


def iter_images(img_dir: Path):
    for ext in ("*.jpg", "*.jpeg", "*.png"):
        for p in img_dir.glob(ext):
            yield p


def read_label_lines(lbl_path: Path):
    if not lbl_path.exists():
        return []
    txt = lbl_path.read_text(encoding="utf-8").strip()
    if not txt:
        return []
    return [ln for ln in txt.splitlines() if ln.strip()]


def summarize_split(split_dir: Path, sample_image_size: int = 200):
    img_dir = split_dir / "images"
    lbl_dir = split_dir / "labels"

    imgs = sorted(list(iter_images(img_dir)))
    n_img = len(imgs)

    # 라벨 매칭은 "파일명 stem 동일" 기준
    n_lbl_exist = 0
    n_empty_lbl = 0
    n_missing_lbl = 0

    # 인스턴스 통계
    cls_counter = Counter()
    total_instances = 0
    tiles_with_instances = 0
    inst_per_tile = []

    # 이미지 크기 샘플(전체 열면 느릴 수 있어서 일부만)
    sizes = []
    for i, ip in enumerate(imgs[:sample_image_size]):
        try:
            with Image.open(ip) as im:
                sizes.append(im.size)  # (W,H)
        except Exception:
            pass

    for ip in imgs:
        lp = lbl_dir / f"{ip.stem}.txt"
        if not lp.exists():
            n_missing_lbl += 1
            continue

        n_lbl_exist += 1
        lines = read_label_lines(lp)
        if len(lines) == 0:
            n_empty_lbl += 1
            continue

        tiles_with_instances += 1
        inst_cnt = 0
        for ln in lines:
            # YOLO-seg line: "<cls> x1 y1 x2 y2 ..."
            parts = ln.strip().split()
            if not parts:
                continue
            try:
                cls_id = int(parts[0])
            except Exception:
                continue
            cls_counter[cls_id] += 1
            total_instances += 1
            inst_cnt += 1
        inst_per_tile.append(inst_cnt)

    non_empty = n_lbl_exist - n_empty_lbl
    empty_ratio = (n_empty_lbl / n_lbl_exist) if n_lbl_exist > 0 else 0.0

    # 크기 요약
    size_summary = ""
    if sizes:
        w_list = [w for (w, h) in sizes]
        h_list = [h for (w, h) in sizes]
        size_summary = f"{min(w_list)}~{max(w_list)} x {min(h_list)}~{max(h_list)} (sample {len(sizes)})"

    out = {
        "n_img": n_img,
        "n_lbl_exist": n_lbl_exist,
        "n_missing_lbl": n_missing_lbl,
        "n_empty_lbl": n_empty_lbl,
        "empty_ratio": empty_ratio,
        "tiles_with_instances": tiles_with_instances,
        "total_instances": total_instances,
        "avg_instances_per_nonempty_tile": (sum(inst_per_tile) / len(inst_per_tile)) if inst_per_tile else 0.0,
        "cls_counter": dict(cls_counter),
        "size_summary": size_summary,
    }
    return out


def fmt_counter(cdict):
    # 0,1 외 다른 클래스가 있어도 표시
    if not cdict:
        return "-"
    keys = sorted(cdict.keys())
    return ", ".join([f"{k}:{cdict[k]}" for k in keys])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", required=True, help="예: /home/ads_lab/study/GLO/data/WT_3fold")
    ap.add_argument("--sample_image_size", type=int, default=200, help="이미지 크기 확인용 샘플 수(빠르게)")
    args = ap.parse_args()

    root = Path(args.root)
    folds = sorted([p for p in root.iterdir() if p.is_dir() and p.name.lower().startswith("fold")])
    if not folds:
        raise FileNotFoundError(f"Fold 폴더를 찾지 못함: {root}")

    print(f"[ROOT] {root}")
    print("Classes: 0=glomerulus_adenine, 1=glomerulus_normal\n")

    for fold_dir in folds:
        print("=" * 80)
        print(f"[{fold_dir.name}] {fold_dir}")

        for split in ["TRAIN", "TEST"]:
            split_dir = fold_dir / split
            if not split_dir.exists():
                print(f"  - {split}: (missing)")
                continue

            s = summarize_split(split_dir, sample_image_size=args.sample_image_size)

            print(f"  - {split}")
            print(f"    images                : {s['n_img']}")
            print(f"    labels (exist/missing): {s['n_lbl_exist']} / {s['n_missing_lbl']}")
            print(f"    empty-label tiles     : {s['n_empty_lbl']}  ({s['empty_ratio']*100:.1f}%)")
            print(f"    tiles w/ instances    : {s['tiles_with_instances']}")
            print(f"    total instances       : {s['total_instances']}")
            print(f"    avg inst/nonempty tile: {s['avg_instances_per_nonempty_tile']:.2f}")
            print(f"    instances by class    : {fmt_counter(s['cls_counter'])}")
            if s["size_summary"]:
                print(f"    image size (sample)   : {s['size_summary']}")
        print()

    print("=" * 80)
    print("[DONE]")


if __name__ == "__main__":
    main()
