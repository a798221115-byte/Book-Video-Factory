# Full production workflow

## 1. Intake, Feishu, and workspace

Accept a Douyin link or book title as intake only. Do not infer approval for source selection, copy, images, post-production, or the cover.

When Feishu sync is enabled:

1. Upsert the book project.
2. Initialize the eight gate records.
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

## 3. Gate G01: source-package confirmation

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

Present the source package to the user. Ask them to confirm the reusable framework and selected WeRead evidence. Sync `G01=待确认`, set the project to waiting for source-package confirmation, and stop.

If TikHub or WeRead is unavailable, expose that exact blocker. Do not silently replace either source.

Only an explicit user response can change G01 to confirmed.

## 4. Gate G02: derivative copy

Start only after explicit G01 approval.

Create the narration by:

1. retaining the approved abstract framework from the reference diagnosis;
2. replacing reference wording, examples, and claims with approved WeRead ideas and original reflection;
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

## 5. Gate G03: storyboard and exactly one style sample

Start only after explicit G02 approval.

Split the approved copy by semantic change. Target roughly 8–12 visual beats for one minute. Record:

- narration range;
- visual subject and action;
- composition safe zones;
- generated-image prompt;
- continuity rules;
- actual voice start/end after narration exists.

Generate exactly one representative original 9:16 style sample. Do not reproduce recognizable reference-video characters, compositions, or cover artwork. Sync `G03=待确认` and stop.

## 6. Gate G04: remaining images and review

Start only after explicit G03 approval.

Generate remaining images with the approved style, palette, identity, period, light, and composition rules. Inspect:

- anatomy at full frame and enlarged detail;
- semantic relevance;
- character continuity;
- duplicate or near-duplicate composition;
- title and caption safe areas;
- visual grammar variety.

Sync `G04=待确认` and stop for all-image approval.

## 7. Gate G05: narration and technical post-production

Start only after all images are explicitly approved.

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

## 8. Gate G06: combined review and cover

Verify the exact original cover from WeRead or another authoritative public listing. Do not substitute a similar edition.

Create one separate 1080x1260 cover with `scripts/compose_wechat_cover.py`. Preserve the original cover artwork and typography. Generated imagery may be used only around it.

Sync `G06=待确认` and ask the user to review:

- opening audio and transition;
- first body sentence;
- voice clarity and music balance;
- caption timing and obstruction;
- image continuity and anatomy;
- final fade-out;
- draft openability and editable text;
- cover edition, legibility, safe area, and separation from the MP4.

Stop until explicit combined approval.

## 9. Workflow endpoint

After explicit G06 approval, sync G06 to confirmed and end the default workflow.

Do not embed the cover, shift video/audio, regenerate narration, change captions, mutate the recipe or draft, create distribution records, publish, or archive. Those actions require a separate explicit request and use G07/G08.
