#!/usr/bin/env python3
"""
把若干文本行渲染成透明 PNG（中文居中 + 描边），供 ffmpeg overlay 叠加。
stdin: JSON {"font": "/path.ttc", "items": [{"text","out","fontsize","width","stroke","pad","fill","stroke_fill","max_lines"}]}
"""
import sys, json
from PIL import Image, ImageDraw, ImageFont


def color(value, fallback):
    if isinstance(value, list) and len(value) in (3, 4):
        vals = [max(0, min(255, int(v))) for v in value]
        return tuple(vals if len(vals) == 4 else vals + [255])
    return fallback


def render_one(font_path, text, out, fontsize, width, stroke, pad, fill, stroke_fill, max_lines):
    def load(sz):
        try:
            return ImageFont.truetype(font_path, sz)
        except Exception:
            return ImageFont.load_default()
    tmp = Image.new("RGBA", (10, 10), (0, 0, 0, 0))
    d = ImageDraw.Draw(tmp)

    def text_width(value, font):
        bbox = d.textbbox((0, 0), value, font=font, stroke_width=stroke)
        return bbox[2] - bbox[0]

    def wrap_paragraph(value, font, avail):
        value = str(value or "")
        if not value:
            return [""]
        lines = []
        current = ""
        for ch in value:
            if ch == "\n":
                lines.append(current)
                current = ""
                continue
            candidate = current + ch
            if current and text_width(candidate, font) > avail:
                lines.append(current)
                current = ch
            else:
                current = candidate
        lines.append(current)
        return lines

    def wrap_text(value, font, avail, max_lines):
        lines = []
        for para in str(value or "").splitlines() or [""]:
            lines.extend(wrap_paragraph(para, font, avail))
        if max_lines and len(lines) > max_lines:
            lines = lines[:max_lines]
        return lines

    # 自动换行 + 缩字号：保证文字（含描边）宽度不超出画布可用宽度，避免左右出界被裁
    avail = max(1, width - pad * 2 - stroke * 2)
    font = load(fontsize)
    lines = wrap_text(text, font, avail, max_lines)
    line_gap = max(4, int(fontsize * 0.18))
    bboxes = [d.textbbox((0, 0), line, font=font, stroke_width=stroke) for line in lines]
    tw = max((bbox[2] - bbox[0] for bbox in bboxes), default=0)
    while tw > avail and fontsize > 18:
        fontsize -= 2
        font = load(fontsize)
        lines = wrap_text(text, font, avail, max_lines)
        line_gap = max(4, int(fontsize * 0.18))
        bboxes = [d.textbbox((0, 0), line, font=font, stroke_width=stroke) for line in lines]
        tw = max((bbox[2] - bbox[0] for bbox in bboxes), default=0)
    heights = [bbox[3] - bbox[1] for bbox in bboxes]
    th = sum(heights) + line_gap * max(0, len(lines) - 1)
    W = width
    H = th + pad * 2
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    dr = ImageDraw.Draw(img)
    y = pad
    for line, bbox, line_h in zip(lines, bboxes, heights):
        line_w = bbox[2] - bbox[0]
        x = (W - line_w) / 2 - bbox[0]
        dr.text((x, y - bbox[1]), line, font=font, fill=fill,
                stroke_width=stroke, stroke_fill=stroke_fill)
        y += line_h + line_gap
    img.save(out)
    return {"out": out, "w": W, "h": H, "fontsize": fontsize, "lines": len(lines)}


def main():
    if len(sys.argv) > 1:
        with open(sys.argv[1], "r", encoding="utf-8") as fh:
            cfg = json.load(fh)
    else:
        cfg = json.load(sys.stdin)
    font = cfg["font"]
    res = []
    for it in cfg["items"]:
        res.append(render_one(
            font, it["text"], it["out"],
            it.get("fontsize", 52), it.get("width", 1080),
            it.get("stroke", 6), it.get("pad", 12),
            color(it.get("fill"), (255, 255, 255, 255)),
            color(it.get("stroke_fill"), (0, 0, 0, 200)),
            int(it.get("max_lines", 0) or 0),
        ))
    print(json.dumps(res))


if __name__ == "__main__":
    main()
