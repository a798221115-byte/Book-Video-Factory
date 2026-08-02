#!/usr/bin/env python3
"""Validate source immutability and matrix directory isolation."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Any


ACCOUNT_ID = re.compile(r"^[a-z0-9][a-z0-9-]{1,62}$")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def descendant(child: Path, parent: Path) -> bool:
    try:
        child.resolve().relative_to(parent.resolve())
        return True
    except ValueError:
        return False


def load_object(path: Path) -> dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError(f"expected JSON object: {path}")
    return data


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-project", required=True)
    args = parser.parse_args()

    source = Path(args.source_project).resolve()
    matrix = (source / "matrix").resolve()
    lock_path = matrix / "source-lock.json"
    campaign_path = matrix / "campaign.json"
    errors: list[str] = []
    if not source.is_dir():
        errors.append(f"source project not found: {source}")
    if not lock_path.is_file():
        errors.append("matrix/source-lock.json is missing")
    if not campaign_path.is_file():
        errors.append("matrix/campaign.json is missing")
    if errors:
        raise RuntimeError("; ".join(errors))

    lock = load_object(lock_path)
    campaign = load_object(campaign_path)
    if Path(str(lock.get("sourceProject", ""))).resolve() != source:
        errors.append("source-lock sourceProject mismatch")
    if Path(str(campaign.get("sourceProject", ""))).resolve() != source:
        errors.append("campaign sourceProject mismatch")
    if campaign.get("mode") != "shadow":
        errors.append("campaign mode must be shadow")

    source_skill = lock.get("sourceSkill") or {}
    source_skill_path = Path(str(source_skill.get("path", "")))
    version_file = source_skill_path / "VERSION"
    if not version_file.is_file():
        errors.append(f"source skill VERSION missing: {version_file}")
    else:
        current_version = version_file.read_text(encoding="utf-8").strip()
        if current_version != source_skill.get("version"):
            errors.append(f"source skill version drift: locked={source_skill.get('version')} current={current_version}")

    checked_artifacts = 0
    for artifact in lock.get("artifacts", []):
        path = Path(str(artifact.get("absolutePath", "")))
        if not path.is_file():
            errors.append(f"locked artifact missing: {path}")
            continue
        if not descendant(path, source):
            errors.append(f"locked artifact escaped source project: {path}")
            continue
        current_hash = sha256(path)
        if current_hash != artifact.get("sha256"):
            errors.append(f"locked artifact hash drift: {artifact.get('relativePath')}")
        checked_artifacts += 1

    seen: set[str] = set()
    accounts = campaign.get("accounts")
    if not isinstance(accounts, list) or not accounts:
        errors.append("campaign accounts must be a non-empty array")
        accounts = []
    for item in accounts:
        account_id = str(item.get("accountId", ""))
        if not ACCOUNT_ID.fullmatch(account_id):
            errors.append(f"invalid account ID: {account_id!r}")
            continue
        if account_id in seen:
            errors.append(f"duplicate account ID: {account_id}")
        seen.add(account_id)
        account_dir = (matrix / account_id).resolve()
        if not descendant(account_dir, matrix):
            errors.append(f"account directory escaped matrix root: {account_id}")
            continue
        for required in ("account-profile.json", "variant.json", "workflow-state.json"):
            if not (account_dir / required).is_file():
                errors.append(f"missing {account_id}/{required}")
        variant_path = Path(str(item.get("variantPath", ""))).resolve()
        if variant_path != account_dir / "variant.json":
            errors.append(f"variant path mismatch for {account_id}")

    result = {
        "ok": not errors,
        "sourceProject": str(source),
        "checkedArtifacts": checked_artifacts,
        "accounts": sorted(seen),
        "errors": errors,
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if not errors else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        raise SystemExit(1)
