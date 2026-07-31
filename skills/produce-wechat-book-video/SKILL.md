---
name: produce-wechat-book-video
description: Produce, review, distribute, and track a vertical book video from a supplied final narration script, narration reference, Douyin/video link, WeRead discovery, book title, or draft topic. Use for explicit “成稿直出” production without derivative rewriting, evidence-backed derivative copy, automatic title and publication-topic selection, locked narration, storyboard images, post-production, standalone covers, delivery validation, optional WeChat Channels draft upload, explicitly authorized multi-platform publication, and 24h/72h/7d review.
---

# Produce WeChat Book Video

Use this file as the single orchestration entrypoint. Load detailed references only for the active production stage; do not treat reference files, scripts, or supporting skills as nested callable skills.

## Operating contract

- Route intake automatically:
  - when the user supplies a usable narration transcript, use the text-intake path and do not download or transcribe a linked reference unless explicitly requested;
  - when the user supplies only a Douyin or other supported video link, use the link-intake path and preserve the existing TikHub/download/Whisper evidence chain.
- A substantial supplied transcript takes precedence when the same message also includes a source link. Keep that link as optional provenance metadata.
- Treat a supplied transcript, Douyin/video link, book title, or topic as intake only unless the user explicitly marks a usable supplied transcript as the final script, including with `成稿直出`.
- In explicit direct-final-script mode, preserve the supplied narration verbatim as `script.txt`, record the user's instruction as G02 approval, skip derivative-copy generation and its evidence prerequisites, and continue at C01. Do not treat a book title, topic, short caption, or link preview as a final script.
- Require exactly two blocking human confirmations on the normal path:
  1. G02 derivative narration copy.
  2. G04 all storyboard images.
- In direct-final-script mode, the explicit instruction is the first confirmation; G04 remains the only later production stop.
- Allow extra pauses only for ambiguous book identity, unavailable required evidence or tools, compliance blocks, explicit rollback, or another genuine exception.
- Keep formal publication separately human-authorized per task. After the user selects accounts and explicitly authorizes the irreversible action, the workbench may complete formal publication automatically.
- Reuse one persistent Codex task/thread per project.
- Once a book title is identified, use it as the workbench project title and persistent Codex task/thread title; keep the source-video title unchanged as evidence. Apply corrected book titles to both titles and the dated project directory.
- Keep every human gate reversible. Before rollback, show downstream impact; preserve prior files and audit history, mark stale artifacts superseded, and rerun affected checks.

## Load references by stage

| Need | Read |
| --- | --- |
| Full state machine, artifacts, rollback, delivery, or publication tracking | `references/workflow.md` |
| Douyin download, Whisper transcript, DBS diagnosis, WeRead evidence, or derivative copy | `references/intake-copy-pipeline.md` |
| Copy voice, storyboard semantics, image prompts, anatomy, reflections, or typography | `references/creative-standards.md` |
| Locked default visual profile and style-reference usage | `references/style-profile-warm-cinematic-literary-life-v1.md` |
| Narration, timing, motion, render, audio mix, or technical validation | `references/technical-spec.md` |
| Standalone WeChat Channels cover | `references/cover-style-spec.md` |
| Feishu-bound or Feishu-originated work | `references/feishu-integration.md` |

Use `assets/default-config.json` unless the user explicitly overrides it. Inspect project `AGENTS.md`, fixed assets, voice presets, and available integrations before production.

## Core workflow

1. Classify the intake before acquiring evidence:
   - supplied narration text: preserve it verbatim as `raw-transcript-user.txt`, create the minimally corrected `reference-transcript.txt`, and skip video download and ASR;
   - link only: for a Douyin link, download only through `scripts/download_douyin_tikhub.mjs`, preserve untouched Whisper ASR, and stop if TikHub is unavailable.
2. Detect explicit direct-final-script intent before derivative evidence acquisition:
   - when the user supplies a usable narration and says `成稿直出` or otherwise explicitly says to use it as the final script without rewriting, copy the exact narration to `script.txt`, mark `G01=not_required_for_user_supplied_final_script` and `G02=approved_by_explicit_user_instruction`, then continue at C01;
   - otherwise continue through normal book identification, evidence verification, derivative writing, and G02 confirmation.
3. On the normal derivative path, identify the book from the transcript when possible. If the identity is unambiguous, continue automatically; stop only when the title is missing, low-confidence, or maps to multiple plausible WeRead editions.
4. On the normal derivative path, run `dbs-content`, verify the exact WeRead edition, retrieve the first 10 whole-book popular highlights in returned heat order, build G01, write the derivative narration, and stop at G02.
5. Run C01 with `media-publish-check`. Preserve the confirmed copy; block downstream work on a failing or high-risk result.
6. After C01 passes, run in parallel:
   - generate 10 traceable long titles, adopt the first recommendation, generate 10 short titles and 10 publication-topic sets from it, and adopt the first recommendation in each set;
   - generate locked narration and persist measured timing to `recipe.json`, storyboard timing fields, and caption timing.
7. Immediately send one non-blocking selection feedback message that attaches or links `titles.json` and visibly lists all 10 long titles, all 10 short titles, and all 10 publication-topic sets, numbered `L01–L10`, `S01–S10`, and `T01–T10`. Mark the adopted long title, short title, and topic set, include the exact reply syntax for reselection, and never show only the adopted items. Continue without waiting.
8. After the long title, short title, publication-topic set, and real timing are complete, build the semantic storyboard, generate exactly one G03 style sample, run automatic visual QA, adopt a passing sample, and continue to the remaining images.
9. Inspect all images and stop for the second confirmation at G04. Regenerate only failing images when practical.
10. After G04 confirmation, create captions, final mix, 1080x1920 60fps review MP4, validation report, and separate 1080x1260 cover. Do not create a Jianying draft.
11. Run C02. Block delivery registration on high risk; after a pass, automatically register the MP4, cover, reports, and complete `titles.json` without adding a third production confirmation.
12. Keep the compatible WeChat Channels draft-box upload available on explicit request. For formal distribution, require selected platform accounts plus explicit per-task authorization, then use the pinned `dreammis/social-auto-upload` adapter to publish automatically to Douyin and/or WeChat Channels, persist one idempotent result per platform/account/video version, and continue successful publications to 24h/72h/7d review.

## Hard invariants

- Never silently replace TikHub on the link-intake path, WeRead, or another required evidence source.
- Preserve the original transcript according to its real source: `raw-transcript-user.txt` for supplied text or `raw-transcript-whisper.txt` for Whisper. Never create a fake Whisper artifact for text intake.
- Correct only context-supported transcription or punctuation errors in `reference-transcript.txt`; do not rewrite the reference copy.
- Keep reference-video wording and WeRead quotations as separate evidence classes. Never present an unverified reference sentence as a book quotation.
- On the derivative path, reuse only abstract reference mechanisms and rebuild content-bearing sentences from verified evidence and original reflection. In direct-final-script mode, preserve the user-approved script verbatim and do not relabel it as a verified book quotation.
- Do not create a storyboard or images before G02 confirmation and completed automatic title selection. An explicit direct-final-script instruction with a usable supplied narration counts as G02 confirmation.
- Direct-final-script mode does not imply G04 image approval, draft upload, formal publication, or permission to fabricate author, edition, quotation, or cover evidence.
- Derive image count from semantic changes, not a fixed total. Treat roughly eight seconds per image only as a soft pacing check.
- Use the locked `warm-cinematic-literary-life-v1` background-image profile and its bundled style anchor from `assets/default-config.json` for every G03 and G04 image unless the user explicitly requests a different visual direction. Keep the default photorealistic, low-saturation, warm-golden, literary and naturally lived-in; never silently fall back to orange-accent high-key photography, near-black editorial collage, colorful painterly illustration, glossy advertising, or generic AI portraiture.
- Keep generated backgrounds free of text. Add title, author, column, and captions through deterministic render.
- Position the deterministic `读书分享` / book-title / author header group from `captions.typography.headerPositionsPx`; the default 1080×1920 template shifts the complete group down by 10% of canvas height while preserving its internal spacing.
- Render Chinese and English captions as separate bottom-aligned ASS styles. For the standard 1080×1920 template, lock Chinese `MarginV=560` and English `MarginV=510`; never collapse them into one `\N`-joined style or fall back to a low bottom margin.
- Run style-anchor similarity, subject-mix, face-orientation diversity, empty-shot/landscape suitability, flat-block, anatomy, identity/wardrobe continuity, warm-golden lighting, muted-palette, and reflection checks defined in `references/creative-standards.md`.
- Default to `female-book-narrator-locked-v1` with the matching female intro. Use the male pair only when explicitly requested.
- Treat completed narration duration as the timing authority.
- Keep the standalone cover separate from the MP4 and preserve the verified original edition artwork.
- Preserve all candidates, adopted titles, formula traceability, topic-set recommendation reasons, and the resolved adopted publication topics in `titles.json`.
- Make the complete 10+10+10 selection set user-visible in the current conversation as soon as automatic selection finishes. A file path alone, candidate counts alone, or only the adopted items are insufficient.
- Generate exactly 10 publication-topic sets. Each set must contain exactly seven unique, space-separated hashtags, always include `#读书`, `#好书推荐`, and the resolved `#《当前书名》`, and use four narration-relevant topics for the remaining positions. Automatically adopt `T01`.

## Supporting skills and tools

- Use `dbs-content` for reference-copy diagnosis, not derivative drafting.
- Use `weread-skills` for edition verification and popular highlights.
- Use `dbs-xhs-title` for traceable title formulas.
- Use `imagegen` for original storyboard images and revisions.
- Use `media-publish-check` for C01 and C02.
- Use local VoxCPM for locked narration and FFmpeg for assembly, audio, captions, and validation.
- Use the pinned `dreammis/social-auto-upload` adapter only through the workbench. Draft mode remains draft-only; formal multi-platform publication requires an explicit per-task authorization token and selected accounts.
- Use the bundled scripts for project initialization, variant resolution, voice tests, mixing, cover composition, Feishu sync, and delivery validation.

## Completion handoff

Do not call production complete until required evidence, the two confirmations, passing or explicitly disclosed validation, final media, standalone cover, and delivery manifest exist.

In the final handoff:

- link the MP4, cover, validation reports, and `titles.json`;
- repeat the adopted long title, short title, and publication-topic set, and keep the complete 10+10+10 candidate document linked;
- show the adopted publication topics as one copy-ready line;
- expose missing or low-confidence items;
- report Feishu state when enabled;
- distinguish completed production from optional draft upload, pending publication authorization, automatic publication results, and analytics review.
