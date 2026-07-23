# Douyin intake and derivative-copy pipeline

Use this reference for the stages before storyboard production.

## 1. Download through TikHub

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

## 2. Extract and transcribe

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

Do not rewrite, summarize, expand, reorder, polish, or improve the reference copy during transcription. Keep the raw and cleaned files separate.

## 3. Diagnose with `dbs-content`

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

## 4. Verify with `weread-skills`

Follow the `weread-skills` documentation:

1. Search by book title with `/store/search` and explicit `scope=10`.
2. Resolve the exact `bookId`.
3. Use `/book/info` to verify title, author, translator, publisher, publication date, and ISBN when returned.
4. Use `/book/bestbookmarks` with `chapterUid=0` for whole-book popular highlights.
5. Preserve sentence text, chapter, and highlight count.
6. Stop immediately if the API returns `upgrade_info`; complete the requested skill upgrade before retrying.
7. Never replace unavailable WeRead evidence with another source without user approval.

When several books share a title, use visible reference evidence such as author name or original cover to select the edition. If the edition remains ambiguous, present the candidates and stop.

## 5. Build the G01 source package

Write `script_sources.md` with:

- TikHub source URL, `awemeId`, title, author, duration, and metadata path;
- cleaned reference transcript path;
- DBS diagnosis path;
- exact WeRead edition and deep link;
- ranked popular highlights with chapter names and counts;
- a quotation ledger separating:
  - verified WeRead quotations;
  - reference-video wording;
  - original observations not yet written;
- a mismatch list for reference-video claims or “book quotes” that WeRead does not verify.

Show the source package to the user and stop at G01. Ask the user to approve the framework and selected WeRead evidence, not merely the book title.

## 6. Write the derivative copy after G01 approval

Use this sequence:

1. Copy only the approved abstract framework into a scratch outline.
2. Select three to six approved WeRead ideas or short quotations.
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

After G02 approval, run the title sub-gates before any storyboard or image work:

- read the TikHub Douyin title;
- use `dbs-xhs-title` to match 5–8 formulas across at least three trigger categories;
- generate and present exactly 10 traceable long-title candidates;
- stop until the user selects one long title;
- generate exactly 10 short-title candidates only from that selected long title;
- stop until the user selects one short title;
- persist the full audit trail in `titles.json`;
- invalidate short-title state whenever the long title is regenerated or changed.
