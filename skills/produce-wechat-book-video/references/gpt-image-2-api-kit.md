# GPT Image 2 API kit

Use this provider contract for every generated or edited image in the workflow.

## Runtime configuration

- Read `imageGeneration` from `assets/default-config.json`.
- Resolve the kit file from `GPT_IMAGE2_KIT_FILE`; otherwise use `apiKitFileDefault`.
- Read the file only at request time, extract the `sk-` token and the first HTTP(S) Base URL, and normalize the Base URL to `/v1`.
- Use `GPT_IMAGE2_BASE_URL` and `GPT_IMAGE2_MODEL` only as explicit runtime overrides. Defaults are `https://api.openai.com/v1` and `gpt-image-2`.
- Never copy, print, return, persist, hash, partially reveal, or commit the API key. A health response may report only provider name, model, endpoint host, availability, and latency.
- Stop with an actionable configuration error when the kit is missing or invalid. Do not silently use Codex built-in `imagegen`, another API key, another image model, or a mock provider in production.

## Endpoint routing

- Use `POST /images/generations` for the first original G03 style sample and other truly text-only generation.
- For APIMart, submit `size=9:16`, `resolution=1k`, poll `/tasks/{task_id}`, download the completed URL immediately, and never resubmit a task merely because polling was interrupted.
- For APIMart style conditioning and revisions, call `/images/generations` with `image_urls`; use the passing G03 image for G04 and the current frame for a targeted revision. For providers that implement the native OpenAI edit contract, use `/images/edits`.
- Keep one request per output file, preserve the exact prompt in `storyboard/prompts/`, and record `generatedBy=gpt-image-2-api-kit` plus the model in artifact metadata.

## Output contract

- Request a 9:16 portrait image. APIMart defaults to the user-approved 1K tier (`941x1672` in the verified channel); validate and deterministically fit it to the 1080x1920 production canvas without distorting the subject.
- Preserve every visual, continuity, safe-area, no-text, anatomy, reflection, and sequence-level QA rule in `creative-standards.md` and the locked style profile.
- Generate exactly one G03 sample before G04. Do not use provider migration as permission to add a confirmation gate or change the semantic image count.
