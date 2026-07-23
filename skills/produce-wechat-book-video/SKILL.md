---
name: produce-wechat-book-video
description: Produce and Feishu-track a gated WeChat Channels vertical book video from a Douyin reference link, book title, selected book, or draft topic. Use when the user asks to make or continue a 视频号图书号/读书视频, including TikHub reference download, Codex transcription, dbs-content benchmark-copy diagnosis, WeRead popular-highlight sourcing, derivative-copy approval, one-style-image approval, remaining storyboard images, locked narration, bilingual captions, fixed intro, final MP4, editable Jianying draft, standalone cover, and per-step Feishu updates.
---

# Produce WeChat Book Video

Treat a Douyin link or book title as intake only. Execute through the next mandatory confirmation gate, sync the actual state to Feishu when enabled, and stop until the user explicitly confirms.

## Load only what is needed

- Read `references/workflow.md` before full production.
- Read `references/intake-copy-pipeline.md` before downloading a Douyin reference, extracting its copy, diagnosing its structure, or writing derivative copy.
- Read `references/creative-standards.md` before writing copy or generating images.
- Read `references/technical-spec.md` before narration, rendering, mixing, validation, or Jianying generation.
- Read `references/feishu-integration.md` when a Feishu binding exists or the task originates from Feishu.
- Read `references/cover-style-spec.md` before creating or revising a WeChat Channels cover.
- Use `assets/default-config.json` unless the user explicitly overrides it.

## Required outcome

Deliver:

1. A source package containing TikHub metadata, raw and cleaned reference transcripts, a `dbs-content` diagnosis, and verified WeRead popular highlights.
2. An evidence-backed one-minute Chinese derivative narration that keeps the approved abstract framework without copying the reference wording.
3. A storyboard and original 9:16 background images.
4. Locked female narration by default, Chinese and English one-line captions, the matched female fixed intro with original audio, and ducked BGM with a one-second fade-out. Produce the locked male variant only when the user explicitly requests it.
5. A 1080x1920, 60fps review MP4.
6. A new editable Jianying draft with internalized media.
7. A validation report that exposes missing or low-confidence items.
8. A separate 1080x1260 WeChat Channels cover using the verified original book cover.

## Mandatory blocking order

Enforce this exact sequence:

1. TikHub downloads the supplied Douyin reference.
2. Codex/local Whisper extracts the reference copy and performs only minimal correction.
3. `dbs-content` diagnoses the hook, content structure, emotional progression, language mechanisms, and reusable framework.
4. `weread-skills` verifies the exact edition and fetches whole-book popular highlights.
5. Present the transcript, diagnosis, and WeRead evidence as one source package; wait for explicit G01 approval.
6. Fuse the approved abstract framework with approved WeRead evidence and original reflection to create derivative copy; wait for explicit G02 approval.
7. After G02 approval, use the TikHub Douyin title and `dbs-xhs-title` to generate exactly 10 traceable long-title candidates; wait for the user to select one.
8. Only after a long title is selected, generate exactly 10 short-title candidates from that selected long title; wait for the user to select one.
9. Only after both titles are confirmed, create exactly one representative 9:16 style sample; wait for explicit G03 approval.
10. Generate the remaining images; inspect them and wait for explicit G04 approval.
11. After all images are approved, create the default locked female narration, captions, review MP4, Jianying draft, validation report, and separate cover. Switch to the locked male variant only on an explicit user request.
12. Wait for explicit combined G06 approval of the MP4, draft, and cover; then stop the default workflow.

Never infer approval from a supplied title or link, Agent self-review, local files, downstream artifacts, or Feishu status.

## Reference acquisition and evidence rules

- Use `scripts/download_douyin_tikhub.mjs` for every supplied Douyin link.
- Require `TIKHUB_API_KEY`; allow `TIKHUB_BASE_URL` only as an explicit environment override.
- Never silently substitute yt-dlp, browser capture, mock data, or another provider. If TikHub is unavailable, expose the blocker and stop the reference-dependent path unless the user explicitly authorizes an alternative.
- Save the video as `reference-YYYY-MM-DD.mp4` and provider evidence as `video_clips/reference-metadata.json`.
- Extract audio with FFmpeg and transcribe with the configured local Whisper workflow.
- Preserve the untouched ASR result as `video_clips/raw-transcript-whisper.txt` before cleanup.
- Convert the working transcript to simplified Chinese and save it as `video_clips/reference-transcript.txt`.
- Correct only context-supported homophones, near-homophones, segmentation, punctuation, and obvious book-title errors. Do not rewrite, expand, reorder, or improve the reference copy during transcription.
- Save the diagnostic result as `video_clips/reference-copy-analysis.md`.
- Use `dbs-content` only as a diagnostic lens; do not ask it to write the derivative narration.

## Source separation and derivative-copy rules

- Treat the reference video and WeRead as separate evidence classes.
- Never present a reference-video sentence as a book quotation unless WeRead independently verifies it.
- Save book metadata, candidate highlights, chapter names, highlight counts, selected excerpts, and quotation boundaries in `script_sources.md`.
- At G01, show:
  - the cleaned reference transcript;
  - the DBS diagnosis;
  - the exact WeRead title, author, translator, publisher, edition, and deep link;
  - ranked popular highlights with chapter names and counts;
  - any reference claim that WeRead does not verify.
- At G02, keep only the approved abstract framework: hook type, tension, information order, emotional curve, rhythm, and closing function.
- Replace the reference video's wording, examples, claims, and distinctive expressions with verified WeRead ideas plus original reflection.
- Use direct quotations sparingly and label them. Never invent, silently paraphrase, or misattribute a quotation.
- Before presenting the draft, compare it with the reference transcript and rewrite distinctive overlaps that are not necessary book titles or verified short quotations.

## Feishu and workspace

- Inspect `AGENTS.md`, fixed assets, voice presets, the Feishu binding, and the supplied reference before production.
- Create or claim the Feishu project and initialize eight gate records before local work when Feishu sync is enabled.
- Create the dated work folder with `scripts/init_project.py` or the equivalent stable structure.
- After every transition, wait state, failure, or completed artifact, call `scripts/sync_feishu_pipeline.mjs`.
- A Feishu failure must be visible but must not corrupt local files.

Use this artifact layout:

```text
work/YYYY-MM-DD-book-slug-NN/
  reference-YYYY-MM-DD.mp4
  video_clips/
    reference-metadata.json
    reference-audio-16k.wav
    raw-transcript-whisper.txt
    reference-transcript.txt
    reference-copy-analysis.md
  script_sources.md
  script.txt
  storyboard/
    storyboard.json
    prompts/
    images/
  material/
  voice/
  render/
  jianying_draft/
  cover/
```

Copy reusable media from `assets/`; never move originals.

## Image gates

- Do not create a storyboard or any image before G02 copy approval.
- After G02, block image generation until title selection is complete:
  - match 5–8 `dbs-xhs-title` formulas spanning at least three trigger categories;
  - generate exactly 10 long titles that imitate the Douyin source title's length, oral rhythm, emotional strength, and punctuation without copying distinctive wording;
  - preserve formula ID, trigger, template, original proven example, and recommendation reason for every long-title candidate;
  - stop for one explicit long-title selection;
  - generate exactly 10 short titles from the selected long title only, normally 4–12 Chinese characters and never more than 16;
  - stop for one explicit short-title selection;
  - regenerating or changing the long title invalidates all short-title candidates and approval.
- Generate exactly one style sample at G03.
- Generate remaining images only after explicit style approval.
- Derive the total storyboard-image count from the approved copy. Do not set a default, minimum, maximum, or one-minute image count.
- Split first at meaningful changes in idea, action, scene, emotion, or narrative function. Use roughly eight seconds per image only as a soft pacing check after semantic segmentation; allow shorter or longer holds when the copy requires them.
- Never split a complete causal statement, contrast, or emotional unit merely to approach eight seconds, and never add filler images to reach a target count.
- Keep generated backgrounds free of text; add title, author, column, and captions deterministically.
- Keep the upper title-safe region compact, normally no more than 15% of frame height, while continuing low-contrast environmental detail through it.
- Vary visual grammar across people, empty environments, objects, architecture, weather, and landscapes.
- Inspect every visible head, neck, torso, limb, joint, hand, finger, hip, knee, and foot at full frame and enlarged scale. Regenerate or edit anatomy defects; never hide them with crops, text, or motion.

## Narration, captions, render, and draft

- Default to `female-book-narrator-locked-v1`; use `male-podcast-locked-v2` only when explicitly requested. When the user is silent about the variant, resolve `female` without adding another approval gate.
- Resolve the production variant before post-production and pair it with the matching fixed intro. Stop on a mismatch unless the user explicitly requests cross-pairing.
- Preserve the selected preset's reference mode, reference audio, prompt transcript, CFG 2.0, 20 inference steps, seed 42 for every segment, native 1.00x speed, pauses, and mastering chain.
- The fixed intro already says `我们今天分享的是`; do not repeat it in body narration or captions.
- Start body narration with `《书名》`.
- Treat completed narration duration as the timing authority.
- Keep Chinese and English caption cards paired, synchronized, and one line each.
- Remove Chinese comma and full-stop characters `，。` from display captions.
- Use the standard typography baseline unless explicitly changed: book title 88, author 48, Chinese caption 58, English caption 30. Use light orange for the title and light blue for the author.
- Keep title, author, Chinese captions, and English captions as editable Jianying text tracks.
- Preserve intro audio. Mix intro/body BGM at 0.63, duck under speech, and fade out over the final second with narration.
- Create a new Jianying draft. Copy media into it, use existing absolute paths, and never overwrite an existing draft.
- Keep content ID, metadata ID, and root-index ID identical and unique in the generated draft bundle.

## Cover and workflow endpoint

- Verify the original edition cover from WeRead or another authoritative public listing.
- Create one separate 1080x1260 cover with `scripts/compose_wechat_cover.py`.
- Preserve the original cover artwork and typography; never ask an image model to redraw it.
- Keep the cover separate from the MP4.
- After explicit combined G06 approval, end the default workflow. Publishing, embedding, distribution, and archive require a separate explicit request and use G07/G08.

## Supporting skills and tools

- Use `scripts/download_douyin_tikhub.mjs` for Douyin acquisition.
- Use Codex/local Whisper for transcription and minimal correction.
- Use `dbs-content` for benchmark-copy diagnosis.
- Use `weread-skills` for edition verification and popular highlights.
- Use `imagegen` for original storyboard images and revisions.
- Use local VoxCPM for locked narration.
- Run `scripts/resolve_production_variant.py` before G05.
- Use `scripts/generate_voice_sample.py` for deterministic preset tests.
- Use FFmpeg for assembly, audio processing, subtitles, and validation.
- Generate Jianying JSON only from an inspected readable local template.

## Completion gate

Do not call the task complete until:

- TikHub metadata, raw ASR, cleaned transcript, DBS diagnosis, and WeRead source evidence exist.
- The derivative copy is traceable to approved evidence and does not copy distinctive reference wording.
- The fixed intro is present and audible; the first body line and caption are the book title.
- BGM is audible at 63%, ducks under speech, and fades out over the final second.
- The MP4 is 1080x1920, 60fps, H.264/AAC.
- Captions are synchronized, one line, unobstructed, and editable in Jianying.
- Every visible person passes anatomy inspection.
- The Jianying draft opens from a unique folder and all media paths exist.
- The validation report passes or lists unresolved issues.
- The separate 1080x1260 cover preserves the verified original edition and is explicitly approved.
- Feishu project, gate, and task records reflect the actual local state and evidence paths.
