# Feishu production tracking

Use this integration only when `<project-root>/integrations/feishu-book-pipeline.json` exists or the user explicitly asks for Feishu tracking.

## Architecture

- The skill defines steps, mandatory gates, and fields to sync.
- `scripts/sync_feishu_pipeline.mjs` performs deterministic Base API operations.
- A Codex recurring automation polls for new rows and invokes this skill. The skill does not run continuously by itself.
- Keep credentials outside the skill and project. Read `FEISHU_CREDENTIALS_FILE`, the binding's `credentialsFile`, or `F:/Codex/.secrets/feishu.env`.

## Mandatory gates

| Key | Gate | Confirmation |
| --- | --- | --- |
| G01 | WeRead popular highlights and source package | system evidence lock |
| G02 | narration copy | first explicit user confirmation |
| C01 | copy compliance review | system PASS after G02 |
| V01 | locked narration and measured timeline | system PASS |
| G03 | exactly one style sample | automatic QA PASS and adoption |
| G04 | all remaining images | second explicit user confirmation |
| G05 | post-production technical validation | system PASS |
| C02 | complete pre-publication media review | system PASS |
| G06 | register MP4, cover, and reports | automatic after C02 PASS |
| G07 | WeChat Channels draft-only upload | explicit draft request plus selected account |
| G08 | multi-platform automatic publication | selected accounts plus explicit per-task publication authorization |
| G09 | 24h/72h/7d analytics review | three traceable snapshots |

G07 remains draft-only. G08 may automate formal publication only after explicit per-task authorization; record a separate result for every selected platform/account and preserve partial failures for safe retry.

Never infer G02 or G04 confirmation from existing files. Historical projects may use legacy gates, but new projects use only these two production confirmations.

## Sync points

Run the sync script:

1. when a project is claimed or created;
2. before starting a step (`执行中`);
3. when an artifact is written;
4. when waiting for confirmation (`待确认` / `等待用户确认`);
5. when validation passes;
6. when a step fails or is blocked;
7. when a draft upload, publication authorization, per-platform publication result, metric snapshot, or review is recorded.

Example commands:

```powershell
node scripts/sync_feishu_pipeline.mjs queue --binding "<project-root>/integrations/feishu-book-pipeline.json"
node scripts/sync_feishu_pipeline.mjs bootstrap --binding "<project-root>/integrations/feishu-book-pipeline.json" --project-id "BK-20260720-001" --book "书名" --author "作者"
node scripts/sync_feishu_pipeline.mjs step --binding "<binding>" --project-id "BK-20260720-001" --gate G01 --gate-status "已锁定（自动）" --stage "文案审核" --work-status "制作中" --evidence "work/.../script_sources.md"
node scripts/sync_feishu_pipeline.mjs step --binding "<binding>" --project-id "BK-20260720-001" --gate G02 --gate-status "待确认" --stage "文案审核" --work-status "待用户确认" --waiting "第一次确认：文案"
```

The recurring automation must call `queue` first. It may claim one new row per run, or resume an existing project only when G02 or G04 is explicitly `已确认`; automatic nodes resume from their recorded system status. `已完成（倒推）`, `提前产出待确认`, local files, and inferred downstream progress are never user approval.

## Field contract

`图书项目` is one row per book. Always update `项目ID`, `书名`, `作者`, `当前阶段`, `工作状态`, `当前待确认`, `下一步动作`, `阻塞与风险`, `最近更新`, `Codex状态`, `Codex运行ID`, and artifact path fields when available.

`确认节点` is one row per project and gate. The stable key is `<project-id>-GNN`. Always update `节点状态`, `证据与文件`, `备注`, and `下一阶段`.

`Codex任务队列` records execution state, heartbeat, retry, outputs, and errors. Reuse one stable Codex task/thread per book-video project across all nodes.

Reuse the existing `数据快照` and `复盘记录` structures for G09. Store each 24h/72h/7d snapshot separately; do not overwrite an earlier horizon.

## Error policy

- Treat HTTP 200 as transport success only; require top-level `code == 0`.
- Retry Feishu write-conflict and rate-limit codes with bounded backoff.
- Never delete tables, fields, or records from this script.
- A sync failure must be visible in the final response and local validation report, but must not overwrite or remove valid local production assets.
