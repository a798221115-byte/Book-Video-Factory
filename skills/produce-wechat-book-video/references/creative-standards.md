# Creative standards

## Derivative-copy construction

- Diagnose the reference with `dbs-content` before writing. Reuse only abstract mechanisms: hook type, tension, information order, emotional curve, sentence rhythm, and closing function.
- Build content-bearing claims from verified WeRead highlights and original reflection, not from the reference transcript.
- Treat reference wording as non-transferable unless it is an independently verified short quotation from the selected WeRead edition.
- Preserve a quotation ledger in `script_sources.md` and label direct quotations in the user review.
- Audit the draft against `reference-transcript.txt`. Rewrite distinctive shared phrases, matching sentence sequences, copied examples, and unverified claims.
- Allow unavoidable overlap only for the book title and independently verified short quotations.
- Keep the derivative copy meaningfully original even when it follows the same high-level content framework.

## Copy voice

- Write in a natural, reflective, emotionally controlled voice.
- Build the piece from short authentic source excerpts plus two or three personal observations.
- Avoid direct book-report structure and aggressive recommendation language.
- Never use stock lead-ins such as `书中有一句话` or `这本书告诉我们`.
- Avoid `不是……而是……`, excessive parallelism, slogans, preaching, superiority, and AI-like abstraction.
- Keep sentence rhythm varied. Allow silence and unfinished emotional space.
- Do not invent or paraphrase a sentence as a direct quotation.

## Established visual direction

Use premium literary editorial illustration with painterly paper texture, restrained cinematic light, and original scenes. Favor indigo, teal, warm gold, parchment, and limited coral accents. Avoid monochrome gloom and neon saturation.

Storyboard segmentation:

- Let the approved copy determine the image count; never impose a fixed total or a fixed one-minute range.
- Split when the idea, action, scene, emotion, or narrative function changes enough to require a new visual.
- Treat roughly eight seconds per image as a soft pacing check, not a generation formula.
- Allow shorter images for dense information or rapid turns and longer images for complete causal, contrastive, or emotional units.
- Preserve semantic completeness. Do not split sentences or add filler frames merely to approach eight seconds or a target count.

Composition rules:

- Reserve a low-interference fixed-header band at roughly 18%–30% of frame height for column, title, and author, matching the technical typography baseline.
- A safe area is not an empty color block. Continue the scene's wall texture, architecture, sky, foliage, weather, atmosphere, or light through title and caption regions at low contrast.
- Do not use a large pure-color, near-solid, monochrome, or empty gradient field to manufacture negative space anywhere in the frame. This prohibition includes the title band, caption safe area, corners, and lower frame.
- Require every low-information area to retain scene-coherent low-contrast texture, spatial depth, environmental detail, or natural light and shadow. Low detail is allowed; visually inactive flat fill is not.
- Include this constraint explicitly in every G03 and G04 image-generation prompt and negative prompt.
- Inspect the entire frame before approval. Reject and regenerate frames where a pure-color or visually inactive flat block is visible, the subject is forced too low, or the meaningful scene occupies too little of the canvas. Do not conceal a failing block with cropping, captions, title cards, blur, or motion.
- Let the subject and environmental storytelling occupy most of the frame while preserving readable low-detail landing areas for deterministic text.
- Do not default every line to a person standing, walking, reading, or looking away. Before prompt writing, classify every scene with `subjectMode` (`character`, `space`, `landscape`, `object`, `architecture`, or `weather`) and `characterNecessity` (`required`, `helpful`, or `not_needed`).
- Use a character only when identity, action, relationship, or emotion materially carries the sentence. Every `characterNecessity=required` scene must record a narration-specific `characterJustification`; visual continuity alone is not a valid justification.
- Vary visual grammar across a video by mixing character action with meaningful empty space, object close-ups, architecture, weather, and natural landscapes. Prefer a non-character frame when space, light, scenery, architecture, weather, or an object expresses the meaning more precisely.
- Treat an all-character storyboard as a review warning. Before G03, run a subject-mix audit and convert suitable beats to non-character frames unless every character scene is individually justified. Do not enforce a fixed character/non-character quota and do not add unrelated scenery as filler.
- Preserve style, palette, period, atmosphere, and light across non-character frames. Character continuity applies only when the recurring character is present; never add a decorative person solely to maintain continuity.
- Keep caption landing areas low-detail.
- Place faces, hands, and actions toward lower-middle or sides without colliding with captions.
- Keep critical information away from the bottom edge.
- Avoid adjacent scenes with nearly identical composition or meaning.
- Preserve identity continuity when recurring characters are used.

## Mirror and human-reflection quality gate

- Avoid mirrors and human-bearing reflections by default, including reflective glass, water, polished metal, screens, framed reflective surfaces, and compositions that visually duplicate a person.
- For self-observation or introspection, prefer non-reflective storytelling devices such as breathing, posture, hands, an unmarked journal, spatial thresholds, natural light, or meaningful objects.
- Include `no mirror, no human reflection, no duplicate person or face` in every character-image prompt and negative prompt unless the user explicitly requests a reflective composition.
- When the user explicitly requests a mirror or human reflection, inspect the real subject and reflection together for identity, pose, gaze, limb count, handedness, object placement, perspective, and lighting consistency.
- A reflection mismatch is a release blocker. Regenerate or edit the image; never conceal the mismatch with cropping, captions, blur, darkness, or motion.

## Human anatomy quality gate

Inspect every generated frame twice: once at full-frame scale for silhouette and center of gravity, and once enlarged for joints, hands, and overlaps. Reject and regenerate or edit the frame when any check fails.

- Count visible limbs and digits. Allow hidden parts only when the occlusion is visually explained; reject extra, missing, fused, or duplicated body parts.
- Trace each joint chain: neck to shoulder, shoulder to elbow, elbow to wrist, wrist to palm and fingers; hip to knee, knee to ankle and foot. Require natural connection, length, bend direction, and range of motion.
- Check hand-object contact. Fingers must wrap, press, hold, or rest with believable palm orientation, finger joints, force direction, and contact shadows.
- Check torso-pelvis alignment, leg loading, and center of gravity. Standing, sitting, walking, leaning, and reaching poses must be mechanically plausible.
- Check clothing and props do not conceal structural errors. Sleeves, coats, bags, curtains, furniture, crops, subtitles, and motion must not be used to disguise broken anatomy.
- Compare recurring characters with adjacent approved frames for face, body proportions, handedness, wardrobe, and scale continuity.
- Treat anatomy as a release blocker, not a cosmetic preference. Do not approve a visually attractive frame when its body geometry is wrong.

## Fixed typography layout

- Column: `读书分享`, small, top center.
- Title: `《书名》`, large light orange, top area.
- Author: `<作者名>丨著` or the correct translated-author form, light blue, below title.
- Chinese caption: bold white with dark outline, single line, middle-lower area.
- English caption: smaller white with dark outline, directly below Chinese.

Typography quality gate:

- Keep generated background images free of text; create all required text in the deterministic render.
- Verify column, title, and author share the intended center axis and vertical rhythm; reject baseline drift, uneven spacing, accidental rotation, or hierarchy reversal.
- Verify Chinese and English captions remain paired, centered, separated consistently, and inside the safe area without colliding with the person, hands, face, or key action.
- Inspect representative frames at the first body frame, every scene containing a person, the longest caption, the tightest safe-area composition, and the final frame.

## Caption language

Translate for natural English meaning rather than word-for-word syntax. Keep English short enough to remain one line. Match Chinese and English timing exactly.
