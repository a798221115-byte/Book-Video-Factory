#!/usr/bin/env python3
"""Compose the approved 1080x1260 WeChat Channels book-cover card."""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont


W, H = 1080, 1260


def font(path: Path, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(path), size=size)


def fit_font(draw: ImageDraw.ImageDraw, text: str, path: Path, start: int, max_width: int, stroke: int = 0):
    size = start
    while size >= 24:
        candidate = font(path, size)
        box = draw.textbbox((0, 0), text, font=candidate, stroke_width=stroke)
        if box[2] - box[0] <= max_width:
            return candidate
        size -= 2
    return font(path, 24)


def center_text(draw, y, text, font_obj, fill, stroke_width=0, stroke_fill=None):
    box = draw.textbbox((0, 0), text, font=font_obj, stroke_width=stroke_width)
    x = (W - (box[2] - box[0])) // 2
    draw.text((x, y), text, font=font_obj, fill=fill, stroke_width=stroke_width, stroke_fill=stroke_fill)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--background", type=Path, required=True)
    parser.add_argument("--book-cover", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--headline-1", required=True)
    parser.add_argument("--headline-2", required=True)
    parser.add_argument("--metadata-1", required=True)
    parser.add_argument("--metadata-2", required=True)
    parser.add_argument("--label", default="视频号 · 读书分享")
    parser.add_argument("--font-bold", type=Path, default=Path(r"C:\Windows\Fonts\Noto Sans SC Bold (TrueType).otf"))
    parser.add_argument("--font-regular", type=Path, default=Path(r"C:\Windows\Fonts\Noto Sans SC (TrueType).otf"))
    args = parser.parse_args()

    for source in (args.background, args.book_cover, args.font_bold, args.font_regular):
        if not source.is_file():
            raise FileNotFoundError(source)
    if args.out.exists():
        raise FileExistsError(f"Refusing to overwrite: {args.out}")

    bg = Image.open(args.background).convert("RGB")
    bg_ratio = bg.width / bg.height
    target_ratio = W / H
    if bg_ratio > target_ratio:
        crop_w = round(bg.height * target_ratio)
        left = (bg.width - crop_w) // 2
        bg = bg.crop((left, 0, left + crop_w, bg.height))
    else:
        crop_h = round(bg.width / target_ratio)
        top = (bg.height - crop_h) // 2
        bg = bg.crop((0, top, bg.width, top + crop_h))
    canvas = bg.resize((W, H), Image.Resampling.LANCZOS)

    # Gently darken the outer edges while keeping the central parchment readable.
    shade = Image.new("L", (W, H), 0)
    sd = ImageDraw.Draw(shade)
    sd.rectangle((0, 0, 170, H), fill=50)
    sd.rectangle((930, 0, W, H), fill=20)
    shade = shade.filter(ImageFilter.GaussianBlur(55))
    overlay = Image.new("RGB", (W, H), (8, 18, 25))
    canvas = Image.composite(overlay, canvas, shade)
    draw = ImageDraw.Draw(canvas)

    # Pill label.
    label_font = fit_font(draw, args.label, args.font_regular, 29, 330)
    label_box = draw.textbbox((0, 0), args.label, font=label_font)
    pill_w = label_box[2] - label_box[0] + 50
    pill_x = (W - pill_w) // 2
    draw.rounded_rectangle((pill_x, 48, pill_x + pill_w, 104), radius=28,
                           fill=(18, 40, 52), outline=(229, 166, 57), width=2)
    center_text(draw, 60, args.label, label_font, (250, 248, 240))

    # Two-line headline.
    head1 = fit_font(draw, args.headline_1, args.font_bold, 76, 920, stroke=4)
    head2 = fit_font(draw, args.headline_2, args.font_bold, 52, 920, stroke=3)
    center_text(draw, 128, args.headline_1, head1, (250, 247, 234), 4, (8, 21, 29))
    center_text(draw, 220, args.headline_2, head2, (231, 137, 54), 3, (24, 22, 18))

    # Verified original cover, complete and uncropped.
    book = Image.open(args.book_cover).convert("RGB")
    max_w, max_h = 500, 660
    scale = min(max_w / book.width, max_h / book.height)
    book = book.resize((round(book.width * scale), round(book.height * scale)), Image.Resampling.LANCZOS)
    bx = (W - book.width) // 2
    by = 326
    shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    shd = ImageDraw.Draw(shadow)
    shd.rounded_rectangle((bx + 12, by + 16, bx + book.width + 12, by + book.height + 16), radius=7, fill=(0, 0, 0, 105))
    shadow = shadow.filter(ImageFilter.GaussianBlur(14))
    canvas = Image.alpha_composite(canvas.convert("RGBA"), shadow)
    canvas.paste(book.convert("RGBA"), (bx, by))
    draw = ImageDraw.Draw(canvas)
    draw.rounded_rectangle((bx - 2, by - 2, bx + book.width + 2, by + book.height + 2), radius=5,
                           outline=(233, 180, 92, 255), width=2)

    # Bottom metadata.
    meta1 = fit_font(draw, args.metadata_1, args.font_regular, 32, 900, stroke=2)
    meta2 = fit_font(draw, args.metadata_2, args.font_regular, 26, 820, stroke=1)
    center_text(draw, 1045, args.metadata_1, meta1, (244, 246, 241, 255), 2, (15, 29, 36, 255))
    center_text(draw, 1092, args.metadata_2, meta2, (228, 174, 87, 255), 1, (31, 29, 23, 255))

    args.out.parent.mkdir(parents=True, exist_ok=True)
    canvas.convert("RGB").save(args.out, format="PNG", optimize=True)
    with Image.open(args.out) as check:
        if check.size != (W, H):
            raise ValueError(f"Unexpected output size: {check.size}")
    print(args.out.resolve())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
