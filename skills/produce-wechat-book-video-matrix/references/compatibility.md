# Compatibility and isolation

## Source contract

The initial matrix release supports `produce-wechat-book-video` version `>=3.9.2` and `<4.0.0`. Initialization pins the exact installed version in `source-lock.json`; later validation requires that exact version until the campaign is explicitly migrated.

Minimum source project artifacts:

- `script_sources.md`
- `script.txt`

Optional canonical artifacts are locked when present. A project that has not completed the primary copy confirmation may be analyzed but must not start account-variant production.

## Write boundary

Resolve the source project and every intended output to absolute paths before writing. All generated matrix paths must be descendants of `<source-project>/matrix/`. Reject path traversal, absolute account IDs, reserved names, and symlink escapes.

The account profile may live elsewhere, but the skill stores only a sanitized snapshot in the matrix directory.

## Migration

When the installed source skill version or a locked artifact changes:

1. stop the campaign;
2. show the changed versions or hashes;
3. preserve the existing campaign and variants;
4. create a new campaign revision or run an explicit compatibility migration;
5. rerun affected validations.

Never rewrite `source-lock.json` silently.
