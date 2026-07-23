# WeChat Channels cover house style

Use this specification for every standalone book-video cover unless the user explicitly requests a different design.

## Canvas and hierarchy

- Output exactly 1080×1260 PNG (6:7 portrait).
- Keep all essential content inside x=90–990 and y=45–1215.
- Build the cover in five vertical bands:
  1. top pill label at y=48–105;
  2. two-line headline at y=130–290;
  3. verified original book cover at y=330–1000;
  4. author/translator line at y=1040–1110;
  5. publisher or concise book descriptor at y=1100–1160.

## Visual language

- Use tactile layered deckled paper with a quiet parchment center.
- Frame the center with deep indigo/charcoal torn paper on the left and warm amber/gold paper on the right.
- Allow restrained gold flecks and delicate dried botanical branches near an outer edge.
- Keep lighting cinematic but restrained: cool shadow on the left, warm directional light on the right.
- Avoid neon colors, glossy 3D styling, busy center textures, stock-photo people, and unrelated props.
- Use `assets/wechat-cover-style-reference.png` as the approved visual reference and `assets/wechat-cover-background-template.png` as the default reusable background.

## Typography

- Pill text: `视频号 · 读书分享`, white text in a dark indigo rounded capsule with a thin warm-gold border.
- Headline: exactly two short lines. Line 1 is large off-white; line 2 is warm orange. Use bold Chinese sans-serif with a dark outline and restrained shadow.
- Derive the headline from the approved narration's central tension. Prefer concrete emotional language; do not repeat the book title as the headline.
- Keep each headline line within 13 Chinese characters when possible and fit it inside x=80–1000.
- Bottom metadata uses white or pale blue for author/translator and muted warm gold for publisher or descriptor.
- Add all text deterministically with a local font. Never ask an image model to render Chinese text.

## Original book cover

- Verify the exact edition before composition.
- Place the complete original cover centered, without cropping, redrawing, recoloring, replacing typography, or removing publisher marks.
- Target width 470–540 px, with a subtle shadow and optional 1–2 px warm border.
- Preserve the original cover aspect ratio. If the cover is unusually wide or tall, reduce it to remain inside x=220–860 and y=320–1020.

## Production

- Generate only a text-free surrounding background when the default template is unsuitable.
- Prefer deterministic composition with `scripts/compose_wechat_cover.py`.
- Save the verified original cover, background, final PNG, composition inputs, source URL, and validation notes under the project's `cover/` directory.
- Validate dimensions, safe area, headline legibility, exact book-cover hash, and absence of AI-generated text.
