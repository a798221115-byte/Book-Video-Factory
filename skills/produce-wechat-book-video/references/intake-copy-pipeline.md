# Dual intake and derivative-copy pipeline

Use this reference for the stages before storyboard production.

## Contents

- 1. Classify text versus link intake
- 1.1. Explicit direct-final-script mode
- 2. Preserve the reference transcript
- 3. Link intake through TikHub and Whisper
- 4. Diagnose with `dbs-content`
- 5. Verify with `weread-skills`
- 6. Build the G01 source package
- 7. Write and confirm the derivative copy

## 1. Classify text versus link intake

Choose exactly one acquisition path before creating source artifacts:

- **Text intake:** the user supplies a substantial, usable narration transcript. Preserve the supplied text verbatim and skip video download, audio extraction, and ASR.
- **Link intake:** the user supplies a Douyin or other supported video link without a usable narration transcript. Use the existing download and transcription path.

When one message contains both a substantial transcript and a source link, the transcript takes precedence. Keep the link as optional provenance metadata, but do not download it unless the user explicitly requests video verification.

A short topic, book title, instruction, caption, or link-preview sentence is not a usable narration transcript. Do not misroute those inputs as text intake.

### 1.1 Explicit direct-final-script mode

Select this branch only when both conditions are true:

1. the user supplies a substantial, usable narration transcript; and
2. the user explicitly says to treat it as final without derivative rewriting, including with `成稿直出`.

Then:

1. preserve the exact text as `raw-transcript-user.txt` and record normal text-intake metadata;
2. copy the exact supplied narration to `script.txt`; do not silently polish, paraphrase, reorder, expand, or run derivative drafting;
3. create `reference-transcript.txt` only as a separate minimally corrected audit copy;
4. record `G01=not_required_for_user_supplied_final_script` and `G02=approved_by_explicit_user_instruction`;
5. run C01 against the immutable `script.txt`;
6. after C01 passes, continue directly to automatic 10+10+10 selection, locked narration, real timing, semantic storyboard, G03 sample QA, and all-image generation;
7. stop at G04 for the remaining image confirmation.

The explicit instruction is the first production confirmation. It does not approve images, publication, draft upload, unverifiable quotations, author metadata, an edition, or a cover.

If the fixed intro already supplies a semantically identical opening such as `我们今天分享的是`, keep `script.txt` unchanged. The body voice may omit only that duplicate lead-in and start with `《书名》`; record the delivery-only adaptation in `voice/prosody-notes.md`.

WeRead and DBS evidence are not prerequisites for producing the user-approved wording in this branch. Treat the displayed book title as user-designated metadata, never present the narration as verified book text, and continue non-blocking edition lookup only when it helps later author or cover work. Missing exact edition evidence may still block author rendering, original-cover creation, C02, or final delivery; expose that blocker at the stage where it becomes required.

## 2. Preserve the reference transcript

For text intake:

1. Write the exact user-supplied narration to `video_clips/raw-transcript-user.txt` before any cleanup.
2. Record `provider=user_supplied_text`, acquisition time, optional source URL, original character count, and SHA-256 in `video_clips/reference-metadata.json`.
3. Convert the working copy to simplified Chinese when needed.
4. Correct only context-supported book-title errors, obvious homophones, word segmentation, punctuation, and paragraph boundaries.
5. Save the minimally corrected copy to `video_clips/reference-transcript.txt`.
6. Never create `raw-transcript-whisper.txt`, a fake video file, or fabricated TikHub metadata for this path.

For link intake, preserve the actual Whisper output and metadata defined below.

Do not rewrite, summarize, expand, reorder, polish, or improve the reference copy during intake cleanup. Keep the raw and corrected files separate.

## 3. Link intake through TikHub and Whisper

Require `TIKHUB_API_KEY`. Do not print the key.

```powershell
node scripts/download_douyin_tikhub.mjs `
  --url "<douyin-share-url>" `
  --output "<work-dir>/reference-YYYY-MM-DD.mp4" `
  --metadata "<work-dir>/video_clips/reference-metadata.json"
```

The script must:

- resolve `aweme_id` from `video/<id>` or `modal_id=<id>`;
- call `/api/v1/douyin/web/fetch_one_video`;
- retry TikHub metadata and media download up to three times with bounded exponential backoff;
- prefer `video.play_addr.url_list[0]`, then `video.download_addr.url_list[0]`;
- write through a `.part` file and rename only after a non-trivial download succeeds;
- refuse to overwrite existing output;
- record provider, source URL, `awemeId`, title, author, engagement metadata, local path, byte count, and SHA-256.

If TikHub is unavailable or the key is missing, stop and expose the exact blocker. Do not silently switch providers.

After download:

1. Use FFmpeg to create a mono 16 kHz PCM WAV under `video_clips/`.
2. Use the local Whisper executable and multilingual model configured by the project `AGENTS.md`.
3. Write the untouched Whisper text immediately to `raw-transcript-whisper.txt`.
4. Convert the working copy to simplified Chinese.
5. Correct only context-supported:
   - book-title homophones;
   - obvious homophones or near-homophones;
   - word segmentation;
   - punctuation;
   - paragraph boundaries.
6. Save the cleaned copy to `reference-transcript.txt`.

## 4. Diagnose with `dbs-content`

Use `dbs-content` as a diagnostic framework, even though the parent workflow will later write the derivative copy. Save the result to `reference-copy-analysis.md`.

Required diagnosis:

```markdown
# Reference copy diagnosis

## One-sentence content promise

## Hook
- Hook type:
- First tension:
- Why the viewer keeps listening:

## Structure
1. Opening:
2. Escalation:
3. Turn:
4. Resolution:
5. Closing device:

## Emotional curve

## Language and rhythm
- Sentence length:
- Repetition:
- Contrast:
- Concrete versus abstract language:
- Memorable-line mechanism:

## Reusable abstract framework

## Non-transferable elements
- Distinctive wording:
- Unverified claims:
- Reference-specific examples:
- Visual or identity elements:

## Risks
- Book attribution risk:
- Copying risk:
- Weak logic or unsupported promise:
```

Analyze mechanisms, not just topics. A useful diagnosis explains the order in which tension, recognition, evidence, relief, and closure are produced.

Do not use `dbs-content` to draft the new narration. The parent skill owns the derivative writing step.

## 5. Verify with `weread-skills`

Follow the `weread-skills` documentation:

1. Extract the highest-confidence book-title candidate from `reference-transcript.txt`.
2. If the title is missing or low-confidence, stop and request the book title instead of guessing.
3. Search by book title with `/store/search` and explicit `scope=10`.
4. Resolve the exact `bookId`.
5. Use `/book/info` to verify title, author, translator, publisher, publication date, and ISBN when returned.
6. Use `/book/bestbookmarks` with `chapterUid=0` for whole-book popular highlights.
7. Preserve the first 10 returned items in heat order, including sentence text, chapter, and highlight count. If fewer than 10 are returned, preserve all returned items and disclose the shortfall.
8. Stop immediately if the API returns `upgrade_info`; complete the requested skill upgrade before retrying.
9. Never replace unavailable WeRead evidence with another source without user approval.

When several books share a title, use visible reference evidence such as author name or original cover to select the edition. If the edition remains ambiguous, present the candidates and stop.

## 6. Build the G01 source package

Write `script_sources.md` with:

- intake mode: `user_supplied_text` or `video_link`;
- for text intake: raw user transcript path, optional source URL, acquisition time, character count, SHA-256, and metadata path;
- for link intake: TikHub source URL, `awemeId`, title, author, duration, and metadata path;
- cleaned reference transcript path;
- DBS diagnosis path;
- exact WeRead edition and deep link;
- the first 10 whole-book popular highlights in returned heat order, with chapter names and counts;
- a quotation ledger separating:
  - verified WeRead quotations;
  - reference-video wording;
  - original observations not yet written;
- a mismatch list for reference-video claims or “book quotes” that WeRead does not verify.

Show the source package in the workbench, lock the selected evidence when copy generation starts, and continue. G01 is traceable and reversible but does not consume a human confirmation.

## 7. Write the derivative copy after G01 evidence lock

This section applies only to the normal derivative path. Do not run it in explicit direct-final-script mode.

Use this sequence:

1. Copy only the verified abstract framework into a scratch outline.
2. Select three to six verified WeRead ideas or short quotations.
3. Rebuild every content-bearing sentence from WeRead evidence and original reflection.
4. Keep the reference only for hook function, tension order, emotional curve, rhythm, and ending function.
5. Start the body with `《书名》` because the fixed intro already contains `我们今天分享的是`.
6. Aim for roughly 50–55 seconds before real voice timing.
7. Label direct quotations and original expression in the review handoff.

Run an overlap audit before G02:

- compare the draft against `reference-transcript.txt`;
- flag distinctive shared phrases, matching sentence sequences, and copied examples;
- allow the book title and independently verified short quotations;
- rewrite all other distinctive overlap;
- verify every direct quotation against `script_sources.md`.

Save the result as `script.txt`, sync G02 to waiting for confirmation, and stop. Do not create a storyboard or image before explicit approval.

After the first G02 confirmation, run automatic title generation and selection before any storyboard or image work:

- use the TikHub Douyin title on link intake; on text intake, use an explicitly supplied source title when available, otherwise record `sourceTitleMode=user_transcript` and use the reference opening only as a rhythm cue;
- use `dbs-xhs-title` to match 5–8 formulas across at least three trigger categories;
- generate and preserve exactly 10 traceable long-title candidates, automatically adopting the first recommendation;
- generate exactly 10 short-title candidates only from that adopted long title, automatically adopting the first recommendation;
- persist the full audit trail in `titles.json`;
- invalidate and regenerate short-title state whenever the long title is regenerated or changed.
