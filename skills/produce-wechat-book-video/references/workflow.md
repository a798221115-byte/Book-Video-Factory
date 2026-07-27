# Full production workflow

## Contents

- 1. Intake, Feishu, and workspace
- 2. Pre-G01 reference acquisition and diagnosis
- 3. G01 automatically locked source package
- 4. G02 derivative copy and automatic titles
- 5. G03 storyboard and style sample
- 6. G04 remaining images and review
- 7. C01 and V01 compliance, narration, and timing
- 8. G05 technical post-production
- 9. C02 and G06 automatic delivery registration
- 10. G07–G09 draft upload, publication, and review

## 1. Intake, Feishu, and workspace

Accept a Douyin link or book title as intake only. Do not infer either required human confirmation or authorization for external publication.

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
  jianying_draft/
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

At minimum support returning to book identity, G01 sources, G02 copy, automatic long/short title selection, G03 style, G04 images, G05 post-production, G06 delivery registration, and G08 publication information.

## 2. Pre-G01: reference acquisition and diagnosis

When the user supplies a Douyin link:

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

- TikHub metadata and reference paths;
- reference transcript;
- DBS diagnosis;
- verified edition;
- ranked highlights;
- quotation boundaries;
- reference claims that WeRead does not verify.

Expose the source package in the workbench and lock the selected evidence when copy generation starts. Sync `G01=已锁定（自动）` and continue to the derivative-copy candidate. G01 is auditable and reversible but is not a separate human confirmation.

If TikHub or WeRead is unavailable, expose that exact blocker. Do not silently replace either source.

## 4. First confirmation G02: derivative copy

Start after G01 evidence is verified and locked.

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

Start only after explicit G02 approval.

1. Read the original Douyin title from TikHub metadata.
2. Use `dbs-xhs-title` as a formula matcher. Select 5–8 formulas across at least three psychological trigger categories.
3. Generate exactly 10 WeChat Channels long titles. Imitate the source title's approximate length (normally within about ±20%), oral rhythm, emotional strength, and punctuation pattern, but do not copy its distinctive wording, examples, or sentence sequence.
4. For every candidate, record the formula ID, trigger category, formula template, original proven example, and one-sentence recommendation reason.
5. Save the candidates and source-title evidence to `titles.json`, automatically adopt the first recommendation, and retain all 10 for optional rollback/reselection.
6. Generate exactly 10 short titles from the adopted long title. Prefer 4–12 Chinese characters and cap at 16.
7. Save the short candidates, automatically adopt the first recommendation, and retain all 10.
8. Save the publication topics `#读书 #好书推荐 #人生感悟 #认知成长 #自我提升 #文字的力量 #《书名》` in `titles.json`. Resolve `书名` from the verified edition for each project, for example `#《通透》`; never leave the placeholder in a deliverable.
9. Immediately send a non-blocking title feedback card in the current conversation. Show the adopted long title, adopted short title, `titles.json` path, and state that 10 long plus 10 short candidates are preserved and can be expanded or reselected. Do not wait for confirmation; continue the title-independent production branch.
10. Do not defer this feedback to the final delivery message and do not treat a file path, Feishu update, log line, or workbench-only state as user-visible title feedback.
11. If long candidates are regenerated or the adopted long title changes, clear short candidates and regenerate the automatic short-title selection. Send a new feedback card for the replacement pair and mark the earlier pair superseded.

The workbench UI and the server-side image executor must both reject image generation until one long title and one short title are automatically adopted or explicitly reselected.

## 5. Gate G03: storyboard and exactly one style sample

Start only after explicit G02 approval and completion of automatic long/short title selection.

Split the approved copy by meaningful changes in idea, action, scene, emotion, or narrative function. Let the copy determine the total number of visual beats; do not set a default range or derive a fixed count from video length.

Use roughly eight seconds per image only as a soft pacing review after semantic segmentation. Dense information, a new action, or a fast emotional turn may justify a shorter image; a complete causal statement, contrast, sustained emotion, or single narrative unit may justify a longer image. Never cut a complete semantic unit to hit eight seconds, and never add repetitive or low-value beats to reach a target count.

Record:

- narration range;
- visual subject and action;
- `subjectMode`: `character`, `space`, `landscape`, `object`, `architecture`, or `weather`;
- `characterNecessity`: `required`, `helpful`, or `not_needed`;
- `characterJustification` when `characterNecessity=required`;
- composition safe zones;
- generated-image prompt;
- continuity rules;
- actual voice start/end after narration exists.

Run a subject-mix audit before generating the G03 sample. A person is not the default subject: use space, scenery, architecture, weather, or meaningful objects when they carry the narration more precisely. If every scene uses a character, replan suitable scenes as non-character shots unless every character scene has a narration-specific justification. Do not enforce a fixed quota and do not add unrelated scenery as filler.

Generate exactly one representative original 9:16 style sample. Do not reproduce recognizable reference-video characters, compositions, or cover artwork. Run automatic full-frame, anatomy, relevance, continuity, and flat-block QA. A passing sample becomes the style baseline and immediately unlocks the remaining images.

## 6. Gate G04: remaining images and review

Start only after the G03 sample passes automatic QA.

Generate remaining images with the adopted style, palette, identity, period, light, and composition rules. Inspect:

- anatomy at full frame and enlarged detail;
- semantic relevance;
- character continuity;
- duplicate or near-duplicate composition;
- title and caption safe areas;
- visual grammar variety;
- subject-mix audit result and justification for any all-character storyboard.
- default avoidance of mirrors and human-bearing reflections;
- when a reflection was explicitly requested, consistency of identity, pose, gaze, limb count, handedness, object placement, perspective, and lighting.

Sync `G04=待确认` and stop for all-image approval.

## 7. C01 and V01: compliance, early narration, and real timing

Immediately after explicit G02 approval, run `media-publish-check` against the approved copy. Save the immutable input, risk level, risky sentences, categories, suggestions, timestamp, and raw report. A failed or high-risk report blocks titles, voice, images, and post-production. Never overwrite the approved copy.

After C01 passes, start two branches in parallel:

- automatic long-title generation/adoption followed by short-title generation/adoption;
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

### Jianying draft

Create a new editable draft after timing is stable. Copy intro, images, voice, music, captions, and metadata into the draft bundle. Keep separate tracks for intro, images, voice, music, fixed text, Chinese captions, and English captions.

Validate content, timing, audio peaks, paths, anatomy, typography, IDs, media ranges, and editability. Sync `G05=已通过` only after technical validation passes.

## 9. C02 and G06: automatic delivery registration and cover

Verify the exact original cover from WeRead or another authoritative public listing. Do not substitute a similar edition.

Create one separate 1080x1260 cover with `scripts/compose_wechat_cover.py`. Preserve the original cover artwork and typography. Generated imagery may be used only around it.

Run C02 across copy/captions, images/cover, final video/audio, technical properties, copyright/AI-label considerations, platform-fit items, and Jianying editability. Save the full report. High-risk findings block automatic delivery registration and draft upload; any correction requires a new C02 report. State clearly that this is automated risk assessment and not a platform guarantee.

After C02 passes, automatically register and expose:

- opening audio and transition;
- first body sentence;
- voice clarity and music balance;
- caption timing and obstruction;
- image continuity and anatomy;
- final fade-out;
- draft openability and editable text;
- cover edition, legibility, safe area, and separation from the MP4;
- `titles.json` with all 10 long candidates, all 10 short candidates, formula traceability, the adopted pair, and resolved publication topics.

Register `titles.json` as a formal delivery artifact in `delivery-manifest.json`. In the final conversation handoff, provide its clickable path and repeat the adopted long and short titles plus `#读书 #好书推荐 #人生感悟 #认知成长 #自我提升 #文字的力量 #《当前书名》`. Do not call delivery complete if the manifest entry, user-facing title-document link, or resolved topics are missing.

Do not add a third production confirmation. The user may explicitly roll back any listed artifact for revision.

## 10. G07–G09: draft upload, human publication, and review

After C02 passes, delivery artifacts are registered, and the user explicitly requests a draft upload:

1. G07 selects an existing logged-in WeChat Channels account and calls the pinned `dreammis/social-auto-upload` adapter with `is_draft=True`.
2. Use one deterministic idempotency key per task/account/final-video version. On retry, resume or return the existing upload record instead of creating an uncontrolled duplicate.
3. Upload the final video, standalone cover, adopted long/short titles, description, and tags. Never automate the formal publish click.
4. G08 waits for the user to publish in the platform backend and record account, work ID, URL, and actual publication time.
5. G09 accepts separate 24h, 72h, and 7d snapshots, derives engagement/share/save/follow conversion rates, and writes a review plus next-video experiment.

Every transition, wait state, retry, error, and artifact must update the same persistent Codex task and the workbench workflow run.
