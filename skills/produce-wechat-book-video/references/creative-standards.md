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

The default locked profile is `warm-cinematic-literary-life-v1`. Read `style-profile-warm-cinematic-literary-life-v1.md` and use its bundled style anchor for every G03 and G04 background unless the user explicitly requests another visual direction.

Core look:

- Build an original photorealistic contemporary Chinese literary-film still. Keep people sincere and unposed, with natural skin texture, flyaway hair, ordinary clothing, restrained expressions, and no fashion-model or commercial-advertising polish.
- Use low-saturation warm neutrals: warm ivory, oatmeal beige, light walnut, slate blue-gray, softened charcoal, natural skin, restrained autumn foliage and subdued natural gold.
- Use low-angle morning or late-afternoon sunlight, gentle side/backlight, long soft shadows and luminous haze. Interiors use warm window light; preserve both highlight and shadow detail.
- Do not require an orange accent. Reject broad orange wash, teal-orange grading, saturated accent colors, neon or unrelated colored props.
- Favor peaceful independence, emotional ease, gentle hope, inward attention and symbolic clarity. Preserve subtle analog film grain, restrained halation, realistic materials and professional camera clarity without oily skin, porcelain retouching, oversharpening or glossy commercial finish.
- When a recurring female protagonist is semantically suitable, default to the same young adult East Asian woman with a softly oval face, warm light natural skin, subtle freckles across the nose and upper cheeks, soft straight dark brows, dark-brown almond-shaped eyes, a small straight nose and natural muted-rose lips. Keep her black hair in a loose high messy bun with wispy face-framing strands; use minimal natural makeup, an oversized charcoal-gray chunky textured cable-knit crewneck sweater and dark-charcoal relaxed trousers. Preserve identity and wardrobe unless the narration requires a change.
- Compose for 9:16. For character frames, normally let the person occupy roughly 40%–60% of the frame while preserving the deterministic header band and middle-lower caption landing area. For empty, object, architecture, weather, or landscape frames, let the narrative environment fill the frame without adding a decorative person.
- Keep negative space bright but textured through plaster, curtains, sky, foliage, weather, architecture, or natural light falloff; never manufacture it with a flat white, beige, gray, black, or empty gradient block.
- Keep backgrounds free of text, letters, numbers, book-title typography, captions, logos, signatures, platform marks, or watermarks. Typography remains deterministic post-production.

Mandatory prompt prefix:

```text
Original 9:16 photorealistic contemporary Chinese literary-film still, matching the bundled warm-cinematic-literary-life-v1 style anchor without copying its composition: low-saturation warm-neutral palette of warm ivory, oatmeal beige, light walnut, slate blue-gray and softened charcoal; natural low-angle morning or late-afternoon golden light, gentle side or backlight, long soft shadows, luminous atmospheric haze, realistic skin hair cloth wood concrete and paper, subtle analog film grain and restrained halation, candid unposed daily life, quiet reflective and gently hopeful mood, breathable textured negative space, professional cinematic clarity, original scene, no embedded text.
```

Mandatory negative prompt:

```text
copied montage layout, split panels, copied reference composition, copied pose or location, high-key white commercial lifestyle photography, mandatory orange accent, broad orange wash, teal-orange grading, saturated colors, neon, dark oppressive noir, black-dominant void, underexposure, blown highlights, flat beige or gray block, empty digital gradient, glossy advertising, fashion editorial, studio glamour, influencer portrait, porcelain skin, oily skin sheen, heavy makeup, HDR, oversharpening, painterly illustration, anime, CGI, 3D render, distorted anatomy, duplicate person, inconsistent face or wardrobe, embedded words, letters, numbers, Chinese text, English text, subtitles, book title, logo, signature, watermark
```

For recurring-character scenes, append the locked identity/wardrobe prompt from the profile plus the existing mirror/reflection and anatomy constraints. For object, architecture, landscape, space or weather scenes, preserve the same palette, light, grain and emotional temperature without adding a decorative person.

Reference-frame boundary:

- Use `assets/style-references/warm-cinematic-literary-life-v1.png` as the bundled style-conditioning anchor for palette, light, materials, camera grammar and emotional temperature. Do not inherit a person's face, hair or clothing from the anchor; the locked recurring-character prompt is authoritative.
- Never use the anchor as a production background or preserve its montage layout, exact compositions, poses, locations or object placement.
- Other extracted user-video frames remain analysis evidence only and must not become production backgrounds.
- The G03 sample must translate the locked style into an original scene tied to the approved narration. The anchor's mirror panel does not override the default reflection prohibition.

Style QA:

- Reject a frame if it does not match the anchor's warm-neutral palette, low saturation, golden natural light, quiet literary mood, subtle grain and natural materials.
- Reject a frame if the result reads as the former orange-accent high-key profile, near-black editorial collage, indigo/teal/gold painterly direction, dark oppressive noir, generic high-saturation photography, anime, CGI, studio glamour or glossy advertising.
- Reject a frame if it is black-dominant or underexposed, highlights are blown, shadows erase spatial information, the bright area becomes a flat white/beige/gray block, or the narrative subject becomes unreadable at phone size.
- Reject a character frame when skin looks oily, plastic, porcelain-retouched, heavily made up or fashion-editorial rather than candid and natural; also reject unexplained face shape, freckles, facial-feature, loose-high-bun, charcoal-gray cable-knit-sweater or dark-charcoal-trouser drift.
- Reject a frame if embedded text, a logo, a watermark, or a recognizable reference composition survives.
- Compare every G04 frame with both the bundled anchor and the passing G03 sample for golden-light quality, warm-neutral palette, low saturation, grain, haze, skin/material realism, identity/wardrobe continuity, environmental texture and emotional temperature.
- Before G04, inspect the whole sequence for repeated face direction and repeated framing. Do not approve a sequence dominated by side profiles or near-identical medium portraits.

Storyboard segmentation:

- Let the approved copy determine the image count; never impose a fixed total or a fixed one-minute range.
- Split when the idea, action, scene, emotion, or narrative function changes enough to require a new visual.
- Treat roughly eight seconds per image as a soft pacing check, not a generation formula.
- Allow shorter images for dense information or rapid turns and longer images for complete causal, contrastive, or emotional units.
- Preserve semantic completeness. Do not split sentences or add filler frames merely to approach eight seconds or a target count.

Composition rules:

- Reserve a low-interference fixed-header band at roughly 18%–30% of frame height for column, title, and author, matching the technical typography baseline.
- A safe area is not an empty color block. Continue the scene's wall texture, paper/film grain, architecture, sky, foliage, weather, atmosphere, or light through title and caption regions at low contrast.
- Do not use a large pure-color, near-solid, monochrome, or empty gradient field to manufacture negative space anywhere in the frame. This prohibition includes the title band, caption safe area, corners, and lower frame.
- Require every low-information area to retain scene-coherent low-contrast texture, spatial depth, environmental detail, or natural light and shadow. Low detail is allowed; visually inactive flat fill is not.
- Include this constraint explicitly in every G03 and G04 image-generation prompt and negative prompt.
- Inspect the entire frame before approval. Reject and regenerate frames where a pure-color or visually inactive flat block is visible, the subject is forced too low, or the meaningful scene occupies too little of the canvas. Do not conceal a failing block with cropping, captions, title cards, blur, or motion.
- Let the subject and environmental storytelling occupy most of the frame while preserving readable low-detail landing areas for deterministic text.
- Do not default every line to a person standing, walking, reading, or looking away. Before prompt writing, classify every scene with `subjectMode` (`character`, `space`, `landscape`, `object`, `architecture`, or `weather`) and `characterNecessity` (`required`, `helpful`, or `not_needed`).
- Use a character only when identity, action, relationship, or emotion materially carries the sentence. Every `characterNecessity=required` scene must record a narration-specific `characterJustification`; visual continuity alone is not a valid justification.
- Vary visual grammar across a video by mixing character action with meaningful empty space, object close-ups, architecture, weather, and natural landscapes. Prefer a non-character frame when space, light, scenery, architecture, weather, or an object expresses the meaning more precisely.
- Across character frames, deliberately vary face orientation among front view, three-quarter front, restrained side profile, three-quarter back, and back view when the narration supports them. Do not repeat the same orientation across three consecutive character frames, and do not let side profiles dominate the sequence.
- Vary camera distance and narrative grammar as well as face direction: use a meaningful mix of close-up, medium portrait, wider environmental portrait, over-shoulder/back view, hand or object detail, empty interior, architecture, weather, and landscape. This is a semantic planning rule, not a fixed quota.
- When the narration supports it, include at least one genuinely non-character frame such as an empty breakfast table in morning light, a sunlit turning corridor, an open window with moving curtain, a path, sky, water, field, mountain, or another relevant landscape. Never add scenery that has no independent narrative function.
- Record the planned `subjectMode`, `faceOrientation` (or `not_applicable`), `cameraDistance`, and `narrativeFunction` for every storyboard beat before prompt generation. Run a sequence-level repetition audit before G03 and again before G04.
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
