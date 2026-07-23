# UI_HANDOFF.md — 采集/任务流 UI 改版交接

本文记录 2026-06-25 这一轮按参考截图做的产品化 UI 改动，方便后续接手时区分：哪些已经接到现有流水线，哪些目前只是前端状态，哪些还需要扩后端。

## 改动范围

### 首页：热点采集工作台

相关文件：
- `app/page.tsx`
- `components/NewTaskForm.tsx`
- `app/globals.css`

改动内容：
- 首页从 landing page 改成“热点采集到混剪成片”工作台。
- 新增 URL 导入面板：分享 URL、处理方式选择、按 URL 导入按钮。
- 新增采集结果区：批量操作、筛选栏、宽表格、任务状态、操作入口。
- 表格仍使用 `listTasks()` 的本地任务数据；筛选和排序在 `app/page.tsx` 里按 URL 查询参数做服务端过滤。

当前行为：
- “按 URL 导入”调用 `createTasksAction()`，支持从粘贴文本中提取多个 URL，单条创建后跳转 `/tasks/[id]`，多条创建后刷新列表。
- 处理方式 select 已接后端：
  - `pipeline`：创建后异步跑完整 pipeline。
  - `collect`：创建后异步跑 `extract`。
  - `draft`：创建后依次跑 `extract → transcribe → rewrite`。
  - `manual`：只创建记录。
- 筛选栏已接服务端 URL 查询参数，支持粉丝/评论/分享范围、发布时间范围、排序字段、排序方向。
- 表格勾选、复制勾选链接、复制当前页链接、单行删除、批量删除已接客户端逻辑和 API。
- “自动生成逐字稿”勾选框已用 localStorage 持久化，并会影响 `NewTaskForm` 创建任务时的启动模式。
- 备注已持久化到 `tasks.notes`，表格中可内联编辑、保存、取消，刷新后保留。
- “改写”跳 `/tasks/{id}#rewrite`，详情页已提供 `id="rewrite"` 锚点；“详情”跳普通详情页。

新增/相关 API：
- `DELETE /api/tasks/bulk`：批量删除任务记录、步骤、产物和 `data/tasks/<id>` 文件目录。
- `DELETE /api/tasks/[id]`：删除单个任务。
- `PATCH /api/tasks/[id]/config`：保存 task 级 UI/运行配置，当前用于 TTS 配置、改写要求、人工确认记录、场景图张数、render 风格/动效/声明。
- `GET /api/tasks/[id]/config?key=tts|images|review|rewrite|render`：读取指定配置。
- `PATCH /api/tasks/[id]`：保存任务备注 `notes`。

### 详情页：任务流页面

相关文件：
- `app/tasks/[id]/page.tsx`
- `components/TaskView.tsx`
- `app/globals.css`

改动内容：
- 详情页改成左侧流程导航 + 右侧任务流工作区。
- 顶部有任务摘要卡、横向步骤条、进度提示。
- 中段新增以下模块：
  - `AUDIO / 音频生成与时长预估`
  - `REWRITE / 口播文案改写`
  - `STEP 05 / 书籍信息`
  - `IMAGE GENERATION / AI 场景图生成`
  - `STEP 06 / 成片风格与数量`
  - 保留修复型清洗、后续产物展示、文本编辑、音视频播放。

当前行为：
- 详情页数据仍通过 `/api/tasks/[id]/status` + SSE `/stream` 拉取。
- 步骤运行仍通过 `/api/tasks/[id]/run`，调用现有 `run/rerun/pipeline`。
- 页面里大部分“运行当前步骤/重新生成”按钮已接现有 pipeline step。

## 新增 API

### 保存书籍信息

路径：
- `app/api/tasks/[id]/book/route.ts`

接口：
- `PATCH /api/tasks/:id/book`

请求体：
```json
{
  "bookTitle": "书名",
  "bookAuthor": "作者",
  "coverUrl": "封面 URL",
  "videoTitles": ["长标题候选"],
  "shortTitles": ["短标题候选"]
}
```

行为：
- 更新 `tasks.bookTitle` / `tasks.bookAuthor`。
- 更新或创建 `rewrite` 步骤下 `kind=json` 的“书籍信息” artifact。
- `coverUrl`、标题候选、保存时间等存入 artifact `meta`。

注意：
- 当前没有新增 DB 字段存 `coverUrl`，它存在 artifact meta 里。
- “AI 识别书籍信息”按钮目前触发 `rerun rewrite`，复用现有书名识别逻辑。

### 单张场景图重生成

路径：
- `app/api/tasks/[id]/images/[artifactId]/regenerate/route.ts`

接口：
- `POST /api/tasks/:id/images/:artifactId/regenerate`

行为：
- 校验 artifact 属于当前 task 且是 `images` 步骤的 `kind=image`。
- 读取 artifact meta 中的 `brief` 和 `idx`。
- 调用现有 `getImage()` provider，覆盖生成到原图片 path。
- 更新 artifact meta：`provider`、`regeneratedAt`。

注意：
- 如果配置了真实 `IMAGE_API_KEY`，单图重生成会产生实际生图调用成本。
- 若未配置真实生图 provider，会走 MockImageProvider。

### 轻量去重微调（附件C，旁路工具）

路径：
- `app/api/tasks/[id]/dedup/route.ts`

接口：
- `POST /api/tasks/:id/dedup`（无请求体）
- `POST /api/tasks/:id/dedup/adopt`：采用最新去重稿为主口播稿

行为：
- 读取 `transcribe` 的 `cleaned` 正文作为去重基准（缺失则 400）。
- 从 `rewrite` 的 `kind=json` 书名识别 artifact 自动提取 `protected_terms`（书名、作者），无需用户手填。
- 用 `getBookLLM()`（DeepSeek）+ `PROMPT_C_DEDUP` 做克制微调，temperature 0.8。
- 计算与原稿的字数差异%，覆盖式保存为独立 artifact（`stepName=dedup`, `kind=text`），meta 含 protected_terms/base_len/dedup_len/diff_pct。
- 返回 `{ok, content, protectedTerms, baseLen, dedupLen, diffPct}`。
- 采用去重稿会覆盖 `rewrite/kind=rewrite` 的主口播稿和任务目录 `script.txt`，并将 `tts`、`images`、`subtitle`、`render` 置为 pending，要求声音、图片、字幕和成片跟随新文案重新生成。

注意：
- 选用 DeepSeek 而非 gpt-5.5：实测 DeepSeek 中文口语同义替换更地道、语义更安全（gpt 出现“弄清→弄轻”错误，DeepSeek 为“弄清→摸透”）。
- 这是旁路工具，**不进主流水线 STAGES**，不影响 render 用的 rewrite 稿；产物仅供二次发布时复制使用。
- 去重质量每次有随机波动（相似度 86%~97%），符合附件C“成功率不到 100%、需人工把关”的定位。

### repo 辅助函数

相关文件：
- `lib/pipeline/repo.ts`

新增：
- `patchArtifact(id, patch)`
- `deleteTask(id)`

用途：
- 更新 artifact 的 `label/path/content/meta`。
- 目前被书籍保存和单图重生成 API 使用。
- 删除任务时先确认任务存在，再删除 artifacts/steps/tasks，并只清理解析后的 `data/tasks/<id>` 子目录。

### 采集元数据扩展

相关文件：
- `lib/providers/douyin.ts`

新增字段：
- `stats.followers`
- `stats.duration`
- `stats.publishedAt`

用途：
- 首页粉丝、时长、发布时间展示和筛选排序使用这些字段；没有真实字段时 Mock provider 也会返回示例值。

## 新增详情页模块说明

### 音频生成与时长预估

位置：
- `components/TaskView.tsx` 中 `AudioWorkspace`

数据来源：
- 优先用 `tts` artifact 的 `meta.segments` 和 `meta.totalDur`。
- 如果还没有 TTS artifact，会从候选稿/清洗稿按句拆分做前端估算。

已接能力：
- 生成/重新生成音频按钮调用 `tts` step。
- 如果已有音频 artifact，会显示真实 `<audio>` 播放器。
- 音色与语速 select 已通过 `PATCH /api/tasks/[id]/config` 持久化为 `key=tts`。
- `lib/steps/tts.ts` 会读取 `key=tts` 配置，把 `voice` 传给 TTS provider，并把 `voice/speed` 写入音频 artifact meta。

限制：
- `speed` 当前只用于配置记录和 UI 展示；现有 TTS provider 接口还没有真实变速参数。
- 若要支持真实语速，需要扩展 `TtsProvider.synthesize()` opts，并分别适配 index-tts2/Replicate/say。

### 逐字稿人工确认

位置：
- `TaskView` 的“确认清洗结果”按钮

已接能力：
- 点击后先通过 `PATCH /api/tasks/[id]/config` 写入 `key=review`，记录 `cleanedConfirmedAt`。
- 然后继续触发 `rewrite` step。

限制：
- 目前只记录确认时间，没有记录确认人、修改 diff 或审核意见。

### 口播文案改写

位置：
- `RewriteWorkspace`

数据来源：
- `config.rewrite` 的 `notes` / `rewriteNotes`

已接能力：
- 补充要求输入框已接 `PATCH /api/tasks/[id]/config`。
- “重新生成候选稿”会先保存改写要求，再触发 `rerun rewrite`。
- `lib/steps/rewrite.ts` 会读取 `config.rewrite.value.notes`，写入 `PROMPT_B_REWRITE.user()` 的 `rewrite_notes`。

限制：
- 目前只做任务级持久化，不区分一次性临时备注和长期模板。

### 书籍信息

位置：
- `BookIdentityWorkspace`

数据来源：
- `task.bookTitle` / `task.bookAuthor`
- `rewrite` 下 `kind=json` artifact meta

已接能力：
- 保存书名/作者/封面 URL 到 `/api/tasks/[id]/book`。
- “AI 识别书籍信息”会先保存当前 `config.rewrite`，再触发 `rerun rewrite`。
- 标题候选目前是前端基于书名/文案生成的 deterministic 文案，点击可复制。

待扩展：
- 如果要由 LLM 生成视频号标题，应新增专门 provider/API，不要塞进 `rewrite` step。
- 封面图目前只存 URL，未做上传、裁剪、预览或图片落盘。

### AI 场景图生成

位置：
- `ImageGenerationWorkspace`

数据来源：
- `images` step 的 image artifacts。
- artifact meta 中的 `idx`、`brief`、`regeneratedAt`。

已接能力：
- 批量“重新生成 N 张场景图”调用 `rerun images`。
- 单张“重生成此图”调用新增 regenerate API。
- 候选张数 select 会保存到 `PATCH /api/tasks/[id]/config` 的 `key=images`。
- `lib/steps/images.ts` 会读取 `key=images.value.targetCount`，将文案段落扩展/裁剪到目标张数后，再按 9 张一组生成九宫格并裁切。

重要限制：
- 为了凑满目标张数，当前实现会循环复用已有文案段落；后续可改成让 LLM 先扩展 brief，避免重复。

### 成片风格与数量

位置：
- `VideoStylesWorkspace`

当前 UI：
- 风格数量步进器：
  - 清醒语录
  - 黑底打字机
  - 暗色知识卡片
  - 图书口播卡片
- 动效预设多选：
  - 电影感
  - 动感快剪
  - 静帧放大
  - 胶片复古
- 声明模板 select + 文本编辑 + 占位符预览：
  - `{author}`
  - `{title}`

已接能力：
- “保存声明”会通过 `PATCH /api/tasks/[id]/config` 写入 `key=render`，同时保存风格数量、动效选择和声明模板。
- “生成 N 条视频”会先保存 `key=render`，再调用现有 `render` step。
- `lib/steps/render.ts` 会读取 `config.render.value`，按 style × motion × 数量展开 `RenderVariant`。
- 配置存在时会输出多条 `final_<style>_<motion>_<index>.mp4`，每条保存一个 `render` video artifact。
- 没有 `render` 配置时仍兼容旧行为，输出单条 `final.mp4`。
- 前端单次最多允许 6 条，避免误触发长时间批量渲染；后端也固定最多 6 条，API 直调不会突破这个上限。
- `styleCounts/motionPresets` 和历史字段 `styles/motions` 均兼容读取/写入。

重要限制：
- `auto` 是默认成片策略：短视频走 HyperFrames，HTML 模板会接收 `style/motion/statement` 并映射到样式和 GSAP 时间轴动效。
- 长视频或 HyperFrames 失败时回退 ffmpeg/Pillow；`RENDER_ENGINE=ffmpeg` 则直接走字幕颜色、标题、声明层、轻量背景运动/滤镜/颗粒差异。
- motion preset 目前是轻量背景运动和视觉质感差异，不是完整转场/时间轴动效系统。

建议后续实现方式：
1. 如果配置项继续增多，可新增 `task_configs` 表替代当前 config artifact 存储。
2. 现有 `RenderVariant` 结构：
   ```ts
   type RenderVariant = {
     style: "clean" | "black" | "card" | "book";
     motion: "cinematic" | "quick" | "calm" | "collage";
     statement: string;
     index: number;
   };
   ```
3. 若要更强动效，可继续扩展 `lib/hyperframes/template/index.html`，把 motion preset 映射到更多真实转场、Ken Burns 参数或分层时间轴。

## 当前技术债与注意事项

- `components/TaskView.tsx` 已拆分，主文件保留任务状态加载和流程编排：
  - `components/task-view/AudioWorkspace.tsx` — 音频生成与时长预估
  - `components/task-view/BookIdentityWorkspace.tsx` — 书籍信息
  - `components/task-view/ImageGenerationWorkspace.tsx` — AI 场景图生成
  - `components/task-view/VideoStylesWorkspace.tsx` — 成片风格与数量
  - `components/task-view/OutputPanel.tsx` — 文本/音频/视频产物展示
  - `components/task-view/shared.tsx` — 阶段常量、格式化和文件 URL helper
  - `VideoStylesWorkspace` — 成片风格与数量
  - `TextPanel` / `OutputPanel` / `ArtifactItem` — 通用展示组件
- `components/CollectorTable.tsx` 已从首页拆出，作为独立客户端组件。
- `app/globals.css` 也明显变大（超 1400 行），后续可按页面拆 CSS module 或组件 class 分段维护。
- 书籍标题候选是前端本地生成（`buildVideoTitles`/`buildShortTitles`），质量有限，可考虑 LLM 生成。
- 场景图候选张数已通过 `config.images.value.targetCount` 持久化，并被 `runImages()` 读取；但 brief 扩展仍是循环复用原文案段落，质量有限。
- 成片风格数量、动效、声明模板已持久化为 `config.render`，并驱动 `runRender()` 批量输出；但 motion 仍是轻量滤镜，不是完整动效系统。
- `npm rebuild better-sqlite3` 曾用于修复当前 Node 与原生模块 ABI 不匹配；如果换 Node 版本后首页 500，优先重建该依赖。

## 验证记录

已执行：
```bash
./node_modules/.bin/tsc --noEmit
```

已用 Chrome headless 截图检查：
- 首页工作台
- 详情页桌面/移动端
- 音频工作区
- 书籍信息/场景图工作区
- 成片风格与数量工作区

开发服务曾运行在：
```bash
PORT=3001 npm run dev
```
