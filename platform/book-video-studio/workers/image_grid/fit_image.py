#!/usr/bin/env python3
"""Center-crop and resize a single image.
argv[1]: JSON {"input":"in.png","output":"out.jpg","output_width":1280,"output_height":720}
"""
import json
import os
import sys
from PIL import Image


def fit_to_ratio(image, output_width, output_height):
    target_ratio = output_width / output_height
    current_ratio = image.width / image.height
    if current_ratio > target_ratio:
        new_w = int(image.height * target_ratio)
        left = (image.width - new_w) // 2
        image = image.crop((left, 0, left + new_w, image.height))
    elif current_ratio < target_ratio:
        new_h = int(image.width / target_ratio)
        top = (image.height - new_h) // 2
        image = image.crop((0, top, image.width, top + new_h))
    return image.resize((output_width, output_height), Image.LANCZOS)


def main():
    cfg = json.load(open(sys.argv[1], "r", encoding="utf-8"))
    output_width = int(cfg["output_width"])
    output_height = int(cfg["output_height"])
    os.makedirs(os.path.dirname(cfg["output"]) or ".", exist_ok=True)

    with Image.open(cfg["input"]) as im:
        out = fit_to_ratio(im, output_width, output_height)
        output = cfg["output"]
        if output.lower().endswith((".jpg", ".jpeg")):
            out = out.convert("RGB")
            out.save(output, quality=95, subsampling=0, optimize=True)
        else:
            out.save(output)

    print(json.dumps({"output": cfg["output"], "width": output_width, "height": output_height}))


if __name__ == "__main__":
    main()
