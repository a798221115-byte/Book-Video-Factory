# Full production workflow

## Contents

- 1. Intake, Feishu, and workspace
- 2. Pre-G01 reference acquisition and diagnosis
- 2.1. Explicit direct-final-script branch
- 3. G01 automatically locked source package
- 4. G02 derivative copy and automatic titles
- 5. G03 storyboard and style sample
- 6. G04 remaining images and review
- 7. C01 and V01 compliance, narration, and timing
- 8. G05 technical post-production
- 9. C02 and G06 automatic delivery registration
- 10. G07–G09 platform draft upload, authorized automatic publication, and review

## 1. Intake, Feishu, and workspace

Accept a supplied narration transcript, Douyin/video link, or book title as intake only by default. Route a usable supplied transcript to text intake; route a link without usable narration text to link intake. If both are present, text intake takes precedence and the link remains provenance metadata unless the user explicitly requests video verification. When the user explicitly marks a usable supplied narration as final, including with `成稿直出`, select the direct-final-script branch and count that instruction as G02 approval. Never infer image approval or authorization for external publication.

When Feishu sync is enabled:

1. Upsert the book project.
2. Initialize the required gate and system-node records.
3. Set Codex to executing before local work.
4. Sync every transition, artifact, wait state, failure, and validation result.

Create:

```text
work/YYYY-MM-DD-book-slug-NN/
  reference-YYYY-MM-DD.mp4
  video_clips/
    reference-metadata.json
    reference-audio-16k.wav
    raw-transcript-user.txt
    raw-transcript-whisper.txt
    reference-transcript.txt
    reference-copy-analysis.md
  script_sources.md
  script.txt
  recipe.json
  matches.json
  storyboard/
    storyboard.json
    prompts/
    images/
  material/
    fragmentNN/
  voice/
  render/
  cover/
```

Copy reusable media from `assets/`; never move originals.

### Reversible gates and rollback

Every user-facing gate must expose a return action. A return is a controlled workflow revision, not navigation-only UI:

1. preview the affected downstream nodes and ask for explicit confirmation;
2. preserve previous files, generated media, reports, and Codex task history for audit;
3. mark affected downstream artifacts and runs as superseded instead of deleting them;
4. reopen the selected gate with the latest confirmed content restored for editing;
5. clear dependent approvals and rerun every affected compliance check, title branch, timing step, image gate, render, or upload gate;
6. keep independent completed work when valid, such as retaining V01 narration when only a title changes;
7. warn that an existing platform draft or published post is an external side effect and will not be automatically deleted or withdrawn.

At minimum support returning to book identity, G01 sources, G02 copy, automatic long/short title and publication-topic selection, G03 style, G04 images, G05 post-production, G06 delivery registration, and G08 publication information.

Only create the raw transcript file that matches the actual intake source. Text intake does not create the MP4, WAV, or Whisper artifact; link intake does not create `raw-transcript-user.txt`.

## 2. Pre-G01: reference acquisition and diagnosis

When the user supplies a usable narration transcript:

1. Preserve the exact input immediately as `raw-transcript-user.txt`.
2. Write provider, acquisition time, optional source URL, character count, and SHA-256 to `reference-metadata.json`.
3. Create the simplified, minimally corrected `reference-transcript.txt`.
4. Do not download a linked video or run ASR unless the user explicitly requests verification.
5. Apply `dbs-content` to the corrected transcript.
6. Save the diagnosis as `reference-copy-analysis.md`.

## 2.1 Explicit direct-final-script branch

Use this branch only for a usable supplied narration plus explicit final-script intent such as `成稿直出`.

1. Preserve the exact supplied narration as `raw-transcript-user.txt` and record text-intake metadata.
2. Write the same exact narration to `script.txt`; do not run derivative drafting or rewrite the approved wording.
3. Keep the minimally corrected `reference-transcript.txt` separate for audit.
4. Record `G01=not_required_for_user_supplied_final_script`, `G02=approved_by_explicit_user_instruction`, and one completed human confirmation.
5. Run C01 against immutable `script.txt`. Stop only on a failing or high-risk result.
6. After C01 passes, immediately start the automatic 10+10+10 selection branch and the locked-narration branch.
7. Use real narration timing to build the semantic storyboard, generate and automatically inspect one G03 style sample, then generate the remaining images.
8. Stop at G04 for the user's all-image confirmation. After approval, continue through G05, C02, cover, and delivery without adding another production confirmation.

Do not require DBS or WeRead evidence to rewrite content because this branch performs no rewriting. Never describe the supplied narration as a verified book quotation. A missing exact edition may remain a later blocker for author typography, original-cover verification, C02, or delivery; disclose it when required instead of stopping image production early.

When the matching fixed intro already contains the meaning of the script's first lead-in, preserve `script.txt` and exclude only the duplicate lead-in from body narration. Start the body voice with `《书名》` and record the delivery-only adaptation in `voice/prosody-notes.md`.

When the user supplies a Douyin link without a usable transcript:

1. Run `scripts/download_douyin_tikhub.mjs`.
2. Require `TIKHUB_API_KEY`.
3. Save the video and metadata in the current work folder.
4. Stop on TikHub failure. Do not silently substitute another provider.
5. Extract audio and transcribe with the configured local Whisper workflow.
6. Preserve `raw-transcript-whisper.txt` before creating the simplified, minimally corrected `reference-transcript.txt`.
7. Apply `dbs-content` to the cleaned transcript.
8. Save the diagnosis as `reference-copy-analysis.md`.

The diagnosis must identify the hook, content promise, tension, information order, emotional curve, rhythm, ending device, reusable abstract framework, non-transferable wording, unverified claims, and copying risks.

Read `references/intake-copy-pipeline.md` for the artifact contract and templates.

## 3. G01: automatically locked source package

Use `weread-skills` to:

1. Confirm the exact title, author, translator, publisher, and edition.
2. Fetch the highest-count whole-book popular highlights.
3. Preserve each candidate sentence, chapter, and highlight count.
4. Record the WeRead deep link.

Write `script_sources.md` containing:

- the intake mode and its real source artifacts: user-text metadata and raw text path, or TikHub metadata and video/Whisper paths;
- reference transcript;
- DBS diagnosis;
- verified edition;
- the first 10 whole-book popular highlights in returned heat order, or every returned item when fewer than 10 exist;
- quotation boundaries;
- reference claims that WeRead does not verify.

On the normal derivative path, expose the source package in the workbench and lock the selected evidence when copy generation starts. Sync `G01=已锁定（自动）` and continue to the derivative-copy candidate. G01 is auditable and reversible but is not a separate human confirmation.

If TikHub is unavailable on link intake, or WeRead is unavailable on either path, expose that exact blocker. Do not silently replace either source.

## 4. First confirmation G02: derivative copy

Start after G01 evidence is verified and locked on the normal derivative path. Skip this section when explicit direct-final-script mode has already recorded G02 approval.

Create the narration by:

1. retaining the verified abstract framework from the reference diagnosis;
2. replacing reference wording, examples, and claims with verified WeRead ideas and original reflection;
3. using three to six representative source ideas or short quotations;
4. building a restrained emotional through-line;
5. writing roughly 50–55 seconds before real voice timing;
6. auditing distinctive overlap against the reference transcript.

Because the fixed intro says `我们今天分享的是`, start the body with:

```text
《书名》
```

Use source wording sparingly. Never fabricate, silently paraphrase, or misattribute quotations. Distinguish direct quotations from original expression in the review handoff.

Save the draft as `script.txt`, sync `G02=待确认`, set the project to waiting for copy approval, and stop. Do not create a storyboard or image before explicit approval.

## 4.1 Automatic title generation and selection

Start only after explicit G02 approval. The user's explicit direct-final-script instruction counts as G02 approval when it accompanies a usable supplied narration.

1. On link intake, read the original Douyin title from TikHub metadata. On text intake, use an explicitly supplied source title when available; otherwise record `sourceTitleMode=user_transcript` and use the reference opening only as a rhythm cue.
2. Use `dbs-xhs-title` as a formula matcher. Select 5–8 formulas across at least three psychological trigger categories, then combine 2–3 distinct formula angles in each long-title candidate rather than relying on one template alone.
3. Generate exactly 10 WeChat Channels long titles. Every candidate must contain 20–40 Chinese Han characters; punctuation, Latin letters, digits, and spaces do not count toward that range. Use the source title only as a cue for oral rhythm, emotional strength, and punctuation—not as a length constraint—and do not copy its distinctive wording, examples, or sentence sequence.
4. Give each long title 3–6 unique, natural-language keywords grounded in the verified book title or theme, confirmed narration, audience problem, emotion, action, or outcome. Vary the formula combination, keyword set, opening structure, and benefit/conflict emphasis across `L01–L10`. Reject repeated keywords, stacked synonyms, duplicated clauses, unsupported promises, or titles that read like search tags. For every candidate, record `combinedFormulaIds`, trigger categories, formula templates, original proven examples, `keywordSet`, `variationDimensions`, and a one-sentence recommendation reason.
5. Save the candidates and source-title evidence to `titles.json`, automatically adopt the first recommendation, and retain all 10 for optional rollback/reselection.
6. Generate exactly 10 short titles from the adopted long title. Every candidate must contain at least 8 Chinese Han characters; punctuation, Latin letters, digits, and spaces do not count toward that minimum. Prefer 8–12 Chinese characters, cap the complete title at 16 characters, and regenerate any candidate below the minimum before assigning `S01–S10` or adopting `S01`.
7. Save the short candidates, automatically adopt the first recommendation, and retain all 10.
8. Generate exactly 10 publication-topic sets from the verified book identity, confirmed narration, and adopted long title. Number them `T01–T10`, automatically adopt `T01`, and save every set plus its one-sentence recommendation reason in `titles.json`.
9. Each topic set must contain exactly seven unique hashtags separated by one space and no commas. Always include `#读书`, `#好书推荐`, and the resolved `#《书名》`; select the other four from narration-relevant themes. `T01` defaults to `#读书 #好书推荐 #人生感悟 #认知成长 #自我提升 #文字的力量 #《书名》` when those themes fit. Resolve `书名` from the verified edition and never leave a placeholder in a deliverable.
10. Immediately send one non-blocking selection feedback message in the current conversation after all three candidate sets exist. Attach or link the current `titles.json`, then visibly list all 10 long titles as `L01–L10`, all 10 short titles as `S01–S10`, and all 10 topic sets as `T01–T10`. Mark all three automatically adopted items inline.
11. End the message with the exact reselection syntax: `长标题 L04，短标题 S07，话题 T03`. State that selecting only a different short title or topic set applies immediately; selecting a different long title invalidates both the current short-title set and topic-set candidates, regenerates 10 of each from that long title, and sends a complete replacement file plus full replacement lists.
12. Never send only the adopted items, candidate counts, a file path, a Feishu update, a log line, or a workbench-only state. Do not require the user to ask for expansion. Do not defer the complete lists to final delivery, and do not wait for confirmation before continuing the selection-independent production branch.
13. If long candidates are regenerated or the adopted long title changes, clear short-title and topic-set candidates and regenerate both automatic selections. Send the complete replacement 10+10+10 feedback, mark the earlier file and adopted trio superseded, and preserve both versions for audit.

At minimum, `titles.json` must store `topicCandidates` as 10 objects with `id`, `topics`, `line`, and `recommendationReason`, plus `adoptedTopicId`, `adoptedTopics`, and the copy-ready `adoptedTopicLine`. The `topics` array and `line` must represent the same seven resolved hashtags in the same order.

The workbench UI and the server-side image executor must both reject image generation until one long title, one short title, and one publication-topic set are automatically adopted or explicitly reselected.

## 5. Gate G03: storyboard and exactly one style sample

Start only after explicit G02 approval and completion of automatic long/short title and publication-topic selection. Direct-final-script approval satisfies the G02 condition.

Split the approved copy by meaningful changes in idea, action, scene, emotion, or narrative function. Let the copy determine the total number of visual beats; do not set a default range or derive a fixed count from video length.

Use roughly eight seconds per image only as a soft pacing review after semantic segmentation. Dense information, a new action, or a fast emotional turn may justify a shorter image; a complete causal statement, contrast, sustained emotion, or single narrative unit may justify a longer image. Never cut a complete semantic unit to hit eight seconds, and never add repetitive or low-value beats to reach a target count.

Record:

- narration range;
- visual subject and action;
- `subjectMode`: `character`, `space`, `landscape`, `object`, `architecture`, or `weather`;
- `characterNecessity`: `required`, `helpful`, or `not_needed`;
- `characterJustification` when `characterNecessity=required`;
- `faceOrientation`: `front`, `three_quarter_front`, `side_profile`, `three_quarter_back`, `back_view`, or `not_applicable`;
- `cameraDistance`: `close_up`, `medium_portrait`, `environmental_portrait`, `wide_empty_shot`, `object_detail`, or `landscape`;
- `narrativeFunction`: the independent semantic job performed by the frame;
- composition safe zones;
- generated-image prompt;
- continuity rules;
- actual voice start/end after narration exists.

Run subject-mix and sequence-repetition audits before generating the G03 sample. A person is not the default subject: use space, scenery, architecture, weather, or meaningful objects when they carry the narration more precisely. Across character frames, vary front, three-quarter, side, and back orientations; do not repeat one orientation across three consecutive character shots or let side profiles dominate. When semantically supported, include a genuine empty, object, architecture, weather, or landscape shot with its own narrative function. If every scene uses a character, replan suitable scenes as non-character shots unless every character scene has a narration-specific justification. Do not enforce a fixed quota and do not add unrelated scenery as filler.

Generate exactly one representative original 9:16 style sample with the locked `warm-cinematic-literary-life-v1` profile and bundled anchor from `assets/default-config.json`, unless the user explicitly requested a different visual direction. Pass the bundled anchor as style-conditioning evidence while explicitly forbidding its montage layout, exact compositions, poses, locations and object placement. Treat other extracted reference frames as analysis evidence only. Run automatic full-frame, anatomy, relevance, natural-skin, warm-golden-light, muted-palette, grain/haze, identity/wardrobe, flat-block, composition-copy and non-commercial-retouching QA. Record the anchor path and SHA-256 in the G03 report. A passing sample becomes the style baseline and immediately unlocks the remaining images.

## 6. Gate G04: remaining images and review

Start only after the G03 sample passes automatic QA.

Generate remaining images with the adopted style, palette, identity, period, light, and composition rules. Inspect:

- conformance to `warm-cinematic-literary-life-v1`, including the bundled anchor, low-saturation warm-neutral palette, low-angle natural golden light, long soft shadows, luminous haze, realistic unretouched skin/materials, subtle grain and no recognizable anchor-composition copy;
- recurring-character face, age, shoulder-length softly wavy black hair, oatmeal-beige long coat and slate-blue-gray scarf continuity when that default protagonist is active;
- anatomy at full frame and enlarged detail;
- semantic relevance;
- character continuity;
- duplicate or near-duplicate composition;
- title and caption safe areas;
- visual grammar variety;
- face-orientation and camera-distance diversity, with no side-profile-dominated sequence;
- appropriate empty, object, architecture, weather, or landscape shots when semantically supported;
- subject-mix audit result and justification for any all-character storyboard.
- default avoidance of mirrors and human-bearing reflections;
- when a reflection was explicitly requested, consistency of identity, pose, gaze, limb count, handedness, object placement, perspective, and lighting.

Sync `G04=待确认` and stop for all-image approval.

## 7. C01 and V01: compliance, early narration, and real timing

Immediately after explicit G02 approval, including direct-final-script approval, run `media-publish-check` against the approved copy. Save the immutable input, risk level, risky sentences, categories, suggestions, timestamp, and raw report. A failed or high-risk report blocks titles, voice, images, and post-production. Never overwrite the approved copy.

After C01 passes, start two branches in parallel:

- automatic long-title generation/adoption followed by short-title and publication-topic-set generation/adoption;
- V01 locked narration, measured segment timing, `voice/` artifacts, `recipe.json`, storyboard timing fields, and caption timing basis.

G03 cannot start until both branches finish. The measured narration is the timing authority; roughly eight seconds per image remains only a semantic pacing check.

## 8. Gate G05: technical post-production

Start only after all images are explicitly approved. Reuse V01 output unless the approved copy changed.

Resolve the production variant:

- If the user has not selected a variant, resolve `female` immediately; do not add a voice-selection approval gate.
- `female` pairs `female-book-narrator-locked-v1` with the female fixed intro and is the default production variant.
- `male` pairs `male-podcast-locked-v2` with the male fixed intro and is selected only when the user explicitly requests it.

Validate the fixed-intro hash and duration. Stop on a mismatch unless the user explicitly requests cross-pairing.

Generate segmented speech with the locked preset and fixed seed. Preserve native speed and pitch. Measure completed audio and treat it as the timing authority.

### Captions

- Create paired Chinese and English SRT files with identical card boundaries.
- Keep each card one line.
- Remove `，。` from Chinese display captions.
- Do not duplicate the fixed intro sentence.
- Begin body time zero with the book title.

### Body render

Render approved images at 1080x1920, 60fps with deterministic title, author, and captions. Establish a continuous time base before subtitle burn-in.

### Intro and final mix

Prepend the matched fixed intro and preserve its audio. Mix BGM at 0.63 and duck it under speech. End with a one-second BGM fade-out aligned to narration.

Use `assets/default-config.json` and `scripts/finalize_mix.py`.

Validate content, timing, audio peaks, paths, anatomy, typography, and media ranges. Sync `G05=已通过` only after technical validation passes.

## 9. C02 and G06: automatic delivery registration and cover

Verify the exact original cover from WeRead or another authoritative public listing. Do not substitute a similar edition.

Create one separate 1080x1260 cover with `scripts/compose_wechat_cover.py`. Preserve the original cover artwork and typography. Generated imagery may be used only around it.

Run C02 across copy/captions, images/cover, final video/audio, technical properties, copyright/AI-label considerations, and platform-fit items. Save the full report. High-risk findings block automatic delivery registration and platform draft upload; any correction requires a new C02 report. State clearly that this is automated risk assessment and not a platform guarantee.

After C02 passes, automatically register and expose:

- opening audio and transition;
- first body sentence;
- voice clarity and music balance;
- caption timing and obstruction;
- image continuity and anatomy;
- final fade-out;
- cover edition, legibility, safe area, and separation from the MP4;
- `titles.json` with all 10 long candidates, all 10 short candidates, all 10 publication-topic sets, formula traceability, recommendation reasons, the adopted trio, and resolved adopted publication topics.

Register `titles.json` as a formal delivery artifact in `delivery-manifest.json`. In the final conversation handoff, provide its clickable path and repeat the adopted long title, short title, and copy-ready adopted topic line. Do not call delivery complete if the manifest entry, user-facing selection-document link, complete 10+10+10 candidates, or resolved adopted topics are missing.

Do not add a third production confirmation. The user may explicitly roll back any listed artifact for revision.

## 10. G07–G09: platform draft upload, authorized automatic publication, and review

After C02 passes and delivery artifacts are registered, expose two separate distribution actions:

1. G07 is the compatible WeChat Channels draft action. It requires an explicit draft-upload request and a selected logged-in account, then calls the pinned `dreammis/social-auto-upload` adapter with `is_draft=True`. It never clicks formal publish.
2. G08 is formal multi-platform distribution. It remains locked until the user selects one or more logged-in Douyin/WeChat Channels accounts and explicitly confirms the irreversible publication action for this task. A prior copy approval, image approval, default account, global preference, completed render, or draft request is not publication authorization.
3. After G08 authorization, publish the final video and platform-appropriate metadata automatically. Use the standalone 1080x1260 cover only for WeChat Channels; do not force that asset into Douyin's incompatible cover slot.
4. Use one deterministic idempotency key per task/platform/account/final-video version. On retry, return successful existing records and retry only missing or failed targets. Never create an uncontrolled duplicate.
5. Persist `platform`, account, authorization time, upload time, publication time, final status, error, and available platform work ID/URL for every target. A mixed result is `publication_partial_failure`; expose the failed targets and keep successful external publications intact.
6. G09 accepts separate 24h, 72h, and 7d snapshots for successfully published records, derives engagement/share/save/follow conversion rates, and writes a review plus next-video experiment.

The initial supported formal-publication targets are `douyin` and `weixin_channels`. Other `social-auto-upload` platforms may be added only after their adapter, account preflight, metadata mapping, success detection, idempotency behavior, and validation are implemented; “等平台” is not permission to guess an unsupported uploader.

Every authorization, transition, wait state, retry, partial failure, error, and artifact must update the same persistent Codex task and the workbench workflow run.
