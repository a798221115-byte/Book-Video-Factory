#!/usr/bin/env python3
"""Initialize an isolated shadow-mode account variant without touching primary artifacts."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


SOURCE_ARTIFACTS = (
    "script_sources.md",
    "script.txt",
    "titles.json",
    "storyboard/storyboard.json",
    "delivery-manifest.json",
)
REQUIRED_SOURCE_ARTIFACTS = ("script_sources.md", "script.txt")
SECRET_KEY = re.compile(r"password|passwd|cookie|token|secret|sms|api[_-]?key|authorization", re.I)
ACCOUNT_ID = re.compile(r"^[a-z0-9][a-z0-9-]{1,62}$")
SUPPORTED_MIN = (3, 9, 2)
SUPPORTED_MAX = (4, 0, 0)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def atomic_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    temp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temp, path)


def load_profile(path: Path) -> dict[str, Any]:
    if path.suffix.lower() == ".json":
        data = json.loads(path.read_text(encoding="utf-8"))
    else:
        try:
            import yaml  # type: ignore
        except ImportError as exc:
            raise RuntimeError("YAML account profiles require PyYAML; use JSON or install PyYAML") from exc
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("account profile must be an object")
    reject_secrets(data)
    return data


def reject_secrets(value: Any, trail: str = "profile") -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            if SECRET_KEY.search(str(key)) and str(key) != "credential_alias":
                raise ValueError(f"secret-like field is forbidden: {trail}.{key}")
            reject_secrets(child, f"{trail}.{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            reject_secrets(child, f"{trail}[{index}]")


def parse_version(value: str) -> tuple[int, int, int]:
    match = re.fullmatch(r"(\d+)\.(\d+)\.(\d+)", value.strip())
    if not match:
        raise ValueError(f"invalid source skill version: {value!r}")
    return tuple(int(part) for part in match.groups())  # type: ignore[return-value]


def descendant(child: Path, parent: Path) -> bool:
    try:
        child.resolve().relative_to(parent.resolve())
        return True
    except ValueError:
        return False


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-project", required=True)
    parser.add_argument("--account-profile", required=True)
    parser.add_argument(
        "--source-skill-dir",
        default=r"F:\Codex\.codex\skills\produce-wechat-book-video",
    )
    args = parser.parse_args()

    source = Path(args.source_project).resolve()
    profile_path = Path(args.account_profile).resolve()
    source_skill = Path(args.source_skill_dir).resolve()
    if not source.is_dir():
        raise FileNotFoundError(f"source project not found: {source}")
    if not profile_path.is_file():
        raise FileNotFoundError(f"account profile not found: {profile_path}")
    for relative in REQUIRED_SOURCE_ARTIFACTS:
        if not (source / relative).is_file():
            raise FileNotFoundError(f"required primary artifact missing: {relative}")

    version_file = source_skill / "VERSION"
    if not version_file.is_file():
        raise FileNotFoundError(f"source skill VERSION missing: {version_file}")
    source_version = version_file.read_text(encoding="utf-8").strip()
    parsed_version = parse_version(source_version)
    if not (SUPPORTED_MIN <= parsed_version < SUPPORTED_MAX):
        raise RuntimeError(f"unsupported produce-wechat-book-video version: {source_version}")

    profile = load_profile(profile_path)
    account = profile.get("account")
    if not isinstance(account, dict):
        raise ValueError("profile.account is required")
    account_id = str(account.get("id", "")).strip()
    if not ACCOUNT_ID.fullmatch(account_id):
        raise ValueError("account.id must match ^[a-z0-9][a-z0-9-]{1,62}$")
    if not str(account.get("name", "")).strip():
        raise ValueError("account.name is required")
    if not str(profile.get("audience", {}).get("description", "")).strip():
        raise ValueError("audience.description is required")

    matrix = (source / "matrix").resolve()
    account_dir = (matrix / account_id).resolve()
    if not descendant(account_dir, matrix):
        raise RuntimeError("resolved account output escaped the matrix directory")
    if account_dir.exists():
        raise FileExistsError(f"account variant already exists; resume instead of reinitializing: {account_dir}")

    artifacts: list[dict[str, Any]] = []
    for relative in SOURCE_ARTIFACTS:
        path = source / relative
        if path.is_file():
            artifacts.append({
                "relativePath": relative.replace("\\", "/"),
                "absolutePath": str(path.resolve()),
                "size": path.stat().st_size,
                "sha256": sha256(path),
            })

    matrix.mkdir(parents=True, exist_ok=True)
    lock_path = matrix / "source-lock.json"
    lock = {
        "schemaVersion": 1,
        "sourceProject": str(source),
        "sourceSkill": {
            "name": "produce-wechat-book-video",
            "path": str(source_skill),
            "version": source_version,
        },
        "artifacts": artifacts,
        "createdAt": utc_now(),
    }
    if lock_path.exists():
        existing = json.loads(lock_path.read_text(encoding="utf-8"))
        comparable = dict(lock)
        comparable["createdAt"] = existing.get("createdAt")
        if existing != comparable:
            raise RuntimeError("existing source-lock.json differs; validate or create a new campaign revision")
        lock = existing
    else:
        atomic_json(lock_path, lock)

    directories = (
        "script", "titles", "storyboard/prompts", "storyboard/images", "voice",
        "render", "cover", "compliance", "delivery", "distribution", "metrics",
    )
    for relative in directories:
        (account_dir / relative).mkdir(parents=True, exist_ok=False)

    now = utc_now()
    campaign_path = matrix / "campaign.json"
    if campaign_path.exists():
        campaign = json.loads(campaign_path.read_text(encoding="utf-8"))
        if campaign.get("sourceProject") != str(source):
            raise RuntimeError("campaign sourceProject mismatch")
        if any(item.get("accountId") == account_id for item in campaign.get("accounts", [])):
            raise RuntimeError(f"campaign already contains account: {account_id}")
    else:
        campaign = {
            "schemaVersion": 1,
            "campaignId": f"matrix-{source.name}",
            "mode": "shadow",
            "sourceProject": str(source),
            "sourceLock": str(lock_path),
            "accounts": [],
            "createdAt": now,
            "updatedAt": now,
        }
    campaign["accounts"].append({
        "accountId": account_id,
        "variantPath": str(account_dir / "variant.json"),
        "status": "initialized",
    })
    campaign["updatedAt"] = now

    profile_snapshot = account_dir / "account-profile.json"
    variant = {
        "schemaVersion": 1,
        "variantId": f"{campaign['campaignId']}-{account_id}",
        "campaignId": campaign["campaignId"],
        "accountId": account_id,
        "variantLevel": "light",
        "status": "initialized",
        "audienceAngle": None,
        "changedDimensions": ["audienceAngle", "hook", "example", "ending", "titles", "cover", "storyboard"],
        "gates": {"MG02": "pending", "MG04": "pending"},
        "paths": {
            "accountProfile": str(profile_snapshot),
            "script": str(account_dir / "script" / "script.txt"),
            "titles": str(account_dir / "titles" / "titles.json"),
            "storyboard": str(account_dir / "storyboard" / "storyboard.json"),
            "deliveryManifest": str(account_dir / "delivery" / "delivery-manifest.json"),
        },
        "createdAt": now,
        "updatedAt": now,
    }
    workflow_state = {
        "schemaVersion": 1,
        "accountId": account_id,
        "status": "initialized",
        "currentGate": "MG02_COPY_PREPARATION",
        "sourceLockValid": True,
        "updatedAt": now,
    }

    atomic_json(profile_snapshot, profile)
    atomic_json(account_dir / "variant.json", variant)
    atomic_json(account_dir / "workflow-state.json", workflow_state)
    atomic_json(campaign_path, campaign)
    print(json.dumps({
        "ok": True,
        "campaign": str(campaign_path),
        "accountId": account_id,
        "accountDirectory": str(account_dir),
        "sourceSkillVersion": source_version,
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        raise SystemExit(1)
