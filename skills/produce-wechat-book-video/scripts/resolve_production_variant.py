#!/usr/bin/env python3
"""Resolve and validate a matched voice-and-intro production variant."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest().upper()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--project-root", type=Path, required=True)
    parser.add_argument("--variant", choices=("male", "female"), required=True)
    args = parser.parse_args()

    config_path = args.config.resolve()
    config = json.loads(config_path.read_text(encoding="utf-8"))
    intro = config["introVariants"][args.variant]
    voice = config["voicePresets"][args.variant]
    if intro["requiredVoiceVariant"] != args.variant:
        raise ValueError(f"Intro mapping mismatch for {args.variant}")

    project_root = args.project_root.resolve()
    intro_path = (project_root / intro["path"]).resolve()
    if not intro_path.is_file():
        raise FileNotFoundError(intro_path)
    intro_hash = sha256(intro_path)
    if intro_hash != intro["sha256"]:
        raise ValueError(f"Intro SHA-256 mismatch: {intro_path}")

    skill_root = config_path.parent.parent
    bundled_preset = (skill_root / voice["bundledPreset"]).resolve()
    if not bundled_preset.is_file():
        raise FileNotFoundError(bundled_preset)
    preset = json.loads(bundled_preset.read_text(encoding="utf-8"))
    if preset.get("variant") != args.variant:
        raise ValueError(f"Voice preset mismatch: {bundled_preset}")

    result = {
        "variant": args.variant,
        "voiceLabel": voice["label"],
        "voicePresetId": preset["id"],
        "bundledVoicePreset": str(bundled_preset),
        "projectVoicePreset": str((project_root / voice["projectPreset"]).resolve()),
        "introLabel": intro["label"],
        "introPath": str(intro_path),
        "introSha256": intro_hash,
        "expectedIntroDurationSeconds": intro["durationSeconds"],
        "pairingValid": True,
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
