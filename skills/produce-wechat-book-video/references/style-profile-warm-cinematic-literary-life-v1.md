# Warm cinematic literary life v1

This is the locked default visual profile for G03 and G04 unless the user explicitly requests another direction.

## Style anchor

- Asset: `assets/style-references/warm-cinematic-literary-life-v1.png`
- SHA-256: `e76fb34b32e1a206939d3dfe50a2bd7b57840a7580b7982585aae58aa9ad7172`
- Source dimensions: 1080×768 montage.
- Use it as style-conditioning evidence for every image-generation call. It controls visual language only; never copy its panel layout, exact compositions, poses, locations, or object placement.
- People and clothing visible in the style anchor are not identity or wardrobe evidence. The locked recurring-protagonist definition below overrides them.

## Locked visual DNA

- Photorealistic contemporary Chinese literary-film still; candid daily life, quiet emotional restraint, natural human presence, no commercial-advertising polish.
- Low-saturation warm-neutral palette: warm ivory plaster, oatmeal beige, light walnut, slate blue-gray, softened charcoal, natural skin, autumn foliage and restrained golden sunlight.
- Natural low-angle morning or late-afternoon light, gentle side/backlight, long soft shadows, luminous haze, preserved highlight and shadow detail, subtle analog grain and restrained halation.
- Realistic skin, hair, cloth, wood, concrete and paper. Keep pores and flyaway hair; avoid porcelain skin, oily beauty retouching, HDR and oversharpening.
- When a recurring female protagonist is semantically suitable, default to a young adult East Asian woman with a softly oval face, warm light natural skin, subtle freckles across the nose and upper cheeks, soft straight dark brows, dark-brown almond-shaped eyes, a small straight nose and natural muted-rose lips. Gather her black hair into a loose high messy bun with wispy face-framing strands; use minimal natural makeup, an oversized charcoal-gray chunky textured cable-knit crewneck sweater and dark-charcoal relaxed trousers. Keep face, age, freckles, facial features, hairstyle, sweater and trousers consistent. Change identity or wardrobe only when the narration requires it.
- Preserve a calm, reflective, gently hopeful emotional temperature. Avoid melodrama, triumphant posing, luxury lifestyle signals and influencer aesthetics.

## Shot grammar

Build the sequence from narration-relevant variation rather than repeated portraits:

- candid indoor reading or quiet daily action;
- sunlit empty corridor, doorway or architecture;
- front or three-quarter environmental portrait;
- relationship/action frame with believable hand contact;
- wider path, steps, street or park scene;
- person within a mountain/city/valley landscape;
- empty desk, notebook, cup, coat or other meaningful still life;
- back-view journey frame toward warm light.

Mix medium portraits, full-body environmental shots, over-shoulder/back views, empty interiors, object details and expansive landscapes. Do not reproduce the anchor montage as a checklist or fixed quota; each shot still needs an independent narrative function.

## Prompt prefix

```text
Original 9:16 photorealistic contemporary Chinese literary-film still, matching the bundled warm-cinematic-literary-life-v1 style anchor without copying its composition: low-saturation warm-neutral palette of warm ivory, oatmeal beige, light walnut, slate blue-gray and softened charcoal; natural low-angle morning or late-afternoon golden light, gentle side or backlight, long soft shadows, luminous atmospheric haze, realistic skin hair cloth wood concrete and paper, subtle analog film grain and restrained halation, candid unposed daily life, quiet reflective and gently hopeful mood, breathable textured negative space, professional cinematic clarity, original scene, no embedded text.
```

For a recurring female protagonist, append:

```text
same young adult East Asian woman across the sequence, softly oval face, warm light natural skin with subtle freckles across the nose and upper cheeks, soft straight dark brows, dark-brown almond-shaped eyes, small straight nose, natural muted-rose lips, black hair gathered into a loose high messy bun with wispy face-framing strands, minimal natural makeup, oversized charcoal-gray chunky textured cable-knit crewneck sweater, dark-charcoal relaxed trousers, natural body proportions and restrained expression; preserve facial identity, age, face shape, freckles, eye and brow shape, nose, lips, hairstyle, sweater texture and color, and trouser color.
```

## Negative prompt

```text
copied montage layout, split panels, copied reference composition, copied pose or location, high-key white commercial lifestyle photography, mandatory orange accent, broad orange wash, teal-orange grading, saturated colors, neon, dark oppressive noir, black-dominant void, underexposure, blown highlights, flat beige or gray block, empty digital gradient, glossy advertising, fashion editorial, studio glamour, influencer portrait, porcelain skin, oily skin sheen, heavy makeup, HDR, oversharpening, painterly illustration, anime, CGI, 3D render, distorted anatomy, duplicate person, inconsistent face or wardrobe, embedded words, letters, numbers, Chinese text, English text, subtitles, book title, logo, signature, watermark
```

Continue to apply the skill's anatomy, mirror/reflection, safe-area and no-embedded-text gates. The mirror panel in the anchor is style evidence only; mirrors and human reflections remain disabled by default.

## G03/G04 acceptance gate

Reject and regenerate when any of these fail:

- the result does not visibly match the anchor's warm-neutral palette, golden natural light, low saturation, cinematic realism and quiet emotional temperature;
- the image reads as generic commercial stock, fashion editorial, painterly illustration, glossy AI portrait or the former orange-accent profile;
- recurring character face shape, freckles, facial features, loose high messy bun, charcoal-gray cable-knit sweater or dark-charcoal trousers drift without a narration reason;
- the whole sequence repeats only side profiles or medium portraits instead of mixing character, empty, object and landscape grammar where semantically appropriate;
- light becomes harsh, skin plastic, colors saturated, shadows crushed, highlights blown, or negative space becomes a flat block;
- the anchor's montage layout, exact scene, pose, stairway, corridor, path or desk arrangement is recognizably copied;
- text, logos, watermarks, anatomy errors or reflection errors appear.

Record the anchor asset path and SHA-256 in `storyboard/style-sample-qa.json` and `storyboard/image-qa.json` so the applied profile is auditable.
