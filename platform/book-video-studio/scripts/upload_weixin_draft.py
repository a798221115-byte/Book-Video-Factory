import argparse
import asyncio
import json
import sys
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--tool-root", required=True)
    parser.add_argument("--account-file", required=True)
    parser.add_argument("--video", required=True)
    parser.add_argument("--cover")
    parser.add_argument("--title", required=True)
    parser.add_argument("--short-title", default="")
    parser.add_argument("--description", default="")
    parser.add_argument("--tags-json", default="[]")
    parser.add_argument("--headless", action="store_true")
    args = parser.parse_args()

    tool_root = Path(args.tool_root).resolve()
    account_file = Path(args.account_file).resolve()
    video_file = Path(args.video).resolve()
    cover_file = Path(args.cover).resolve() if args.cover else None
    if not tool_root.joinpath("uploader", "tencent_uploader", "main.py").exists():
        raise SystemExit("social-auto-upload tencent_uploader not found")
    if not account_file.exists():
        raise SystemExit("Weixin Channels account cookie file not found")
    if not video_file.exists():
        raise SystemExit("video file not found")
    if cover_file and not cover_file.exists():
        raise SystemExit("cover file not found")

    sys.path.insert(0, str(tool_root))
    from uploader.tencent_uploader.main import (  # noqa: E402
        TencentVideo,
        TENCENT_PUBLISH_STRATEGY_IMMEDIATE,
    )

    tags = json.loads(args.tags_json)
    uploader = TencentVideo(
        title=args.title,
        file_path=str(video_file),
        tags=tags,
        publish_strategy=TENCENT_PUBLISH_STRATEGY_IMMEDIATE,
        publish_date=0,
        account_file=str(account_file),
        desc=args.description,
        thumbnail_path=str(cover_file) if cover_file else None,
        short_title=args.short_title,
        category=None,
        is_draft=True,
        headless=args.headless,
    )
    asyncio.run(uploader.tencent_upload_video())
    print(json.dumps({
        "ok": True,
        "mode": "draft_only",
        "accountFile": str(account_file),
        "video": str(video_file),
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
