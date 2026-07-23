#!/usr/bin/env python3
"""Run minimum delivery checks for the final MP4 and optional SRT."""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
from pathlib import Path


def run_text(command: list[str]) -> str:
    result = subprocess.run(
        command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
        encoding="utf-8", errors="replace", check=False
    )
    return result.stdout


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("video", type=Path)
    parser.add_argument("--srt", type=Path)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()

    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise SystemExit("ffmpeg is not available on PATH")
    if not args.video.is_file():
        raise SystemExit(f"Missing video: {args.video}")

    info = run_text([ffmpeg, "-hide_banner", "-i", str(args.video)])
    video_match = re.search(r"Video:.*?(\d{3,5})x(\d{3,5}).*?(\d+(?:\.\d+)?) fps", info)
    duration_match = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", info)
    audio_present = bool(re.search(r"Audio:", info))
    report: dict[str, object] = {"video": str(args.video.resolve()), "audio_present": audio_present}

    if video_match:
        width, height, fps = int(video_match[1]), int(video_match[2]), float(video_match[3])
        report.update(width=width, height=height, fps=fps)
    else:
        width = height = 0
        fps = 0.0
    if duration_match:
        report["duration_seconds"] = (
            int(duration_match[1]) * 3600 + int(duration_match[2]) * 60 + float(duration_match[3])
        )

    volume = run_text([
        ffmpeg, "-hide_banner", "-i", str(args.video), "-vn", "-af", "volumedetect",
        "-f", "null", "NUL"
    ])
    for key in ("mean_volume", "max_volume"):
        match = re.search(rf"{key}:\s*(-?\d+(?:\.\d+)?) dB", volume)
        if match:
            report[f"{key}_db"] = float(match[1])

    caption_errors: list[str] = []
    if args.srt:
        text = args.srt.read_text(encoding="utf-8-sig")
        for number, block in enumerate(re.split(r"\r?\n\s*\r?\n", text.strip()), 1):
            lines = block.splitlines()[2:]
            if len(lines) != 1:
                caption_errors.append(f"entry {number}: caption is not one line")
            if any(mark in "".join(lines) for mark in "，。"):
                caption_errors.append(f"entry {number}: contains forbidden Chinese punctuation")
    report["caption_errors"] = caption_errors
    report["passed"] = bool(width == 1080 and height == 1920 and abs(fps - 60) < 0.1 and audio_present and not caption_errors)

    output = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    print(output, end="")
    if args.report:
        if args.report.exists():
            raise SystemExit(f"Refusing to overwrite: {args.report}")
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(output, encoding="utf-8")
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
