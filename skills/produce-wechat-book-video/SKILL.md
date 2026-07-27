---
name: produce-wechat-book-video
description: Produce, review, draft-upload, and track a two-confirmation WeChat Channels vertical book video from active WeRead topic discovery, a Douyin reference link, book title, or draft topic. Includes evidence sourcing, compliance checks, early real-timeline narration, automated titles and style continuation, image review, post-production, draft-only WeChat Channels upload, human publication confirmation, and 24h/72h/7d review.
---

# Produce WeChat Book Video

Treat a Douyin link or book title as intake only. The normal production path has exactly two blocking human confirmations: the derivative narration copy, then all storyboard images. Sync actual state to Feishu when enabled. Book ambiguity, compliance blocks, missing required tools/assets, and explicit rollback may pause as exceptions; formal publication remains separately human-authorized.

Every confirmation gate must remain reversible from the workbench. Before returning to an earlier gate, show which downstream approvals and artifacts will become stale. Preserve prior files and audit history, mark downstream records as superseded instead of deleting them, reopen the selected gate for editing, and require all affected checks and confirmations to run again. Never imply that returning locally deletes an already uploaded draft or retracts a published platform post.

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
9. Machine-readable C01 copy-compliance and C02 pre-publication review reports.
10. A draft-only WeChat Channels upload record, human publication record, and 24h/72h/7d metric snapshots when publication is requested.

## Mandatory two-confirmation order

Enforce this exact sequence. A workbench project reuses one persistent Codex task/thread across every node:

1. G00 selects a topic from real WeRead recommendations/bookshelf/highlights/search or accepts a supplied Douyin reference. Never use simulated WeRead candidates.
2. TikHub downloads a supplied Douyin reference when present.
3. Codex/local Whisper extracts the reference copy and performs only minimal correction; `dbs-content` diagnoses reusable mechanisms.
4. `weread-skills` verifies the exact edition and fetches whole-book popular highlights.
5. Build and expose the transcript, diagnosis, and WeRead evidence as one traceable G01 source package. Lock the selected evidence when generating the copy; G01 is not a separate human confirmation.
6. Create derivative copy from verified evidence and original reflection; wait for the first explicit human confirmation at G02.
7. Run C01 with `media-publish-check`. Preserve the approved original. A block prevents titles, narration, images, and post-production until the user approves a revision and it passes again.
8. After C01 passes, run two branches in parallel: automatically generate 10 traceable long-title candidates, adopt the first recommendation, generate 10 short-title candidates from it, adopt the first recommendation; and V01 locked narration → measured segment timing → `recipe.json`/storyboard/caption timeline. Preserve all candidates and allow explicit rollback/reselection.
9. G03 starts only after automatic title selection and V01 real timing are complete. Generate exactly one representative 9:16 style sample, run automatic visual QA, adopt it as the style baseline, and continue without a human stop.
10. Generate and inspect the remaining images; wait for the second explicit human confirmation at G04.
11. Create captions, HyperFrames review MP4, editable Jianying draft, validation report, and separate cover using the existing real voice timeline.
12. After the second confirmation, automatically create captions, review MP4, editable Jianying draft, validation report, and separate cover using the existing real voice timeline.
13. Run C02 full media review. High-risk findings block automatic delivery registration and G07 until corrected and re-reviewed. After C02 passes, automatically register the MP4, draft, cover, and reports; do not add a third production confirmation.
14. In G07, use the pinned `dreammis/social-auto-upload` adapter in draft-only mode. Never click or automate formal publication.
15. In G08, record the human-confirmed account, work ID, URL, and actual publication time.
16. In G09, store 24h, 72h, and 7d metric snapshots and produce a traceable review with the next-video experiment.

Never infer either of the two human confirmations from a supplied title or link, Agent self-review, local files, downstream artifacts, or Feishu status.

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
- In the G01 source package, expose:
  - the cleaned reference transcript;
  - the DBS diagnosis;
  - the exact WeRead title, author, translator, publisher, edition, and deep link;
  - ranked popular highlights with chapter names and counts;
  - any reference claim that WeRead does not verify.
- At G02, keep only the verified abstract framework: hook type, tension, information order, emotional curve, rhythm, and closing function.
- Replace the reference video's wording, examples, claims, and distinctive expressions with verified WeRead ideas plus original reflection.
- Use direct quotations sparingly and label them. Never invent, silently paraphrase, or misattribute a quotation.
- Before presenting the draft, compare it with the reference transcript and rewrite distinctive overlaps that are not necessary book titles or verified short quotations.

## Feishu and workspace

- Inspect `AGENTS.md`, fixed assets, voice presets, the Feishu binding, and the supplied reference before production.
- Create or claim the Feishu project and initialize the required gate and system-node records before local work when Feishu sync is enabled.
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
- After the first G02 confirmation, block image generation until automatic title selection is complete:
  - match 5–8 `dbs-xhs-title` formulas spanning at least three trigger categories;
  - generate exactly 10 long titles that imitate the Douyin source title's length, oral rhythm, emotional strength, and punctuation without copying distinctive wording;
  - preserve formula ID, trigger, template, original proven example, and recommendation reason for every long-title candidate;
  - automatically adopt the first recommended long title while preserving all candidates for optional reselection;
  - generate exactly 10 short titles from the adopted long title only, normally 4–12 Chinese characters and never more than 16;
  - automatically adopt the first recommended short title while preserving all candidates;
  - regenerating or changing the long title invalidates all short-title candidates and the previous automatic selection.
- Generate exactly one style sample at G03.
- Run automatic full-frame and anatomy QA on the style sample, adopt a passing sample as the style baseline, and immediately continue to the remaining images.
- Derive the total storyboard-image count from the approved copy. Do not set a default, minimum, maximum, or one-minute image count.
- Split first at meaningful changes in idea, action, scene, emotion, or narrative function. Use roughly eight seconds per image only as a soft pacing check after semantic segmentation; allow shorter or longer holds when the copy requires them.
- Never split a complete causal statement, contrast, or emotional unit merely to approach eight seconds, and never add filler images to reach a target count.
- Keep generated backgrounds free of text; add title, author, column, and captions deterministically.
- Never generate a large pure-color, near-solid, or empty gradient block anywhere in the frame, including the title band, caption safe area, corners, and lower frame. Every low-information region must retain scene-coherent low-contrast texture, spatial depth, environmental detail, or natural light and shadow.
- Reserve a low-interference fixed-header band at roughly 18%–30% of frame height for `读书分享`, the book title, and the author/translator line. Continue low-contrast environmental detail through this band instead of creating a flat empty block, and keep faces, hands, and key objects outside it when practical.
- Do not treat a person as the default subject of every image. Before writing prompts, give every storyboard scene a machine-readable `subjectMode` (`character`, `space`, `landscape`, `object`, `architecture`, or `weather`) and `characterNecessity` (`required`, `helpful`, or `not_needed`). A scene with `characterNecessity=required` must include a short `characterJustification`.
- Vary visual grammar across character action, meaningful empty space, objects, architecture, weather, and natural landscapes. Prefer a non-character image whenever space, light, scenery, architecture, weather, or a meaningful object expresses the narration more precisely than a person.
- Run a subject-mix audit before G03 generation. An all-character storyboard is a review warning and must be replanned by converting suitable scenes to space, landscape, object, architecture, or weather shots unless every character scene has a narration-specific justification. Do not impose a fixed quota or insert unrelated scenery merely to satisfy variety.
- Character continuity applies only when the recurring person appears. Preserve style, palette, period, and light across non-character scenes; never add a decorative person solely to maintain continuity.
- Avoid mirrors and human-bearing reflections by default. This includes reflective glass, water, polished metal, screens, framed reflective surfaces, and any composition that duplicates a person through reflection. Express self-observation with non-reflective actions, posture, journals, spaces, light, or meaningful objects unless the user explicitly requests a mirror or reflection.
- If the user explicitly requests a mirror or human reflection, add a reflection-consistency audit covering identity, pose, gaze, limb count, handedness, object placement, perspective, and scene lighting. Any mismatch is a release blocker: regenerate or edit the image, and never hide the defect with cropping, captions, blur, or motion.
- Include the default mirror/reflection prohibition in every character-image prompt and negative prompt.
- Inspect the full frame at G03 and every G04 image specifically for pure-color or visually inactive flat blocks. Reject and regenerate any failing image; do not hide the defect with cropping, captions, title cards, blur, or motion.
- Inspect every visible head, neck, torso, limb, joint, hand, finger, hip, knee, and foot at full frame and enlarged scale. Regenerate or edit anatomy defects; never hide them with crops, text, or motion.

## Narration, captions, render, and draft

- Start locked narration immediately after C01 passes, in parallel with automatic title generation and selection. Persist each segment's measured start/end and do not regenerate it merely because images are not ready.
- Apply exactly one still-image motion to each storyboard image: centered zoom-out from 120% to 100%, centered zoom-in from 100% to 120%, fixed-120% left-to-right pan, or fixed-120% right-to-left pan. Never combine zoom and pan on the same image or reverse direction inside a shot.
- Assign motions with reproducible pseudo-random selection and exclude the immediately previous motion from the next shot's candidates, so adjacent images do not repeat the same effect.
- Normalize each motion across the image's actual narration-aligned hold. Use the approved slow 8-second reference pace, monotonic smoothstep easing, 60fps, and 2x supersampled motion before downscaling to delivery size to suppress pixel stepping and shake.
- Default to `female-book-narrator-locked-v1`; use `male-podcast-locked-v2` only when explicitly requested. When the user is silent about the variant, resolve `female` without adding another approval gate.
- Resolve the production variant before post-production and pair it with the matching fixed intro. Stop on a mismatch unless the user explicitly requests cross-pairing.
- Preserve the selected preset's reference mode, reference audio, prompt transcript, CFG 2.0, 20 inference steps, seed 42 for every segment, native 1.00x speed, pauses, and mastering chain.
- The fixed intro already says `我们今天分享的是`; do not repeat it in body narration or captions.
- Start body narration with `《书名》`.
- Treat completed narration duration as the timing authority.
- Keep Chinese and English caption cards paired, synchronized, and one line each.
- Remove Chinese comma and full-stop characters `，。` from display captions.
- Use the standard typography baseline unless explicitly changed: book title 88, author 48, Chinese caption 58, English caption 30. Use light orange for the title and light blue for the author.
- Treat `读书分享`, the book title, and the author/translator line as one fixed-header group. Do not place this group tight against the top edge. Compared with the legacy top-aligned layout, move the complete group downward by approximately 15% of the 1920px canvas height (about 288px), normally occupying the 18%–30% vertical band. Preserve the group's internal order and spacing; allow only small subject-aware adjustments, and verify the placement on sampled frames before delivery.
- Keep title, author, Chinese captions, and English captions as editable Jianying text tracks.
- Preserve intro audio. Mix intro/body BGM at 0.63, duck under speech, and fade out over the final second with narration.
- Create a new Jianying draft. Copy media into it, use existing absolute paths, and never overwrite an existing draft.
- Keep content ID, metadata ID, and root-index ID identical and unique in the generated draft bundle.

## Cover, review, draft upload, and workflow endpoint

- Verify the original edition cover from WeRead or another authoritative public listing.
- Create one separate 1080x1260 cover with `scripts/compose_wechat_cover.py`.
- Preserve the original cover artwork and typography; never ask an image model to redraw it.
- Keep the cover separate from the MP4.
- Run C02 after G05 and label its output as automated risk assessment, not a platform-approval guarantee.
- After C02 passes and delivery artifacts are automatically registered, upload only to the selected WeChat Channels account's draft box when the user explicitly requests draft upload and selects an account; use an idempotency key.
- Formal publication remains manual. Do not enter G09 until G08 records the real work ID, URL, account, and publication time.
- Save 24h/72h/7d snapshots without overwriting earlier snapshots and sync the derived review to Feishu when enabled.

## Supporting skills and tools

- Use `scripts/download_douyin_tikhub.mjs` for Douyin acquisition.
- Use Codex/local Whisper for transcription and minimal correction.
- Use `dbs-content` for benchmark-copy diagnosis.
- Use `weread-skills` for edition verification and popular highlights.
- Use `imagegen` for original storyboard images and revisions.
- Use local VoxCPM for locked narration.
- Use installed `media-publish-check` for C01 and C02.
- Use pinned `dreammis/social-auto-upload` only through the workbench draft-only adapter.
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
- The separate 1080x1260 cover preserves the verified original edition and passes automated validation.
- Feishu project, gate, and task records reflect the actual local state and evidence paths.
