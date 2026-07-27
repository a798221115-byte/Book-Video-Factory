---
name: produce-wechat-book-video
description: Produce, review, draft-upload, and track a two-confirmation WeChat Channels vertical book video from a Douyin reference, WeRead discovery, book title, or draft topic. Use for evidence-backed derivative copy, automatic titles, locked narration, storyboard images, post-production, standalone covers, delivery validation, optional platform draft upload, human publication recording, and 24h/72h/7d review.
---

# Produce WeChat Book Video

Use this file as the single orchestration entrypoint. Load detailed references only for the active production stage; do not treat reference files, scripts, or supporting skills as nested callable skills.

## Operating contract

- Treat a Douyin link, book title, or topic as intake only.
- Require exactly two blocking human confirmations on the normal path:
  1. G02 derivative narration copy.
  2. G04 all storyboard images.
- Allow extra pauses only for ambiguous book identity, unavailable required evidence or tools, compliance blocks, explicit rollback, or another genuine exception.
- Keep formal publication separately human-authorized; draft upload is not publication.
- Reuse one persistent Codex task/thread per project.
- Once a book title is identified, use it as the workbench project title and persistent Codex task/thread title; keep the source-video title unchanged as evidence. Apply corrected book titles to both titles and the dated project directory.
- Keep every human gate reversible. Before rollback, show downstream impact; preserve prior files and audit history, mark stale artifacts superseded, and rerun affected checks.

## Load references by stage

| Need | Read |
| --- | --- |
| Full state machine, artifacts, rollback, delivery, or publication tracking | `references/workflow.md` |
| Douyin download, Whisper transcript, DBS diagnosis, WeRead evidence, or derivative copy | `references/intake-copy-pipeline.md` |
| Copy voice, storyboard semantics, image prompts, anatomy, reflections, or typography | `references/creative-standards.md` |
| Narration, timing, motion, render, audio mix, or technical validation | `references/technical-spec.md` |
| Standalone WeChat Channels cover | `references/cover-style-spec.md` |
| Feishu-bound or Feishu-originated work | `references/feishu-integration.md` |

Use `assets/default-config.json` unless the user explicitly overrides it. Inspect project `AGENTS.md`, fixed assets, voice presets, and available integrations before production.

## Core workflow

1. Accept a real WeRead topic or supplied reference. When a Douyin link exists, download only through `scripts/download_douyin_tikhub.mjs`; stop if TikHub is unavailable.
2. Preserve TikHub metadata, untouched Whisper ASR, minimally corrected transcript, and `dbs-content` diagnosis.
3. Verify the exact WeRead edition and popular highlights. Build a traceable G01 source package and lock the selected evidence automatically; do not add a human stop.
4. Write the derivative narration from verified evidence, reusable abstract mechanisms, and original reflection. Stop for the first confirmation at G02.
5. Run C01 with `media-publish-check`. Preserve the confirmed copy; block downstream work on a failing or high-risk result.
6. After C01 passes, run in parallel:
   - generate 10 traceable long titles, adopt the first recommendation, generate 10 short titles from it, and adopt the first recommendation;
   - generate locked narration and persist measured timing to `recipe.json`, storyboard timing fields, and caption timing.
7. Immediately send one non-blocking title feedback message that attaches or links `titles.json` and visibly lists all 10 long titles plus all 10 short titles, numbered `L01–L10` and `S01–S10`. Mark the adopted pair, include the exact reply syntax for reselection, and never show only the adopted pair. Continue without waiting.
8. After titles and real timing are complete, build the semantic storyboard, generate exactly one G03 style sample, run automatic visual QA, adopt a passing sample, and continue to the remaining images.
9. Inspect all images and stop for the second confirmation at G04. Regenerate only failing images when practical.
10. After G04 confirmation, create captions, final mix, 1080x1920 60fps review MP4, validation report, and separate 1080x1260 cover. Do not create a Jianying draft.
11. Run C02. Block delivery registration on high risk; after a pass, automatically register the MP4, cover, reports, and complete `titles.json` without adding a third production confirmation.
12. Upload to a selected WeChat Channels draft box only on explicit request. Never automate formal publication. Record real publication and 24h/72h/7d metrics only when supplied.

## Hard invariants

- Never silently replace TikHub, WeRead, or another required evidence source.
- Preserve `raw-transcript-whisper.txt` before cleanup. Correct only context-supported transcription errors; do not rewrite the reference copy.
- Keep reference-video wording and WeRead quotations as separate evidence classes. Never present an unverified reference sentence as a book quotation.
- Reuse only abstract reference mechanisms; rebuild content-bearing sentences from verified evidence and original reflection.
- Do not create a storyboard or images before G02 confirmation and completed automatic title selection.
- Derive image count from semantic changes, not a fixed total. Treat roughly eight seconds per image only as a soft pacing check.
- Keep generated backgrounds free of text. Add title, author, column, and captions through deterministic render.
- Run subject-mix, flat-block, anatomy, continuity, and reflection checks defined in `references/creative-standards.md`.
- Default to `female-book-narrator-locked-v1` with the matching female intro. Use the male pair only when explicitly requested.
- Treat completed narration duration as the timing authority.
- Keep the standalone cover separate from the MP4 and preserve the verified original edition artwork.
- Preserve candidates, adopted titles, formula traceability, and resolved publication topics in `titles.json`.
- Make the complete 10+10 title set user-visible in the current conversation as soon as automatic selection finishes. A file path alone, candidate counts alone, or only the adopted pair is insufficient.

## Supporting skills and tools

- Use `dbs-content` for reference-copy diagnosis, not derivative drafting.
- Use `weread-skills` for edition verification and popular highlights.
- Use `dbs-xhs-title` for traceable title formulas.
- Use `imagegen` for original storyboard images and revisions.
- Use `media-publish-check` for C01 and C02.
- Use local VoxCPM for locked narration and FFmpeg for assembly, audio, captions, and validation.
- Use the pinned `dreammis/social-auto-upload` adapter only through the workbench in draft-only mode.
- Use the bundled scripts for project initialization, variant resolution, voice tests, mixing, cover composition, Feishu sync, and delivery validation.

## Completion handoff

Do not call production complete until required evidence, the two confirmations, passing or explicitly disclosed validation, final media, standalone cover, and delivery manifest exist.

In the final handoff:

- link the MP4, cover, validation reports, and `titles.json`;
- repeat the adopted long and short titles and keep the complete 10+10 candidate document linked;
- show all resolved publication topics;
- expose missing or low-confidence items;
- report Feishu state when enabled;
- distinguish completed production from optional draft upload and manual publication.
