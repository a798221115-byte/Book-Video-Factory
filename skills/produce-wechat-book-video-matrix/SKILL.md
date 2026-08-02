---
name: produce-wechat-book-video-matrix
description: Safely create, produce, distribute, and review account-specific book-video variants from an existing verified primary-account project without modifying the primary project artifacts or the stable produce-wechat-book-video skill. Use when the user wants a second or additional book-video account, a matrix campaign, an account profile, an isolated distribution version, cross-account publication tracking, or 24h/72h/7d matrix comparison.
---

# Produce WeChat Book Video Matrix

Use this skill as the matrix orchestration entrypoint. Keep `produce-wechat-book-video` as the stable primary-account production contract and reuse its workbench providers and production rules; never copy or fork its implementation into this skill.

## Default operating mode

Use `shadow` mode unless the user explicitly asks to change the primary workflow:

1. Read one existing primary-account project.
2. Lock its verified evidence and approved master artifacts by path and SHA-256.
3. Write only to `<source-project>/matrix/` and the selected account's external configuration directory.
4. Produce the additional account version independently.
5. Leave the primary skill, primary `script.txt`, titles, storyboard, voice, render, cover, and delivery manifest unchanged.

Do not implement a new downloader, evidence provider, TTS engine, image provider, renderer, uploader, or analytics backend here. Reuse the canonical workbench implementation.

## Load references by need

| Need | Read |
| --- | --- |
| Full shadow workflow, gates, artifacts, rollback, or directory contract | `references/workflow.md` |
| Account positioning, reusable configuration, or required profile fields | `references/account-profile.md` |
| Source-skill version checks, source-lock rules, or migration decisions | `references/compatibility.md` |

Use the JSON schemas in `assets/` as the machine-readable contracts. Use `assets/account-profile.template.yaml` when onboarding an account.

## Workflow

1. Inspect project `AGENTS.md`, the source project, the installed `produce-wechat-book-video/VERSION`, and the selected account profile.
2. Reject profiles containing passwords, cookies, tokens, secrets, SMS codes, or raw login state. Store only a credential alias.
3. Initialize the isolated campaign:

```powershell
python scripts/init_matrix_campaign.py --source-project "<absolute-project-path>" --account-profile "<absolute-account-profile.yaml>"
```

4. Validate the source lock before every resume and before final delivery:

```powershell
python scripts/validate_matrix_campaign.py --source-project "<absolute-project-path>"
```

5. Build the account variant only from the locked evidence, approved primary script, approved abstract mechanisms, and the target account profile. Do not relabel primary approval as approval of the new account copy.
6. Stop at `MG02` for the target-account narration confirmation. Run C01 separately for the confirmed account copy.
7. Generate and expose a separate 10+10+10 title package, locked narration, measured timing, semantic storyboard, and exactly one style sample for the account variant. Account configuration counts as an explicit style/voice choice only when the user approved that profile.
8. Generate the remaining images and stop at `MG04` for the target account's all-image confirmation.
9. After MG04, create the account-specific render, cover, C02 report, and delivery manifest without changing the primary deliverables.
10. Keep draft upload and formal publication separate. Require selected accounts and explicit per-task authorization for formal publication. Persist results and 24h/72h/7d snapshots per account, publication, and video version.

## Hard boundaries

- Never edit, rename, move, supersede, or delete the installed `produce-wechat-book-video` skill from this skill.
- Never overwrite any file outside `<source-project>/matrix/` during shadow mode.
- Never treat the primary G02 or G04 approval as approval of the target account's new copy or images.
- Never duplicate unverified reference wording. Reuse only the primary project's locked evidence and abstract mechanisms under the original quotation boundaries.
- Keep the source project's book identity, source title, evidence artifacts, and original delivery records immutable.
- Use one stable account ID for configuration, variant directories, publication records, metrics, and retries.
- Require one deterministic idempotency key per platform/account/video version.
- Stop on source hash drift or incompatible source-skill version. Do not silently refresh the lock.
- Preserve prior variant revisions and mark them superseded; never delete audit history during rollback.
- Do not move a rendered file merely to represent `ready`, `published`, or `archived`. Record lifecycle state in manifests and the workbench database so stable paths remain valid.
- Formal publication and archive migration remain separately authorized external actions.

## Variant contract

Every account variant must explain why it fits that account. At minimum vary the audience angle, hook, one content-bearing example or reflection, ending function, titles, cover, and storyboard plan. Regenerate all account-variant images from its own confirmed script. Do not use character-count change or superficial word substitution as proof of meaningful differentiation.

Store:

- `matrix/source-lock.json`: immutable primary artifact paths, hashes, and source-skill version;
- `matrix/campaign.json`: campaign, accounts, and source relationship;
- `matrix/<account-id>/account-profile.json`: safe profile snapshot without credentials;
- `matrix/<account-id>/variant.json`: account angle, change dimensions, paths, gates, and status;
- `matrix/<account-id>/workflow-state.json`: resumable target-account state;
- account-specific scripts, titles, storyboard, voice, render, cover, compliance, delivery, distribution, and metrics beneath the same account directory.

## Completion handoff

Report the unchanged primary project, source-lock validation, target account ID, MG02/MG04 state, account-specific deliverables, publication authorization state, per-account results, and missing or low-confidence items. Do not call a matrix variant complete until its two confirmations, C01, C02, final media, cover, delivery manifest, and passing source-lock validation exist.
