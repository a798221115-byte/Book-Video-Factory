#!/usr/bin/env python3
"""Trim and shift SRT subtitles after replacing a spoken intro."""

from __future__ import annotations

import argparse
import re
from pathlib import Path


STAMP = re.compile(
    r"(?P<h>\d{2}):(?P<m>\d{2}):(?P<s>\d{2}),(?P<ms>\d{3})"
)


def to_ms(value: str) -> int:
    match = STAMP.fullmatch(value.strip())
    if not match:
        raise ValueError(f"Invalid SRT timestamp: {value}")
    parts = {key: int(val) for key, val in match.groupdict().items()}
    return (((parts["h"] * 60 + parts["m"]) * 60 + parts["s"]) * 1000) + parts["ms"]


def from_ms(value: int) -> str:
    value = max(0, value)
    hours, value = divmod(value, 3_600_000)
    minutes, value = divmod(value, 60_000)
    seconds, millis = divmod(value, 1000)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d},{millis:03d}"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--trim", type=float, default=0.0, help="Seconds removed from start")
    parser.add_argument("--offset", type=float, default=0.0, help="Seconds added after trimming")
    parser.add_argument("--remove-cn-punctuation", action="store_true")
    args = parser.parse_args()

    if args.output.exists():
        raise SystemExit(f"Refusing to overwrite: {args.output}")

    trim_ms = round(args.trim * 1000)
    offset_ms = round(args.offset * 1000)
    blocks = re.split(r"\r?\n\s*\r?\n", args.input.read_text(encoding="utf-8-sig").strip())
    result: list[str] = []

    for block in blocks:
        lines = block.splitlines()
        if len(lines) < 3 or " --> " not in lines[1]:
            continue
        start_raw, end_raw = lines[1].split(" --> ", 1)
        start, end = to_ms(start_raw), to_ms(end_raw)
        if end <= trim_ms:
            continue
        start = max(start, trim_ms) - trim_ms + offset_ms
        end = end - trim_ms + offset_ms
        caption = " ".join(line.strip() for line in lines[2:] if line.strip())
        if args.remove_cn_punctuation:
            caption = caption.translate(str.maketrans("", "", "，。"))
        result.append(f"{len(result) + 1}\n{from_ms(start)} --> {from_ms(end)}\n{caption}")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text("\n\n".join(result) + "\n", encoding="utf-8")
    print(f"wrote={args.output.resolve()} entries={len(result)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
