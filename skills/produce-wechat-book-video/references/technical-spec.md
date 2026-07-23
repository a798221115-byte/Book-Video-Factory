# Technical specification

## Video

- Canvas: 9:16.
- Resolution: 1080x1920.
- Frame rate: 60fps.
- Video codec: H.264 High, yuv420p.
- Audio: AAC, 48kHz.
- Visual speed: 1.00x unless explicitly changed.

### Still-image motion

- Each storyboard image receives exactly one motion: `zoom-out`, `zoom-in`, `pan-left-to-right`, or `pan-right-to-left`.
- `zoom-out` is centered and monotonically decreases from 120% to 100%. `zoom-in` is centered and monotonically increases from 100% to 120%.
- Both pan motions remain at a fixed 120% scale for edge coverage and move in only one direction. They must not zoom, reverse, expose a black edge, or move outside the frame.
- Select motions with a deterministic pseudo-random seed. Exclude the immediately preceding motion before selecting the next one, so adjacent storyboard images never repeat the same motion while rerenders stay reproducible.
- Treat eight seconds as the approved reference pace and normalize the easing over the actual narration-aligned image hold.
- Use monotonic smoothstep easing, calculate at a 2x working resolution, then Lanczos-downscale to 1080x1920 at 60fps. Do not use sinusoidal crop coordinates or any expression that reverses direction within one shot.

### Standard typography baseline

Use these rendered canvas字号 for standard videos unless the user explicitly overrides them:

| Element | Size |
| --- | ---: |
| Book title | 88 |
| Author name | 48 |
| Chinese captions | 58 |
| English captions | 30 |

Color hierarchy: book title is light orange; author name is light blue. Keep the same mapping in the rendered video and editable Jianying text materials.

Keep all four as editable Jianying text materials and preserve one-line caption layout and safe-area spacing.

## Locked narration

The production default is `female`. Never infer `male` from legacy assets, filenames, prior projects, or a stale configuration value; select it only from an explicit user request.

Read the selected project preset before generation. Both variants use VoxCPM2 / `openbmb/VoxCPM2`, CFG 2.0, 20 inference steps, fixed seed 42 for every segment, normalize false, denoise false, retry bad case false, and native 1.00x generation speed.

### 男版音色

- Preset: `assets/voice-presets/male-podcast-locked-v2.json`.
- Bundled preset: `assets/male-podcast-locked-v2.json`.
- Reference: `male-podcast-locked-v2-reference.wav`.
- Golden master: `male-podcast-locked-v2-full.wav`.
- Reference mode: `reference_only`; do not invent or pass prompt text.
- This is the optional variant; select it only when the user explicitly requests the male version.

### 女版音色

- Preset: `assets/voice-presets/female-book-narrator-locked-v1.json`.
- Bundled preset: `assets/female-book-narrator-locked-v1.json`.
- Reference: `female-book-narrator-locked-v1-reference.wav`.
- Prompt transcript: `female-book-narrator-locked-v1-transcript.txt`.
- Golden master: `female-book-narrator-locked-v1-full.wav`.
- Reference mode: `prompt_and_reference`; pass the bundled prompt audio and exact bundled transcript together.
- Reference pitch median: about 143.71 Hz; ordinary pause target: 0.38 seconds; reference gross pace: about 4.52 Chinese characters/second.
- This is the default variant. Use the matching female intro unless the user explicitly requests the male version.

Never substitute references, modes, seeds, or mastering chains between variants. If project copies are missing, restore the selected bundled preset and all assets it names, then verify SHA-256 hashes against the preset.

## Voice and intro variant binding

Resolve one production variant before narration, caption timing, mixing, or Jianying generation:

| Variant | Voice preset | Fixed intro | Expected duration |
| --- | --- | --- | --- |
| `male` | `male-podcast-locked-v2` (`男版音色`) | `固定/男版前3秒固定开头.mp4` (`男版片头`) | 2.97 seconds |
| `female` | `female-book-narrator-locked-v1` (`女版音色`) | `固定/女版前3秒固定开头.mp4` (`女版片头`) | 2.97 seconds |

Use `female` as the default when the user has not selected a variant. When the user requests a male version, resolve both voice and intro to `male`. Verify the intro file hash from `assets/default-config.json`, retain its original audio, and use its measured duration as the narration and caption offset. Treat a voice/intro mismatch as a blocking validation error unless the user explicitly authorizes cross-pairing.

## Approved final mix

Music baseline:

- Intro: 0.63.
- Body: 0.63.
- Fade-out: final 1.0 second.

For `男版音色`, apply body voice clarity in two deterministic stages:

1. `volume=0.60,highpass=f=70,lowpass=f=13500,acompressor=threshold=0.10:ratio=1.6:attack=12:release=140:makeup=1.20,loudnorm=I=-12.5:LRA=2:TP=-1.0`
2. `volume=1.14,alimiter=limit=0.86:level=false`

Approved decoded pure-voice targets are approximately -12.4 LUFS, LRA 2.5 LU, and -0.8dBFS true peak. Do not add presence EQ merely to make the waveform brighter; the approved clarity comes from the v2 reference clone at native speed.

For `女版音色`, use the mastering chain stored in `female-book-narrator-locked-v1.json`:

1. `highpass=f=75,equalizer=f=3200:t=q:w=1.1:g=1.5,acompressor=threshold=0.12:ratio=1.4:attack=12:release=140:makeup=1.02,loudnorm=I=-15.1:LRA=8:TP=-1.0`
2. `volume=1.45,alimiter=limit=0.91:level=false`

Do not apply the male mastering chain to the female preset or vice versa.

Ducking:

- Threshold: 0.018.
- Ratio: 4.
- Attack: 10ms.
- Release: 220ms.
- Final limiter: 0.90 with auto-level disabled.

These are baseline values derived from the approved benchmark comparison. Re-measure when the narration source changes materially.

## Jianying draft requirements

- Inspect a readable local draft matching the installed Jianying version before generating.
- Use a new unique uppercase UUID.
- Use the same UUID for content ID, metadata ID, and root-index ID when the project rule requires it.
- Never reuse an existing native draft folder or ID.
- Use absolute paths that exist.
- Copy all media into `Resources/` inside the draft folder before writing paths.
- Keep source ranges within real media duration.
- Keep `draft_content.json`, `.bak`, and `template-2.tmp` identical.
- Use editable text materials for column, title, author, Chinese captions, and English captions.
- Validate no same-track overlaps and all referenced material IDs.
- Install one copy under the Jianying native draft root and retain one archival copy under `work/.../jianying_draft/`.

## Validation

Check:

- exact duration and stream properties;
- first body frame/caption after intro;
- no duplicate opener;
- intro audio exists;
- BGM audibility and ducking;
- decoded peak no higher than about -0.8dBFS;
- final one-second music fade;
- one-line captions and forbidden punctuation;
- image/audio paths and draft ID consistency;
- sample frames at the intro boundary, middle, and ending.

## Approved standalone cover

- The approved cover is a standalone 1080x1260 (6:7) upload asset.
- Preserve the verified original cover artwork and typography; generated imagery may only extend the surrounding background.
- After explicit cover approval, do not create a 1080x1920 cover frame, insert a silent clip, shift the existing video/audio, regenerate narration, alter captions, update `recipe.json`, or mutate the Jianying draft.
- Validate the cover dimensions, central safe area, original-cover hash, legibility, and manifest path. Any later embedding or distribution work is a separate explicitly requested workflow.
