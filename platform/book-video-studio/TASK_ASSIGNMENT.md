# Book Video Studio 任务完成与验证记录

## 项目定位
AI 图书带货视频工作台：粘贴抖音链接 -> 自动产出竖版口播成片（9:16 mp4 + 字幕）。

## 当前状态
- 核心 6 步流水线已跑通：`extract -> transcribe -> rewrite -> tts -> subtitle -> render`。
- TTS 已接通 Windows GPU：index-tts2，`http://192.168.5.244:7860`。
- ASR 走腾讯云兜底链，质量和标点更稳定。
- 开发服务器验证地址：`http://localhost:3000`。
- 本轮 7 个 UI/渲染补全任务均已落地；`./node_modules/.bin/tsc --noEmit` 已通过。

---

## 完成摘要

| 任务 | 状态 | 主要文件 | 验收结果 |
|------|------|----------|----------|
| 1. 预览音频按钮接线 | 已完成 | `components/TaskView.tsx` | 详情页有真实 `<audio controls>`，按钮会定位并尝试播放 |
| 2. 保存声明按钮接线 | 已完成 | `components/TaskView.tsx`, `app/api/tasks/[id]/config/route.ts` | `render` config 可保存/读取，刷新后声明回填 |
| 3. 多风格成片渲染 | 已完成 | `components/TaskView.tsx`, `lib/steps/render.ts` | 前端保存配置，后端按 style x motion x count 输出多条 video artifact |
| 4. 动效预设生效 | 已完成 | `components/TaskView.tsx`, `lib/steps/render.ts` | motion 写入 config 并影响 ffmpeg 背景运动/色调/颗粒滤镜 |
| 5. 首页表格按钮优化 | 已完成 | `components/CollectorTable.tsx`, `components/TaskView.tsx`, `lib/db/*`, `lib/pipeline/repo.ts`, `app/api/tasks/[id]/route.ts` | 备注可编辑持久化；“改写”跳 `#rewrite`，与“详情”区分 |
| 6. 场景图重生成按钮修正 | 已完成 | `components/TaskView.tsx`, `app/api/tasks/[id]/images/[artifactId]/regenerate/route.ts` | 批量按钮文案与行为一致；单图按钮调用 artifactId 重生成 |
| 7. 自动生成逐字稿持久化 | 已完成 | `components/CollectorTable.tsx`, `components/NewTaskForm.tsx`, `app/actions.ts` | 勾选状态写入 localStorage，并影响创建任务后的启动模式 |
| 8. 口播文案改写配置闭环 | 已完成 | `components/TaskView.tsx`, `components/task-view/RewriteWorkspace.tsx`, `lib/steps/rewrite.ts`, `docs/UI_HANDOFF.md` | `config.rewrite` 可保存补充要求，重跑改写会读取同一份备注 |

---

## 任务详情

### 任务 1：预览音频按钮接线

完成内容：
- `AudioWorkspace` 中保留 `audioRef`。
- 有 TTS artifact 时渲染 `<audio controls src={fileUrl(ttsArt.path)} />`。
- “预览音频”按钮绑定 `previewAudio()`，会滚动到播放器并尝试 `play()`。
- 无音频时按钮禁用并显示“暂无音频可预览”。

验证：
- Headless Chrome 页面检查已看到 `预览音频` 按钮和真实音频 URL：`/api/files/tasks/.../tts.wav`。
- `curl -I /api/files/tasks/.../tts.wav` 返回 `200 OK`，`content-type: audio/wav`。

### 任务 2：保存声明按钮接线

完成内容：
- `saveRenderConfig()` 调用 `saveTaskConfig("render", ...)`。
- 保存内容包含：
  - `styleCounts`
  - `styles`
  - `motionPresets`
  - `motions`
  - `statement`
- 页面加载时从 `config` artifact 回填 render 配置。

验证：
- `PATCH /api/tasks/[id]/config` 写入 `key=render` 成功。
- `GET /api/tasks/[id]/config?key=render` 可读回配置。
- Headless Chrome 验证 textarea 和声明预览能显示保存后的模板。

### 任务 3：多风格成片渲染

完成内容：
- 前端“生成 N 条视频”前先保存 render 配置。
- 后端 `runRender()` 读取 `config.render.value`，兼容两套字段：
  - `styleCounts` / `motionPresets`
  - `styles` / `motions`
- 后端根据配置展开 `RenderVariant`，输出文件名：
  - `final_<style>_<motion>_<index>.mp4`
- 每条输出保存独立 `render` video artifact，meta 中记录：
  - `style`
  - `styleLabel`
  - `motion`
  - `motionLabel`
  - `variantIndex`
  - `filename`
  - `engine`
- 默认批量路径走 `auto`：短视频走 HyperFrames 并按 variant 注入 style/motion/statement；长视频或 HyperFrames 失败时回退 ffmpeg/Pillow，避免逐帧截图耗时爆炸。
- 单次最多 6 条；前端和后端都固定这个产品上限，API 直调也只会取前 6 条。

验证：
- Headless Chrome 已看到配置回填后按钮显示“生成 3 条视频”。
- 后端 ffmpeg motion filter 做过冒烟验证。
- `tsc --noEmit` 通过。

重型验证：
- 2026-06-25 已用短任务 `-WT_yIif2Z9W` 在 UI 中设置 `clean=1`、`black=2`、只勾选 `cinematic`，实际点击“生成 3 条视频”。
- 产出 3 条可播放 mp4：`final_clean_cinematic_1.mp4`、`final_black_cinematic_1.mp4`、`final_black_cinematic_2.mp4`。
- 三条均为 1080x1920、约 27.52s；3 秒帧 MD5 分别不同，三联帧肉眼确认有视觉差异。

### 任务 4：动效预设生效

完成内容：
- motion preset 写入 render config。
- 后端按 motion 影响背景滤镜：
  - `cinematic`：慢速横移 + 柔和影调
  - `quick`：快速平移 + 高对比色彩
  - `calm`：静帧放大 + 低饱和影调
  - `collage`：复古色调 + 轻颗粒质感
- 前后端 `calm` 文案统一为“静帧放大”。

说明：
- 默认 motion 在短视频 HyperFrames 路径由模板接收 `style/motion/statement` 参数并映射到 GSAP 时间轴背景运动。
- ffmpeg 轻量运动/质感差异仅用于 `RENDER_ENGINE=ffmpeg` 或 `auto` 兜底路径。

### 任务 5：首页表格按钮优化

完成内容：
- `tasks` 表新增 `notes` 字段。
- 启动时检查旧 sqlite DB，缺列则执行：
  - `ALTER TABLE tasks ADD COLUMN notes TEXT`
- 新增 `updateTaskNotes()`。
- `PATCH /api/tasks/[id]` 可保存备注。
- `CollectorTable` 中“加备注”改成按钮，支持内联编辑、保存、取消。
- “改写”链接改为 `/tasks/{id}#rewrite`。
- `TaskView` 给候选口播稿面板加 `id="rewrite"`，并在异步数据加载后对 hash 做一次定位滚动。
- “制作任务”改为“详情”，普通跳转 `/tasks/{id}`。

验证：
- API 写备注后首页 headless 页面可看到保存后的备注。
- 直接打开 `/tasks/<id>#rewrite`，页面渲染后 DOM 中存在 `<div id="rewrite" ...>`。
- 首页 headless 页面可看到：
  - `改写` 链接带 `#rewrite`
  - `详情` 链接不带 hash

### 任务 6：场景图按钮修正

完成内容：
- 顶部批量按钮文案为“重新生成 N 张场景图”，调用整批 `runImages()`。
- 单张图片卡片内按钮为“重生成此图”，调用：
  - `POST /api/tasks/[id]/images/[artifactId]/regenerate`
- regenerate API 校验 task/artifact 关系，复用 artifact meta 的 `brief`/`idx`，覆盖原图片并更新 `regeneratedAt`。

验证：
- Headless 页面检查批量按钮文案与当前行为一致。
- 代码审查确认单图按钮传 `artifact.id`。

### 任务 7：首页“自动生成逐字稿”勾选框持久化

完成内容：
- `CollectorTable` 使用 localStorage 持久化：
  - key: `book-video-studio:auto-transcribe`
- `NewTaskForm` 读取同一个偏好。
- 同页面通过 `book-video:auto-transcribe-change` 自定义事件同步状态。
- `createTasksAction(input, mode, { autoTranscribe })` 根据偏好决定启动模式：
  - 关闭时，`pipeline` / `draft` 降级为 `collect`
  - `manual` 保持只创建记录

验证：
- Headless 首页可见“自动生成逐字稿”受控勾选框。
- `tsc --noEmit` 通过。
- 关闭后创建任务只跑采集、开启后恢复原模式的真实创建流程仍建议手动用一条短链接复验。

---

## 本轮验证记录

已执行：
- `./node_modules/.bin/tsc --noEmit`
- `curl -I /api/files/tasks/.../tts.wav`
- `PATCH /api/tasks/[id]` 保存备注
- `PATCH /api/tasks/[id]/config` 保存 render 配置
- `GET /api/tasks/[id]/config?key=render`
- Chrome headless 打开：
  - `http://localhost:3000/`
  - `http://localhost:3000/tasks/<id>`
  - `http://localhost:3000/tasks/<id>#rewrite`
- ffmpeg filter 冒烟测试：motion 背景滤镜可被 ffmpeg 解析。

验证结论：
- 类型检查通过。
- 首页、详情页关键 UI 能客户端渲染。
- 音频、配置、备注 API 可用。
- `#rewrite` 锚点已闭环。

未完成的重型验收：
- 未实际跑一次多风格 3 条 mp4 完整 render。
- 未实际创建新抖音链接验证“自动生成逐字稿”关闭时只跑 extract。

建议最终人工验收：
1. 打开 `http://localhost:3000`。
2. 进入一个已有 TTS + subtitle 的短任务。
3. 成片风格选择：清醒语录 x1、黑底打字机 x2，只勾选电影感。
4. 保存声明并刷新，确认配置保留。
5. 点击“生成 3 条视频”，确认成片输出出现 3 条可播放 mp4。
6. 首页关闭“自动生成逐字稿”，导入一条短链接，确认只跑到 extract；再开启后确认恢复自动链路。

---

## 仍需注意

- `components/TaskView.tsx` 已超过 1000 行，后续建议拆分为多个 workspace 组件。
- `app/globals.css` 很大，后续可按页面或组件拆 CSS module。
- 多风格 render 当前是 ffmpeg/Pillow 轻量风格差异；若要完整转场、Ken Burns、时间轴动效，需要继续改造 HyperFrames 模板。
- `saveTaskConfig`、保存备注、保存书籍信息、文本保存、保存声明、单图重生成已补失败 alert；后续可统一替换为 toast 组件。
- 多风格上限已固定为 6 条，后端不再读取 `RENDER_MAX_VARIANTS` 放大上限。

---

## 关键文件速查

```
app/
  actions.ts                         # 创建任务；autoTranscribe 影响启动模式
  api/tasks/[id]/config/route.ts     # task config PATCH/GET
  api/tasks/[id]/route.ts            # 备注 PATCH、单条 DELETE
  api/tasks/[id]/book/route.ts       # 书籍信息保存
  api/tasks/[id]/images/[artifactId]/regenerate/route.ts
  api/tasks/bulk/route.ts            # 批量删除
components/
  TaskView.tsx                       # 详情页工作区：音频、书籍、场景图、风格、产物
  CollectorTable.tsx                 # 首页表格：备注、批量操作、autoTranscribe
  NewTaskForm.tsx                    # URL 导入：读取 autoTranscribe 偏好
lib/
  db/schema.ts                       # tasks.notes
  db/index.ts                        # 老 DB ALTER TABLE notes
  pipeline/repo.ts                   # updateTaskNotes/deleteTask/patchArtifact
  steps/render.ts                    # 多风格/动效渲染
  steps/images.ts                    # targetCount 配置
workers/
  text_render/render_text.py         # 支持 fill/stroke_fill 字幕渲染
```
