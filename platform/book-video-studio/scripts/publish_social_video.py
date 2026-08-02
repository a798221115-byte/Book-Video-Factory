import argparse
import asyncio
import json
import sys
import threading
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
    parser.add_argument("--original-category", default="个人原创")
    parser.add_argument("--headless", action="store_true")
    return parser.parse_args()


def require_file(value, label):
    path = Path(value).resolve()
    if not path.is_file():
        raise SystemExit(f"{label} not found: {path}")
    return path


def run_async_in_proactor_thread(coro_factory):
    result = []
    errors = []

    def worker():
        loop = None
        try:
            asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
            loop = asyncio.ProactorEventLoop()
            asyncio.set_event_loop(loop)
            result.append(loop.run_until_complete(coro_factory()))
        except BaseException as exc:
            errors.append(exc)
        finally:
            if loop is not None:
                loop.close()

    thread = threading.Thread(target=worker, name="social-auto-upload-proactor")
    thread.start()
    thread.join()
    if errors:
        raise errors[0]
    return result[0] if result else None


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
        return None

    from uploader.tencent_uploader.main import (  # noqa: E402
        TENCENT_PUBLISH_STRATEGY_IMMEDIATE,
        TencentVideo,
    )

    class StrictAiTencentVideo(TencentVideo):
        async def apply_original_statement(self, page):
            await super().apply_original_statement(page)
            if not await self._original_is_confirmed(page):
                raise RuntimeError("未确认视频号原创声明，已阻止正式发布")
            await self._select_ai_generated_declaration(page)
            evidence_path = video_file.parent.parent / "reports" / "publication-preflight-weixin.png"
            evidence_path.parent.mkdir(parents=True, exist_ok=True)
            await page.screenshot(path=str(evidence_path), full_page=True)
            self.publication_evidence_path = str(evidence_path)

        async def _original_is_confirmed(self, page):
            label = page.get_by_label("视频为原创").first
            if await label.count():
                try:
                    if await label.is_checked():
                        return True
                except Exception:
                    pass
            for selector in (
                "div.declare-original-checkbox input.ant-checkbox-input:checked",
                'input[type="checkbox"]:checked',
            ):
                checked = page.locator(selector)
                if await checked.count():
                    for index in range(await checked.count()):
                        item = checked.nth(index)
                        try:
                            parent_text = await item.locator("xpath=ancestor::*[contains(., '原创')][1]").inner_text()
                            if "原创" in parent_text:
                                return True
                        except Exception:
                            continue
            for text in ("已声明原创", "原创声明已开启", "已开启原创"):
                if await page.get_by_text(text, exact=False).count():
                    return True
            return False

        async def _select_ai_generated_declaration(self, page):
            declaration = page.get_by_text("内容声明", exact=True).first
            if not await declaration.count() or not await declaration.is_visible():
                raise RuntimeError("未找到视频号“内容声明”，已阻止正式发布")
            await declaration.click()
            selected_text = ""
            for option_text in (
                "含有AI生成内容",
                "内容含有AI生成",
                "内容由AI生成",
                "AI生成内容",
            ):
                option = page.get_by_text(option_text, exact=True).last
                if await option.count() and await option.is_visible():
                    await option.click()
                    selected_text = option_text
                    break
            if not selected_text:
                raise RuntimeError("未找到视频号“含有AI生成内容”选项，已阻止正式发布")
            await page.wait_for_timeout(500)
            body_text = await page.locator("body").inner_text()
            if selected_text not in body_text:
                raise RuntimeError("无法验证视频号AI生成声明已选中，已阻止正式发布")

    uploader = StrictAiTencentVideo(
        title=args.title,
        file_path=str(video_file),
        tags=tags,
        publish_strategy=TENCENT_PUBLISH_STRATEGY_IMMEDIATE,
        publish_date=0,
        account_file=str(account_file),
        desc=args.description,
        thumbnail_path=str(cover_file) if cover_file else None,
        short_title=args.short_title,
        category=args.original_category,
        is_draft=False,
        headless=args.headless,
    )
    await uploader.tencent_upload_video()
    return getattr(uploader, "publication_evidence_path", None)


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
    evidence_path = run_async_in_proactor_thread(
        lambda: publish(args, account_file, video_file, cover_file, tags)
    )
    print(json.dumps({
        "ok": True,
        "mode": "published",
        "platform": args.platform,
        "accountFile": str(account_file),
        "video": str(video_file),
        "publicationEvidence": evidence_path,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
