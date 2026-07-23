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
| G01 | WeRead popular highlights | explicit user approval |
| G02 | narration copy | explicit user approval |
| G03 | exactly one style sample | explicit user approval |
| G04 | all remaining images | explicit user approval |
| G05 | post-production technical validation | system PASS |
| G06 | review MP4, Jianying draft, and WeChat Channels cover | explicit user approval |
| G07 | publication | explicit user authorization |
| G08 | result and archive | recorded publication plus explicit archive approval |

The default production workflow ends at G06 after the MP4, editable Jianying draft, and standalone cover are approved together. G07 and G08 are out of scope unless the user explicitly requests a separate publication or archive workflow.

Never infer a user-confirmed gate from existing files. Historical projects may use `已完成（倒推）`, but new projects must use explicit confirmation.

## Sync points

Run the sync script:

1. when a project is claimed or created;
2. before starting a step (`执行中`);
3. when an artifact is written;
4. when waiting for confirmation (`待确认` / `等待用户确认`);
5. when validation passes;
6. when a step fails or is blocked;
7. when publication and archive are recorded.

Example commands:

```powershell
node scripts/sync_feishu_pipeline.mjs queue --binding "<project-root>/integrations/feishu-book-pipeline.json"
node scripts/sync_feishu_pipeline.mjs bootstrap --binding "<project-root>/integrations/feishu-book-pipeline.json" --project-id "BK-20260720-001" --book "书名" --author "作者"
node scripts/sync_feishu_pipeline.mjs step --binding "<binding>" --project-id "BK-20260720-001" --gate G01 --gate-status "待确认" --stage "微信读书热门划线确认" --work-status "待用户确认" --waiting "确认热门划线" --evidence "work/.../script_sources.md"
node scripts/sync_feishu_pipeline.mjs step --binding "<binding>" --project-id "BK-20260720-001" --gate G01 --gate-status "已确认" --stage "文案审核" --work-status "制作中"
```

The recurring automation must call `queue` first. It may claim one new row per run, or resume an existing project only when the current required user gate is explicitly `已确认`. `已完成（倒推）`, `提前产出待确认`, local files, and inferred downstream progress are never automation approval.

## Field contract

`图书项目` is one row per book. Always update `项目ID`, `书名`, `作者`, `当前阶段`, `工作状态`, `当前待确认`, `下一步动作`, `阻塞与风险`, `最近更新`, `Codex状态`, `Codex运行ID`, and artifact path fields when available.

`确认节点` is one row per project and gate. The stable key is `<project-id>-GNN`. Always update `节点状态`, `证据与文件`, `备注`, and `下一阶段`.

`Codex任务队列` records execution state, heartbeat, retry, outputs, and errors. It is the automation layer, not the content source of truth.

## Error policy

- Treat HTTP 200 as transport success only; require top-level `code == 0`.
- Retry Feishu write-conflict and rate-limit codes with bounded backoff.
- Never delete tables, fields, or records from this script.
- A sync failure must be visible in the final response and local validation report, but must not overwrite or remove valid local production assets.
