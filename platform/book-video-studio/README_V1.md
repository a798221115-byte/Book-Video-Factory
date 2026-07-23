# Book Video Studio V1

第一版只处理抖音图书视频的采集和确认：

1. 粘贴一条或多条抖音分享链接。
2. 解析元数据并下载参考视频。
3. 对音频执行 ASR，保存原始逐字稿和清洗稿。
4. 识别书名、作者候选，生成爆款结构分析。
5. 等待用户明确确认书名和作者。
6. 确认后停在“微信读书热门划线”入口，不自动执行后续生产。

## 正式产物

每个任务直接写入项目根目录：

```text
work/YYYY-MM-DD-书名/
  reference-YYYY-MM-DD.mp4
  production-config.json
  video_clips/
    source-metadata.json
    raw-transcript.txt
    cleaned-transcript.txt
    book-candidates.json
    viral-structure-analysis.md
    book-confirmation.json
```

采集期间书名尚未识别时，工作目录暂命名为
`YYYY-MM-DD-待确认书名-短ID`。系统完成口播分析并得到最高置信度书名候选后，立即将目录迁移为
`YYYY-MM-DD-书名`；用户确认时如果纠正书名，目录会再次同步更正。同一天同名任务已存在时才追加
`-02`、`-03`。自动命名不会替代人工书名确认门。

SQLite 只保存任务索引、运行状态和 artifact 路径。

## 启动

复制 `.env.example` 为 `.env`，填写 TikHub、ASR 和 LLM 配置，然后运行：

```powershell
npm install
npm run dev
```

默认地址是 `http://localhost:3000`。

## 安全与流程限制

- 第一版禁用任务删除和批量删除。
- “继续第一阶段”最多运行到图书确认门。
- 不会自动调用微信读书、dbs、生图、TTS、渲染或发布流程。
- 未配置真实 provider 时任务会明确失败，不会用模拟内容冒充真实结果。
