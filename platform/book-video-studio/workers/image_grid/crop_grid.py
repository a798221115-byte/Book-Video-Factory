#!/usr/bin/env python3
"""把 3x3 九宫格总图裁成 9 张独立图，或把单张图 fit 成最终分镜。
argv[1]: JSON {"grid":"总图.png","out_prefix":"cell_","out_dir":"...","inset":0.02,"output_width":768,"output_height":768}
单图模式: {"single":true,"grid":"输入.png","out_path":"输出.jpg","output_width":768,"output_height":768}
输出 JSON: {"cells":["path1",...]}；九宫格按 左→右、上→下 顺序。
"""
import sys, json, os
from PIL import Image


def fit_to_output(im, output_width, output_height):
    if output_width <= 0 or output_height <= 0:
        return im
    target_ratio = output_width / output_height
    current_ratio = im.width / im.height
    if current_ratio > target_ratio:
        new_w = int(im.height * target_ratio)
        left = (im.width - new_w) // 2
        im = im.crop((left, 0, left + new_w, im.height))
    elif current_ratio < target_ratio:
        new_h = int(im.width / target_ratio)
        top = (im.height - new_h) // 2
        im = im.crop((0, top, im.width, top + new_h))
    return im.resize((output_width, output_height), Image.LANCZOS)


def main():
    cfg = json.load(open(sys.argv[1], "r", encoding="utf-8"))
    im = Image.open(cfg["grid"]).convert("RGB")
    cell_size = int(cfg.get("cell_size", 0))  # 旧配置兼容：>0 则输出 cell_size 正方形
    output_width = int(cfg.get("output_width", cell_size))
    output_height = int(cfg.get("output_height", cell_size))

    if cfg.get("single"):
        out_path = cfg["out_path"]
        out_dir = os.path.dirname(out_path)
        if out_dir:
            os.makedirs(out_dir, exist_ok=True)
        fit_to_output(im, output_width, output_height).save(out_path, quality=95, subsampling=0, optimize=True)
        print(json.dumps({"cells": [out_path]}))
        return

    W, H = im.size
    cw, ch = W / 3.0, H / 3.0
    inset = float(cfg.get("inset", 0.02))  # 向内收，避开格子间分隔线
    out_dir = cfg["out_dir"]
    prefix = cfg.get("out_prefix", "cell_")
    paths = []
    idx = 0
    for r in range(3):
        for c in range(3):
            x0 = int(c * cw + cw * inset)
            y0 = int(r * ch + ch * inset)
            x1 = int((c + 1) * cw - cw * inset)
            y1 = int((r + 1) * ch - ch * inset)
            cell = im.crop((x0, y0, x1, y1))
            cell = fit_to_output(cell, output_width, output_height)
            p = os.path.join(out_dir, f"{prefix}{idx:03d}.jpg")
            cell.save(p, quality=95, subsampling=0, optimize=True)
            paths.append(p)
            idx += 1
    print(json.dumps({"cells": paths}))


if __name__ == "__main__":
    main()
