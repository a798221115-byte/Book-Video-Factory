import argparse
import asyncio
import json
import sys
from pathlib import Path


SUPPORTED_PLATFORMS = ("douyin", "weixin_channels")


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--tool-root", required=True)
    parser.add_argument("--platform", required=True, choices=SUPPORTED_PLATFORMS)
    parser.add_argument("--account-file", required=True)
    parser.add_argument("--video", required=True)
    parser.add_argument("--cover")
    parser.add_argument("--title", required=True)
    parser.add_argument("--short-title", default="")
    parser.add_argument("--description", default="")
    parser.add_argument("--tags-json", default="[]")
    parser.add_argument("--headless", action="store_true")
    return parser.parse_args()


def require_file(value, label):
    path = Path(value).resolve()
    if not path.is_file():
        raise SystemExit(f"{label} not found: {path}")
    return path


async def publish(args, account_file, video_file, cover_file, tags):
    if args.platform == "douyin":
        from uploader.douyin_uploader.main import (  # noqa: E402
            DOUYIN_PUBLISH_STRATEGY_IMMEDIATE,
            DouYinVideo,
        )

        uploader = DouYinVideo(
            title=args.title,
            file_path=str(video_file),
            tags=tags,
            publish_date=0,
            account_file=str(account_file),
            desc=args.description,
            publish_strategy=DOUYIN_PUBLISH_STRATEGY_IMMEDIATE,
            headless=args.headless,
        )
        await uploader.douyin_upload_video()
        return

    from uploader.tencent_uploader.main import (  # noqa: E402
        TENCENT_PUBLISH_STRATEGY_IMMEDIATE,
        TencentVideo,
    )

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
        is_draft=False,
        headless=args.headless,
    )
    await uploader.tencent_upload_video()


def main():
    args = parse_args()
    tool_root = Path(args.tool_root).resolve()
    if not tool_root.joinpath("uploader").is_dir():
        raise SystemExit("social-auto-upload uploader package not found")
    account_file = require_file(args.account_file, "account cookie file")
    video_file = require_file(args.video, "video file")
    cover_file = require_file(args.cover, "cover file") if args.cover else None
    tags = [str(tag).strip().lstrip("#") for tag in json.loads(args.tags_json) if str(tag).strip()]
    sys.path.insert(0, str(tool_root))
    asyncio.run(publish(args, account_file, video_file, cover_file, tags))
    print(json.dumps({
        "ok": True,
        "mode": "published",
        "platform": args.platform,
        "accountFile": str(account_file),
        "video": str(video_file),
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
