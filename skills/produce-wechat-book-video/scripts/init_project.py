#!/usr/bin/env python3
"""Create a non-destructive dated work folder for one book-video job."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
from pathlib import Path


SUBDIRS = (
    "video_clips",
    "storyboard/images",
    "material",
    "voice",
    "render",
    "jianying_draft",
)


def safe_slug(value: str) -> str:
    value = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "-", value.strip())
    value = re.sub(r"\s+", "-", value).strip(" .-")
    return value or "book"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--book", required=True, help="Book title without brackets")
    parser.add_argument("--root", type=Path, help="Project root containing work/")
    parser.add_argument("--date", default=dt.date.today().isoformat())
    parser.add_argument("--index", type=int, default=1)
    parser.add_argument("--config", type=Path)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    skill_root = Path(__file__).resolve().parents[1]
    config_path = args.config or skill_root / "assets" / "default-config.json"
    config = json.loads(config_path.read_text(encoding="utf-8"))
    root_value = config.get("projectRoot") or config.get("project_root")
    if not root_value and not args.root:
        raise SystemExit("Config must define projectRoot")
    root = (args.root or Path(root_value)).resolve()
    job_name = f"{args.date}-{safe_slug(args.book)}-{args.index:02d}"
    job = root / "work" / job_name

    if job.exists():
        raise SystemExit(f"Refusing to overwrite existing job: {job}")

    manifest = {
        "book": args.book,
        "date": args.date,
        "job_name": job_name,
        "status": "initialized",
        "config_source": str(config_path.resolve()),
        "production": config,
    }

    print(f"job={job}")
    for subdir in SUBDIRS:
        print(f"mkdir={job / subdir}")
    if args.dry_run:
        return 0

    for subdir in SUBDIRS:
        (job / subdir).mkdir(parents=True, exist_ok=False)
    (job / "production-config.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
