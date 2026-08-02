# Matrix shadow workflow

## Contents

- 1. Scope and directory contract
- 2. Source lock
- 3. Target-account production
- 4. Gates and rollback
- 5. Distribution and review

## 1. Scope and directory contract

Shadow mode adds an account variant to an existing primary project. It does not change the primary project or its installed production skill.

```text
<source-project>/
  script_sources.md
  script.txt
  titles.json
  storyboard/
  voice/
  render/
  cover/
  delivery-manifest.json
  matrix/
    source-lock.json
    campaign.json
    <account-id>/
      account-profile.json
      variant.json
      workflow-state.json
      script/
      titles/
      storyboard/
        prompts/
        images/
      voice/
      render/
      cover/
      compliance/
      delivery/
      distribution/
      metrics/
```

Keep evidence and book identity only in the primary project. Store references and hashes in `source-lock.json`; do not copy the evidence package into every account.

## 2. Source lock

Require `script_sources.md` and `script.txt`. Lock every available canonical artifact from this set:

- `script_sources.md`
- `script.txt`
- `titles.json`
- `storyboard/storyboard.json`
- `delivery-manifest.json`

Record absolute path, path relative to the source project, byte size, and SHA-256. Record the installed source skill path and exact version. Revalidate before resume, render, delivery, publication, and analytics review.

If a hash changes, stop and ask whether to create a new campaign revision. Never update the lock in place merely to make validation pass.

## 3. Target-account production

1. Snapshot the approved safe account profile.
2. Create `variant.json` with `variantLevel=light` by default.
3. Derive a target-account copy from locked evidence and the primary script's abstract structure. Change account angle, hook, at least one example or reflection, ending, titles, cover, and storyboard.
4. Stop at MG02. The primary copy confirmation is evidence of the master, not approval of this variant.
5. Run C01 on the target copy.
6. Generate a separate 10 long titles, 10 short titles, and 10 topic sets and expose them in the current conversation.
7. Generate target-account narration and real timing.
8. Generate one target-account style sample and automatically inspect it.
9. Generate remaining target-account images and stop at MG04.
10. After approval, run post-production, C02, cover, and delivery for this account only.

The first release supports one additional account per initialization. Re-run initialization with a different account ID to add another isolated variant to the same campaign.

## 4. Gates and rollback

Use exactly two blocking confirmations for each new account variant:

- `MG02`: target-account narration copy;
- `MG04`: all target-account storyboard images.

Rollback stays inside the target account directory. Preserve old revisions, mark them superseded, and rerun dependent compliance, timing, title, image, render, or delivery nodes. Never roll back or supersede the primary project's artifacts from matrix shadow mode.

## 5. Distribution and review

Keep one publication record per platform/account/video version. Draft requests do not authorize formal publication. Formal publication requires the selected account and an explicit authorization for the current task.

Store 24h, 72h, and 7d snapshots separately for every successful publication. Compare primary and target accounts only after noting account position, audience, publishing time, script angle, duration, title, cover, and product context. Do not attribute a difference to the account variant when multiple uncontrolled variables changed.
