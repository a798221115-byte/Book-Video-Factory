# CLAUDE.md — 项目交接文档（给 Claude Code 阅读）

> 本文件供 AI 助手快速读懂全局。人类看 `DEPLOY_WSL2.md`（部署）和 `docs/参考资料.md`（原文）。

## 一句话定位
**AI 图书带货视频工作台**：粘贴一条抖音图书分享链接 → 全自动产出一条带字幕的竖版口播成片（9:16 mp4），全程不切软件。复刻自飞书文章作者的工作流。

**V1 验收标准（已达成）**：抖音链接 → 6 步流水线自动跑完 → 可播放/下载的 `final.mp4`（背景 + TTS 配音 + 同步中文字幕）。已用真实抖音链接（《毛选》视频）端到端验证。

---

## 二、技术栈
- **Next.js 15.1.8**（App Router）+ React 19 + TypeScript
- **Drizzle ORM + better-sqlite3**（本地 sqlite 持久化，`data/app.db`）
- **Provider 模式**：每类外部能力（抖音/LLM/ASR/TTS/图像）抽象成 provider，按环境变量在 真实/Mock 间自动切换
- 无重型前端框架，纯 React + 内联样式；状态靠 SSE 流式 + 轮询兜底
- 外部工具：`ffmpeg`、`python3 + Pillow`（字幕渲染）

## 三、6 步流水线（核心数据流）
```
extract → transcribe → rewrite → tts → subtitle → render
                          ↘ images(可选,不进自动全链) ↗
```
| 步骤 | 做什么 | 关键实现 |
|------|--------|---------|
| **extract** | 抖音链接→无水印视频+元数据 | TikHub API；从 `modal_id`/`video/<id>` 解析 aweme_id |
| **transcribe** | 视频→逐字稿→清洗 | ffmpeg 抽 16k 音频 → ASR → gpt-5.5 按附件A清洗(修同音错/转中文数字) |
| **rewrite** | 清洗稿→口播稿 + 书名识别 | 附件B改写(gpt-5.5) + 附件D书名识别(deepseek, JSON) |
| **tts** | 口播稿→配音 wav | 附件F拆段(LLM) → 逐段合成 → ffmpeg concat(统一24k/mono) |
| **subtitle** | 配音→字幕时间轴 | ASR词级时间戳 → 切短行(≤15字,不断书名号) → SRT + cues.json |
| **images**(可选) | 口播稿→九宫格配图 | 逐段画面brief → gpt-image-2 出3x3总图 → 裁9张分镜(省90%成本)。固定用 gpt-image-2 |
| **render** | 合成成片 | auto：短视频 HyperFrames HTML timeline → mp4；长视频/失败走 ffmpeg/Pillow 兜底 |

依赖与级联在 `lib/pipeline/steps.ts`（`STEP_DEPS`/`downstreamOf`）。编辑某步产物→下游自动置 pending 需重跑。

## 四、目录结构（关键文件）
```
lib/pipeline/
  steps.ts      STEP_NAMES/DEPS/LABELS, OPTIONAL_STEPS=[images], downstreamOf()
  runner.ts     runStep/rerunStep/runPipeline; 步骤级并发锁; 可选步骤不阻塞task done
  repo.ts       Drizzle CRUD; deleteTask安全清库+清目录; clearArtifacts/updateArtifactContent/patchArtifact/ensureSteps
  register.ts   注册 6 个 step executor
lib/steps/      6步各自的 runXxx(taskId) 实现 + images.ts
lib/providers/
  douyin.ts     TikHub / Mock
  llm.ts        OpenAI兼容(gpt-5.5改写) + getBookLLM(deepseek书名/去重,流式)
  asr.ts        兜底链: 中转站whisper→腾讯云→Mock
  tts.ts        index-tts2(Windows GPU,已部署) > Replicate > macOS say > Mock
  image.ts      gpt-image-2(b64_json) / Mock（固定用 gpt-image-2）
  tencent-sign.ts  腾讯云 TC3-HMAC-SHA256 签名
lib/prompts.ts  附件A/B/C/D/F/E 提示词 + STYLE_BIBLE（C=轻量去重）
workers/
  text_render/render_text.py  文本→透明PNG(中文+描边+自动缩字号)
  image_grid/crop_grid.py     九宫格3x3裁切
  index_tts2/server.py        本地TTS worker(Windows GPU,已部署运行)
app/api/         tasks/[id]/{run,status,stream}/route.ts, book/config/artifacts编辑, dedup去重, images重生成, 单条/批量删除, files静态服务
components/
  TaskView.tsx      详情页：流程导航+音频/书籍/场景图/风格工作区+产物展示+文本编辑
  NewTaskForm.tsx   首页 URL 导入表单（支持多条粘贴）
  CollectorTable.tsx 首页采集结果表格
docs/UI_HANDOFF.md  2026-06-25 UI 产品化改版交接：采集页/任务流/书籍信息/场景图/风格数量
```

## 五、Provider 选择逻辑（看 env）
- **ASR**（兜底链，前者失败/空文本自动切下一个）：`ASR_API_KEY`(中转站whisper) → `TENCENT_SECRET_ID/KEY`(腾讯云) → Mock。**腾讯云识别质量最好且自带标点**。
- **TTS**：`TTS_PROVIDER`显式指定 > `INDEX_TTS2_URL`(Windows GPU,已部署) > `REPLICATE_API_TOKEN` > macOS say(仅darwin) > Mock。
- **LLM**：`OPENAI_API_KEY`(gpt-5.5) / `DEEPSEEK_API_KEY`(书名)。
- **图像**：`IMAGE_API_KEY`(gpt-image-2)。固定用 gpt-image-2，不再考虑本地 SDXL/ComfyUI。
- **背景**：`RENDER_BG` = video|images|auto(默认,有配图优先轮播)。

## 六、踩过的坑（务必知道，避免重蹈）
1. **ffmpeg 缺 libass/drawtext**：无法用 `subtitles=`/`drawtext=` 烧字幕。改用 **Pillow 渲染 PNG → ffmpeg overlay + enable='between(t,a,b)'**。
2. **ffmpeg cwd 二次拼接路径**：给 ffmpeg 的文件输入若是相对路径且又设了 `cwd:dir`，会拼成 `dir/dir/file` 报 No such file。**所有 ffmpeg 输入用 `path.resolve()` 绝对路径**。（render PNG、slideshow 都踩过）
3. **中转站 json_object 模式**：该网关要求**user消息**含小写 "json"（不看system），否则400。`llm.ts` 已自动补。曾静默导致 tts拆段/配图brief 降级到兜底。
4. **中转站 Whisper 不稳定**：长音频频繁 `do_request_failed`/超时。已加腾讯云兜底。
5. **腾讯云ASR同步接口限5MB**：PCM wav 太大→转 16k/32k mp3(208s音频仅0.8MB)。不要传 VoiceFormat 参数(引擎自动识别)。
6. **Pillow 字体**：macOS PingFang.ttc 打不开；用 Hiragino/STHeiti。Linux 用 Noto CJK。`findFont()` 跨平台探测+`SUBTITLE_FONT`覆盖。
7. **重跑产物堆积**：每个 step 开头必须 `clearArtifacts(taskId, name)`，否则重跑产生重复产物。
8. **并发触发踩踏**：`runStep` 有步骤级锁；测试时勿同时发 rerun+pipeline。

## 七、当前状态（迁移到 Windows 时）
- **平台**：原 macOS 开发，正迁往 **Windows WSL2(Ubuntu) + RTX 4070 Super(12GB)**。见 `DEPLOY_WSL2.md`。
- **已完成**：6步全链 + 配图九宫格 + 腾讯云ASR兜底 + 配图轮播背景 + 审核/编辑UI + 跨平台兼容 + 详情页按钮接线 + 多风格 render 配置 + 首页备注/自动逐字稿偏好持久化。
- **近期已落地（均经真实素材/API 实测）**：
  - **HyperFrames 渲染**：auto 模式下短视频优先使用；注册 GSAP timeline(原因 45s 超时根因) + 背景关键帧加密 + @font-face
    内嵌 CJK 字体(Docker/远端不丢字)。默认使用本地 `hyperframes` npm 依赖，>30s 或失败走 ffmpeg 兜底。
  - **TTS**：接通 Windows GPU index-tts2 worker(真人声,已部署运行); Replicate indextts-2
    云端兜底(predictions 轮询)。
  - **字幕词级对齐**：ASR token 级时间戳 + 逐字流水匹配 + 繁→简折叠(`t2s.ts`)，
    取代纯比例分配; 实测 132 cue 0 重叠、命中率高时 alignedByWords=true。
  - **SSE 流式进度**：单条长连接 + 变化帧去重 + 终态 end + 断线回退轮询。
  - **2026-06-25 工作流硬化提交 `67feb48`**：
    - TTS 语速真实生效边界已固定：provider 只接收 voice，pipeline 统一用 ffmpeg `atempo` 应用 speed；artifact meta 写入 `rawDur/speedDur/speedFilter/speedMode` 便于排查。
    - 场景图 brief 扩展已从“循环复用原段落”改为 LLM 扩写 + 质量过滤 + fallback 生活化镜头生成；会剔除过短、泛化、近重复、直接复用原文的 brief，90 条压力兜底不足时显式报错。
    - 关键保存/重生成/备注反馈已从零散 `alert` 改成统一 `ToastHost`，失败不再静默误导用户。
    - 新增可重复验收脚本：`verify:tts-speed`、`verify:image-briefs`、`verify:render-variants`。
  - **轻量去重（附件C，旁路工具）**：`POST /api/tasks/[id]/dedup` 读已清洗正文 + 从书名识别 JSON 自动提取 protected_terms（书名/作者），用 **DeepSeek（getBookLLM）** 做克制微调，产出独立 `dedup/text` artifact（覆盖式）。前端 `DedupWorkspace` 旁路面板（不进主流水线 STAGES），显示字数差异%徽章 + 保留词 + 人工把关提示。实测 DeepSeek 中文同义替换质量明显优于 gpt-5.5（gpt 出现“弄清→弄轻”语义错误，DeepSeek 为“弄清→摸透”），相似度 86%~97% 波动、保留词完好。
- **仍待优化**：
  - **多风格渲染视觉深度**：`VideoStylesWorkspace` 已保存 `config.render`，`runRender()` 已能读取风格数量/动效/声明并批量输出 `final_<style>_<motion>_<index>.mp4`；auto 路径短视频用 HyperFrames 模板接收 style/motion/statement 并映射到 HTML 时间轴，长视频/失败走 ffmpeg/Pillow 兜底，后续仍可继续扩展更复杂转场/分层时间轴。
  - **重型验收已完成**：2026-06-25 用短任务 `-WT_yIif2Z9W` 通过 UI 设置 `clean=1`、`black=2`、仅 `cinematic`，点击“生成 3 条视频”，产出 3 个 1080x1920 mp4；同一时间点帧 MD5 三者不同，肉眼三联帧确认有视觉差异。
  - **下一步建议**：跑一次真实 TTS provider 端到端语速验收；给 brief 扩展加 LLM mock fixture；把 toast 从页面局部提升为 app 级 provider；把 task 配置从 artifact 表拆到独立 `task_configs`。
- **2026-06-25 UI 产品化改版（看 `docs/UI_HANDOFF.md`）**：
  - 首页已改成“热点采集到混剪成片”工作台；支持多 URL 导入、处理方式选择、服务端筛选排序、复制链接、单条/批量删除。
  - 详情页已改成左侧流程导航 + 任务流工作区，并新增音频预估、书籍信息、AI 场景图、成片风格与数量模块。
  - 新增 `PATCH /api/tasks/[id]/book` 保存书籍信息；新增 `PATCH/GET /api/tasks/[id]/config` 保存 TTS、人工确认、场景图张数等 task 配置；新增 `POST /api/tasks/[id]/images/[artifactId]/regenerate` 单图重生成。
  - `runImages()` 会读取 `config.images.value.targetCount`，按 9 张一组生成九宫格并裁切；目标数量大于基础段落时，会通过 `PROMPT_E_BRIEF_EXPAND` 扩写 brief，并用 `imageBriefs.ts` 做质量过滤/去重/fallback。
  - `VideoStylesWorkspace` 会保存 `config.render`（风格数量、动效、声明模板）；`runRender()` 按 style × motion × 数量展开多版本，并保存多个 `render` video artifacts。
  - 详情页“预览音频”已接真实 `<audio>`；“保存声明”会持久化 render 配置；场景图支持整批重新生成和单图 artifact 重生成。
  - 首页备注已持久化到 `tasks.notes`；“自动生成逐字稿”偏好已写入 localStorage，并会影响新建任务启动模式；“改写”跳 `/tasks/{id}#rewrite`，与“详情”区分。
  - 单条/批量删除调用 `deleteTask()`，会先确认任务存在，再删除 DB 记录并只清理 `data/tasks/<id>` 下的目录，避免误删外部路径。
  - TikHub/Mock 采集元数据已扩展 `stats.followers`、`stats.duration`、`stats.publishedAt`，首页筛选和表格展示会使用这些字段。
  - 重要限制：`auto` 是默认成片引擎策略；短视频走 HyperFrames，长视频或 HyperFrames 失败时回退 ffmpeg/Pillow 轻量样式。显式 `RENDER_ENGINE=hyperframes` 才会强制 HTML 渲染。

## 八、开发命令
```bash
npm install        # 装依赖(会编译 better-sqlite3 原生模块)
npm run dev        # 开发服务器(默认:3000; Mac上历史用过 PORT=3939)
./node_modules/.bin/tsc --noEmit   # 类型检查(改完必跑; 别用 npx tsc 会装错版本)
npm run db:push    # drizzle 建表(首次/改schema)
npm run verify:tts-speed        # 验证 0.9/1.0/1.1 speed 的实际音频时长变化
npm run verify:image-briefs     # 验证 brief 过滤、去重、90条 fallback
npm run verify:render-variants  # 验证默认任务3个多风格mp4尺寸/时长/抽帧差异
```
- 改完代码务必 `tsc --noEmit` 干净再算完成。
- 任务数据在 `data/tasks/<id>/`；`.env`/`models/`/`data/` 已 gitignore。
- 密钥都在 `.env`（gitignore），**不要打印/提交/传公开链接**。

## 九、原文参考
`docs/参考资料.md`(7步链路/技术选型/成本) + `docs/原文全文.txt` + `docs/prompts/*.md`(附件A-G原始提示词)。架构图 `docs/reference_images/09_architecture_final.jpg`。
