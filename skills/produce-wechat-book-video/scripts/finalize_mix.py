#!/usr/bin/env python3
"""Prepend the fixed intro and build the locked narration/BGM final mix."""

from __future__ import annotations

import argparse
import re
import shutil
import subprocess
from pathlib import Path


def duration(ffmpeg: str, path: Path) -> float:
    run = subprocess.run(
        [ffmpeg, "-hide_banner", "-i", str(path)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    match = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", run.stderr)
    if not match:
        raise RuntimeError(f"Could not read duration: {path}")
    return int(match[1]) * 3600 + int(match[2]) * 60 + float(match[3])


def quote_command(command: list[str]) -> str:
    return subprocess.list2cmdline(command)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--body-video", type=Path, required=True)
    parser.add_argument("--intro", type=Path, required=True)
    parser.add_argument("--voice", type=Path, required=True)
    parser.add_argument("--music", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--voice-trim", type=float, default=0.0)
    parser.add_argument(
        "--body-trim",
        type=float,
        default=0.0,
        help="Seconds removed from the start of a body source that already contains an intro",
    )
    parser.add_argument("--music-gain", type=float, default=0.63)
    parser.add_argument("--fade", type=float, default=1.0)
    parser.add_argument(
        "--voice-profile",
        choices=("locked-default", "female-locked-v1", "legacy-v1", "reference-clear", "new-reference-natural"),
        default="locked-default",
    )
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    for path in (args.body_video, args.intro, args.voice, args.music):
        if not path.is_file():
            raise SystemExit(f"Missing input: {path}")
    if args.out.exists():
        raise SystemExit(f"Refusing to overwrite: {args.out}")

    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise SystemExit("ffmpeg is not available on PATH")

    intro_len = duration(ffmpeg, args.intro)
    body_source_len = duration(ffmpeg, args.body_video)
    body_len = body_source_len - args.body_trim
    if body_len <= 0:
        raise SystemExit("body-trim removes the entire body video")
    total_len = intro_len + body_len
    fade_start = max(0.0, total_len - args.fade)

    if args.voice_profile == "female-locked-v1":
        voice_processing = (
            "highpass=f=75,equalizer=f=3200:t=q:w=1.1:g=1.5,"
            "acompressor=threshold=0.12:ratio=1.4:attack=12:release=140:makeup=1.02,"
            "loudnorm=I=-15.1:LRA=8:TP=-1.0,"
            "volume=1.45,alimiter=limit=0.91:level=false"
        )
    elif args.voice_profile == "new-reference-natural":
        voice_processing = (
            "volume=0.85,highpass=f=75,"
            "equalizer=f=220:t=q:w=0.9:g=-1.5,"
            "equalizer=f=420:t=q:w=1.1:g=-0.8,"
            "equalizer=f=3000:t=q:w=1.0:g=1.0,"
            "equalizer=f=7200:t=q:w=1.5:g=-0.5,"
            "acompressor=threshold=0.10:ratio=1.8:attack=10:release=120:makeup=1.05,"
            "loudnorm=I=-16:TP=-1.5:LRA=8,volume=1.15"
        )
    elif args.voice_profile == "reference-clear":
        voice_processing = (
            "volume=0.75,highpass=f=85,"
            "equalizer=f=240:t=q:w=0.9:g=-2.5,"
            "equalizer=f=430:t=q:w=1.1:g=-1.0,"
            "equalizer=f=3200:t=q:w=1.0:g=5.0,"
            "equalizer=f=7200:t=q:w=1.5:g=-1.0,"
            "acompressor=threshold=0.09:ratio=2.4:attack=5:release=95:makeup=1.18,"
            "loudnorm=I=-16:TP=-1.5:LRA=6,volume=1.35"
        )
    elif args.voice_profile == "legacy-v1":
        voice_processing = (
            "highpass=f=95,equalizer=f=260:t=q:w=0.9:g=-5,"
            "equalizer=f=480:t=q:w=1.1:g=-1.2,"
            "equalizer=f=2800:t=q:w=1.0:g=4,"
            "equalizer=f=7200:t=q:w=1.5:g=-2,"
            "acompressor=threshold=0.11:ratio=2.1:attack=6:release=115:makeup=1.36,"
            "volume=1.50"
        )
    else:
        voice_processing = (
            "volume=0.60,highpass=f=70,lowpass=f=13500,"
            "acompressor=threshold=0.10:ratio=1.6:attack=12:release=140:makeup=1.20,"
            "loudnorm=I=-12.5:LRA=2:TP=-1.0,"
            "volume=1.14,alimiter=limit=0.86:level=false"
        )

    final_mix_limiter = 0.70 if args.voice_profile == "female-locked-v1" else 0.90
    final_mix_gain = 0.65 if args.voice_profile == "female-locked-v1" else 1.00

    filters = (
        "[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,"
        "fps=60,setsar=1,setpts=PTS-STARTPTS[iv];"
        "[1:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,"
        f"fps=60,setsar=1,trim=start={args.body_trim:.3f},setpts=PTS-STARTPTS[bv];"
        "[iv][bv]concat=n=2:v=1:a=0[v];"
        f"[0:a]atrim=0:{intro_len:.3f},asetpts=PTS-STARTPTS,"
        f"apad,atrim=0:{total_len:.3f}[ia];"
        f"[2:a]atrim=start={args.voice_trim:.3f},asetpts=PTS-STARTPTS,"
        f"{voice_processing},adelay={int(round(intro_len * 1000))}:all=1[va];"
        "[ia][va]amix=inputs=2:duration=longest:normalize=0,"
        "asplit=2[dialogue_mix][sidechain];"
        f"[3:a]atrim=0:{total_len:.3f},asetpts=PTS-STARTPTS,volume={args.music_gain:.3f},"
        f"afade=t=out:st={fade_start:.3f}:d={args.fade:.3f}[music];"
        "[music][sidechain]sidechaincompress=threshold=0.018:ratio=4:attack=10:release=220[ducked];"
        "[dialogue_mix][ducked]amix=inputs=2:duration=longest:normalize=0,"
        f"alimiter=limit={final_mix_limiter:.2f}:level=false,volume={final_mix_gain:.2f}[a]"
    )

    command = [
        ffmpeg, "-hide_banner", "-y", "-i", str(args.intro), "-i", str(args.body_video),
        "-i", str(args.voice), "-stream_loop", "-1", "-i", str(args.music),
        "-filter_complex", filters, "-map", "[v]", "-map", "[a]",
        "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
        "-r", "60", "-c:a", "aac", "-b:a", "256k", "-ar", "48000",
        "-t", f"{total_len:.3f}", "-movflags", "+faststart", str(args.out),
    ]
    print(f"intro={intro_len:.3f}s body={body_len:.3f}s total={total_len:.3f}s")
    if args.dry_run:
        print(quote_command(command))
        return 0

    args.out.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(command, check=True)
    print(f"wrote={args.out.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
