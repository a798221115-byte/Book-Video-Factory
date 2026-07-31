# Changelog

## 3.6.0 - 2026-08-01

- Add an explicitly authorized multi-platform publication action for Douyin and WeChat Channels while retaining the legacy WeChat Channels draft workflow.
- Add account discovery, platform-specific metadata/cover handling, per-target idempotency, partial-failure retry state, and durable publication records around the pinned `dreammis/social-auto-upload` adapter.
- Upgrade `produce-wechat-book-video` to 3.8.0 and keep publication outside the two production confirmations.

## 3.5.0 - 2026-07-30

- Add the `produce-script-video` Skill for the standalone `用成稿直出` control phrase at either end of a final narration script.
- Preserve the supplied narration without derivative rewriting while automatically running storyboard images, locked narration, captions, editing, validation, and delivery.
- Keep routine copy and image gates disabled in direct-production mode while preserving explicit compliance, dependency, media-quality, publication, and archival boundaries.

## 3.4.0 - 2026-07-30

- Upgrade `produce-wechat-book-video` publication topics into 10 selectable `T01–T10` topic sets alongside the existing long and short title choices.
- Require complete 10+10+10 feedback, automatic `T01` adoption, topic recommendation reasons, resolved book-title hashtags, and topic regeneration when the adopted long title changes.

## 3.2.1 - 2026-07-28

- 将图书视频默认中文字幕渲染字号从 58 调整为 68。

## 3.2.0 - 2026-07-28

- Move the deterministic `读书分享` / book-title / author header group down by 10% of the 1080×1920 canvas, preserve its internal spacing, and read the positions from the shared skill configuration.

## 3.1.1 - 2026-07-28

- Default locked narration to a gentle, reflective 0.92× delivery with longer title, ordinary, and final pauses; regenerate all timing-dependent artifacts from the measured slowed narration.
- Keep the fixed opening three seconds clean by default: do not overlay AI notices, subtitles, or other newly generated text. The publisher still selects the current platform's AI disclosure at upload time.

## 3.1.0 - 2026-07-28

- Send the complete `titles.json` plus all 10 long and all 10 short candidates in the current conversation immediately after automatic selection.
- Number candidates `L01–L10` and `S01–S10`, mark the adopted pair, and accept direct reselection by number without adding a normal-path confirmation gate.
- Regenerate and resend the complete short-title set whenever the selected long title changes.

## 3.0.0 - 2026-07-27

- Remove Jianying draft generation from the default production path, technical validation, delivery registration, and workbench UI.
- Deliver the MP4, standalone cover, title document, and validation reports after the second confirmation; retain explicit WeChat Channels platform-draft upload as a separate action.
- Stop creating new `jianying_draft/` directories while preserving all historical files.

## 2.0.5 - 2026-07-27

- Use the identified or confirmed book title as the workbench project title and persistent Codex task title.
- Keep the original source-video title unchanged as evidence, and keep corrected book titles synchronized with the dated project directory.

## 2.0.0 - 2026-07-26

- Replace the legacy multi-gate happy path with two human confirmations: derivative copy and all storyboard images.
- Automatically lock the G01 evidence package, generate and adopt long/short titles, validate and adopt the style sample, and continue through remaining-image generation.
- Automatically start post-production after image confirmation and register delivery artifacts after C02 passes; formal publication remains separately authorized.
- Preserve candidate choices, artifacts, audit history, compatibility states, and explicit rollback actions.

## 1.15.0 - 2026-07-26

- Generate the separate 1080×1260 WeChat Channels cover automatically after G05 rendering, using the verified WeRead edition cover and deterministic local composition.
- Add direct G06 controls to generate or regenerate the cover, edit its two headline lines, inspect generation failures, and open the cover validation report.
- Prefer the verified WeRead `t9_` high-resolution cover asset with a safe fallback to the original returned URL.
- Add a G06 artifact refresh action that reports the exact remaining video, cover, Jianying, or validation deliverables instead of leaving the review gate silently locked.

## 1.12.0 - 2026-07-25

- Add explicit G02.1 long-title and G02.2 short-title task states between copy approval and G03.
- Automatically generate exactly 10 traceable long-title candidates after G02 approval, then require one long-title selection before generating exactly 10 short titles.
- Keep the complete title workflow visible as a read-only audit record after G03 begins, and block all image work until both title selections are confirmed.
- Persist DBS formula and psychological-trigger coverage in `titles.json`.

## 1.11.1 - 2026-07-25

- Store Jianying native drafts under `F:\JianyingPro` while keeping the original application path compatible through a directory junction.

## 1.11.0 - 2026-07-25

- Add a complete G06 joint-review workspace for the 60fps review MP4, editable Jianying draft report, standalone WeChat Channels cover, and technical validation report.
- Render confirmed storyboard images with deterministic non-repeating 60fps motion, exact frame padding, and real voice-duration alignment.
- Make the locked female narration start with the exact book title and remove duplicate share-intro phrases.
- Recover from stale voice workers, support subtitle/render-only retries, and preserve the current gate during late book-metadata corrections.
- Retry supported DeepSeek gateway models automatically and repair mismatched bilingual subtitle batches one card at a time.

## 1.10.1 - 2026-07-24

- 更新 `produce-wechat-book-video` Skill 至 1.1.3。
- 固定文字组默认相对旧版顶部布局下移约画面高度 15%，并把约 18%–30% 高度设为低干扰文字带。

## 1.10.0 - 2026-07-24

- Add the G05 post-production workspace with female narration, subtitle, render progress, review-video link, and stale-job retry recovery after worker restarts.

## 1.9.0 - 2026-07-24

- Add a safe G03 style-sample replacement flow that preserves previous G04 assets and regenerates versioned storyboard images.

## 1.6.0 - 2026-07-24

- 扩展原书文件上传来源，支持 EPUB、PDF、TXT、Markdown、HTML、DOCX 和 RTF。
- PDF 使用本地解析器提取文本，TXT/Markdown/HTML/DOCX/RTF 使用本地解析后统一交给 DeepSeek 做相关性筛选。
- 上传文件保留原始扩展名，单文件上限调整为 150MB，并在 G01 工作台中明确展示支持格式。

## 1.5.0 - 2026-07-24

- 工作台在短标题确认后自动创建可在 Codex 桌面端侧边栏看到的 G03 风格样图任务。
- 持续回传 Codex 任务 ID、执行阶段、进度、最新消息和失败原因，并提供打开任务与重试入口。
- G03 确认后自动创建可见的 G04 剩余分镜任务，逐张登记已完成图片并保留断点进度。

## 1.2.0 - 2026-07-24

- 新增四种逐镜头独立图片动效：单向缩小、单向放大、从左向右平移、从右向左平移。
- 动效采用可复现随机分配，并排除相邻镜头重复。
- 固化 8 秒慢速参考、单调缓动、60fps 与 2 倍画布降采样，减少缩放和平移抖动。

## 1.1.3 - 2026-07-24

- 修复 LaunchAgent 环境下转写、ASR 音频转换和 TTS 拼接无法找到 FFmpeg 的问题。
- 统一通过 `FFMPEG_BIN` 调用 FFmpeg，支持 Mac 中央后台使用绝对路径。

## 1.1.2 - 2026-07-23

- 删除固定 7–8 张图片及一分钟固定视觉段落数量的规则。
- 分镜图片总数改为由文案的观点、动作、场景、情绪和叙事功能变化自然决定。
- “约 8 秒一张”仅作为语义切分后的节奏软参考，不再作为数量公式。

## 1.1.1 - 2026-07-23

- 增加 Mac 中央后台部署说明、持久化数据目录和 Windows GPU/TTS Worker 配置模板。
- 修复 Next.js 多进程构建期间 SQLite 初始化竞争导致的 `SQLITE_BUSY`。
- 增加 SQLite 一致性在线备份脚本。

## 1.1.0 - 2026-07-23

- 新增长标题、短标题两级确认门：基于 TikHub 抖音原标题和 `dbs-xhs-title` 生成 10 个可追溯长标题，确认后再生成 10 个短标题。
- 工作台新增公式编号、触发类型、模板、原始爆款例子和推荐理由展示，并把完整选择记录保存为 `titles.json`。
- 工作台界面、G03 样图登记和场景图服务端执行器同时校验标题完成状态。
- 更新 `produce-wechat-book-video` Skill、Agent 元数据、默认配置、项目规范和飞书流程模板。

## 1.0.0 - 2026-07-23

- 首次发布 Book Video Studio 工作平台稳定源码。
- 首次发布 `produce-wechat-book-video` 完整 skill。
- 固化 TikHub、Whisper、DBS、微信读书、分镜、默认女声后期、剪映草稿、封面与飞书确认门流程。
- 建立语义化版本和“每次改动、每次验证、每次提交推送”的同步规则。
