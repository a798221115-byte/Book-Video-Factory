---
name: produce-script-video
description: Turn a user-supplied final narration script directly into a finished vertical video without source research or derivative rewriting. Use when the user places the standalone control phrase `用成稿直出` before or after a usable narration script, or explicitly asks to treat supplied copy as final and proceed directly through storyboard images, locked narration, captions, editing, validation, and delivery.
---

# Produce Script Video

Treat the supplied narration as approved production copy. Skip reference-video acquisition, Whisper, WeRead, DBS diagnosis, evidence packaging, derivative drafting, title-candidate generation, and copy/image confirmation gates.

## Resolve the control phrase

Recognize `用成稿直出` when it appears as a standalone leading or trailing control line or sentence. Allow adjacent Chinese or English punctuation such as `：`, `:`, `。`, or `.`.

1. Remove only the control phrase and its adjacent control punctuation.
2. Preserve every remaining narration word and its order.
3. Never send the control phrase to narration, captions, titles, or metadata fields intended for publication.
4. Do not trigger this workflow when the same words appear only inside quoted narration or as ordinary sentence content.
5. Stop only when no usable narration remains after removing the marker.

The marker authorizes direct production for the current supplied script. It does not authorize publication, draft upload, archival, deletion, or changes to unrelated projects.

## Resolve shared production resources

Use the installed sibling `produce-wechat-book-video` Skill version 3.3.0 or newer as the shared production engine. Resolve it from the current Skill root as `../produce-wechat-book-video/`, or from the active Codex global Skills directory. Do not invoke its intake or derivative-copy workflow.

Read only the shared resources required for the active stage:

- storyboard prompts and visual QA: `references/creative-standards.md`;
- narration, captions, motion, mixing, render, and validation: `references/technical-spec.md`;
- standalone cover, only when explicitly requested: `references/cover-style-spec.md`;
- production defaults: `assets/default-config.json`;
- project initialization, variant resolution, final mixing, cover composition, and delivery validation: the matching scripts under `scripts/`.

Stop and report the missing dependency if the sibling Skill or a required locked asset is unavailable. Do not silently invent a replacement voice, intro, mastering chain, or production script.

## Direct-production workflow

1. Create the dated work directory with the shared project initializer. Use an unambiguous book title from the supplied script when available. Otherwise keep the mandated temporary `YYYY-MM-DD-待确认书名-短ID/` form without blocking MP4 production.
2. Save the narration after control-marker removal verbatim to `video_clips/raw-transcript-user.txt` and `script.txt`. Save the same production text to `video_clips/reference-transcript.txt` for workflow compatibility without claiming that it is a transcript from an external reference.
3. Write `video_clips/reference-metadata.json` with `provider=user_supplied_final_script`, receipt time, character count, SHA-256, `rewriteMode=none`, and `triggerPhrase=用成稿直出`. Do not fabricate video, Whisper, WeRead, or DBS artifacts.
4. Treat `script.txt` as immutable production authority. If natural breathing punctuation is needed for speech, save it separately as `voice/voice-prosody.txt`; do not overwrite `script.txt`.
5. Run the normal automated publication-risk check on the final script. A high-risk or failing result blocks production and exposes the exact sentences at issue; a passing result continues automatically.
6. Resolve the production variant. Default to `female-book-narrator-locked-v1` and its matching female fixed intro. Select the male pair only when the user explicitly requests male narration.
7. Generate locked narration in semantic segments, measure every completed segment, and persist the real timing to `recipe.json`. Use measured narration as the timing authority.
8. Build `storyboard/storyboard.json` from meaningful changes in idea, action, scene, emotion, and narrative function. Derive image count from the script; use roughly eight seconds only as a pacing check.
9. Generate one representative 9:16 style sample, run automatic semantic, subject-mix, flat-block, anatomy, reflection, safe-area, and continuity QA, and adopt it only when it passes.
10. Generate all remaining images from the adopted style baseline and automatically inspect every image. Regenerate only failing images when practical.
11. Continue to post-production without a default image-confirmation stop. If the user includes `生成图片后先停下` or `先审图`, pause after all images pass automatic QA and wait for review.
12. Create narration-aligned Chinese and English captions without changing the underlying narration. Render deterministic header text only when reliable title and author metadata are available.
13. Assemble the matched fixed intro, approved images, motion, narration, captions, BGM, ducking, and fade into a versioned 1080x1920 60fps MP4.
14. Run technical validation and the final media-risk check. Register the MP4, reports, recipe, storyboard, captions, and production metadata in the delivery manifest.
15. Create a standalone cover only when the user explicitly requests one and an authoritative edition cover is available. Never delay the requested MP4 solely because cover identity is unavailable.

## Hard invariants

- Do not rewrite, expand, shorten, reorder, summarize, polish, or fact-check the narration unless the user separately requests it.
- Do not ask for routine copy or image confirmation after the direct-production marker.
- Do not create fake reference acquisition, Whisper, WeRead, DBS, quotation-ledger, or derivative-copy evidence.
- Keep the original final script auditable and byte-stable after control-marker removal.
- Keep generated storyboard backgrounds free of text, logos, and watermarks.
- Preserve semantic units when segmenting captions and storyboard beats.
- Use the locked voice, matching intro, fixed seed, and variant-specific mastering chain.
- Keep visual speed at 1.00x and use real completed narration timing.
- Treat broken anatomy, mismatched reflections, flat empty blocks, irrelevant imagery, voice/intro mismatch, missing audio, and failing media properties as release blockers.
- Never publish, upload a draft, archive, or delete files without a separate explicit instruction.

## Completion handoff

Link the final MP4, validation reports, `script.txt`, `recipe.json`, `storyboard/storyboard.json`, and delivery manifest. Expose any omitted optional artifact or unresolved low-confidence metadata. State clearly that direct production is complete while publication and archival remain unauthorized.
