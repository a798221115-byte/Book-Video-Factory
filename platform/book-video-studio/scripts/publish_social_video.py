import argparse
import asyncio
import json
import re
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
        async def open_thumbnail_dialog(self, page, selectors, dialog_titles):
            for selector in selectors:
                cover_entry = page.locator(selector).first
                try:
                    if not await cover_entry.count():
                        continue
                    await cover_entry.wait_for(state="visible", timeout=3000)
                    await cover_entry.click()
                    await page.wait_for_timeout(500)
                    break
                except Exception:
                    continue

            for title in dialog_titles:
                cover_dialog = page.locator("div.weui-desktop-dialog:visible").filter(has_text=title).first
                if await cover_dialog.count():
                    return cover_dialog
            return None

        async def set_single_thumbnail(self, page, thumbnail_path, selectors, dialog_titles, label):
            cover_dialog = await self.open_thumbnail_dialog(page, selectors, dialog_titles)
            if cover_dialog is None:
                raise RuntimeError(f"未打开视频号{label}封面编辑弹窗，已阻止正式发布")
            await self.upload_thumbnail_in_dialog(page, cover_dialog, thumbnail_path)

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
            scopes = [page, *[frame for frame in page.frames if frame != page.main_frame]]
            declaration_scope = None
            declaration = None
            for scope in scopes:
                for entry_text in (
                    "选择视频标注",
                    "视频标注",
                    "内容声明",
                    "AI内容声明",
                    "AI生成内容标识",
                    "内容标记",
                ):
                    candidate = scope.get_by_text(entry_text, exact=True).first
                    if await candidate.count() and await candidate.is_visible():
                        declaration_scope = scope
                        declaration = candidate
                        break
                if declaration is not None:
                    break
            if declaration is None:
                diagnostic_path = video_file.parent.parent / "reports" / "publication-diagnostic-weixin.png"
                diagnostic_path.parent.mkdir(parents=True, exist_ok=True)
                await page.screenshot(path=str(diagnostic_path), full_page=True)
                visible_markers = []
                for scope in scopes:
                    try:
                        for body_text in await scope.locator("body").all_inner_texts():
                            visible_markers.extend(
                                line.strip()
                                for line in body_text.splitlines()
                                if any(marker in line for marker in ("AI", "声明", "原创", "标注", "标记"))
                            )
                    except Exception:
                        continue
                marker_summary = " | ".join(dict.fromkeys(visible_markers))[:800]
                raise RuntimeError(
                    "未找到视频号“内容声明”，已阻止正式发布；"
                    f"诊断截图: {diagnostic_path}；页面相关文字: {marker_summary or '无'}"
                )
            await declaration.click()
            await page.wait_for_timeout(300)
            option_scopes = [page, *[frame for frame in page.frames if frame != page.main_frame]]
            selected_text = ""
            ai_label_pattern = re.compile(r"含\s*AI\s*(?:產生|生成)\s*(?:內容|内容)", re.IGNORECASE)
            for scope in (declaration_scope, *option_scopes):
                option = scope.locator("div.mark-tag-option").filter(has_text=ai_label_pattern).first
                if await option.count() and await option.is_visible():
                    selected_text = (await option.inner_text()).strip()
                    await option.click()
                    declaration_scope = scope
                    break
            for scope in (declaration_scope, *option_scopes):
                if selected_text:
                    break
                option = scope.get_by_text(ai_label_pattern).last
                if await option.count() and await option.is_visible():
                    selected_text = (await option.inner_text()).strip()
                    await option.click()
                    declaration_scope = scope
                    break
            for option_text in (
                "含AI產生內容",
                "含AI生成内容",
                "含有AI生成内容",
                "内容含有AI生成",
                "内容由AI生成",
                "AI生成内容",
            ) if not selected_text else ():
                for scope in (declaration_scope, *option_scopes):
                    option = scope.get_by_text(option_text, exact=False).last
                    if await option.count() and await option.is_visible():
                        await option.click()
                        selected_text = option_text
                        declaration_scope = scope
                        break
                if selected_text:
                    break
            if not selected_text:
                diagnostic_path = video_file.parent.parent / "reports" / "publication-diagnostic-weixin.png"
                dom_path = video_file.parent.parent / "reports" / "publication-dom-weixin.json"
                diagnostic_path.parent.mkdir(parents=True, exist_ok=True)
                await page.screenshot(path=str(diagnostic_path), full_page=True)
                frame_diagnostics = []
                for scope in option_scopes:
                    try:
                        ai_elements = await scope.locator("div.mark-tag-options *, div.mark-tag-select *").evaluate_all(
                            """elements => elements
                                .map(element => ({
                                    tag: element.tagName,
                                    className: typeof element.className === 'string' ? element.className : '',
                                    text: (element.innerText || element.textContent || '').trim()
                                }))
                                .filter(item => item.text.includes('AI'))
                                .slice(-60)"""
                        )
                        frame_diagnostics.append({"url": getattr(scope, "url", "page"), "aiElements": ai_elements})
                    except Exception as exc:
                        frame_diagnostics.append({"url": getattr(scope, "url", "page"), "error": str(exc)})
                dom_path.write_text(json.dumps(frame_diagnostics, ensure_ascii=False, indent=2), encoding="utf-8")
                raise RuntimeError(
                    "未找到视频号“含有AI生成内容”选项，已阻止正式发布；"
                    f"诊断截图: {diagnostic_path}；页面结构: {dom_path}"
                )
            await page.wait_for_timeout(500)
            selected_control = declaration_scope.locator("div.mark-tag-select").first
            selected_display = (await selected_control.inner_text()).strip() if await selected_control.count() else ""
            selected_class = (await selected_control.get_attribute("class")) if await selected_control.count() else ""
            if (
                not re.search(ai_label_pattern, selected_display)
                or (selected_class and "is-open" in selected_class)
            ):
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
