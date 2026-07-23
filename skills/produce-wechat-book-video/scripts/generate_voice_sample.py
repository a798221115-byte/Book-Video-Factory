#!/usr/bin/env python3
"""Generate one deterministic VoxCPM sample from a bundled voice preset."""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
from pathlib import Path


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest().upper()


def trim_edges(wav, sample_rate: int):
    import numpy as np

    audio = np.asarray(wav, dtype=np.float32).squeeze()
    peak = float(np.max(np.abs(audio))) if audio.size else 0.0
    if peak <= 0.0:
        return audio
    active = np.flatnonzero(np.abs(audio) >= peak * 0.005)
    if not active.size:
        return audio
    pad = int(sample_rate * 0.04)
    return audio[max(0, int(active[0]) - pad) : min(audio.size, int(active[-1]) + pad + 1)]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--preset", type=Path, required=True)
    parser.add_argument("--text", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--raw-output", type=Path)
    parser.add_argument("--cache-dir", type=Path, required=True)
    parser.add_argument("--ffmpeg", default="ffmpeg")
    args = parser.parse_args()

    import soundfile as sf
    import torch
    from voxcpm import VoxCPM

    preset_path = args.preset.resolve()
    preset = json.loads(preset_path.read_text(encoding="utf-8"))
    asset_dir = preset_path.parent
    reference = (asset_dir / preset["referenceAudio"]).resolve()
    if sha256(reference) != preset["referenceSha256"]:
        raise ValueError(f"Reference SHA-256 mismatch: {reference}")

    generation = preset["generation"]
    if not torch.cuda.is_available():
        raise RuntimeError("CUDA is required for VoxCPM generation")
    model = VoxCPM.from_pretrained(
        preset["model"],
        cache_dir=str(args.cache_dir.resolve()),
        load_denoiser=False,
        optimize=True,
        device="cuda",
    )
    sample_rate = int(model.tts_model.sample_rate)
    seed = int(generation["seed"])
    torch.manual_seed(seed)
    torch.cuda.manual_seed_all(seed)
    kwargs = {
        "text": args.text,
        "reference_wav_path": str(reference),
        "cfg_value": float(generation["cfgValue"]),
        "inference_timesteps": int(generation["inferenceTimesteps"]),
        "normalize": bool(generation["normalize"]),
        "denoise": bool(generation["denoise"]),
        "max_len": 4096,
    }
    mode = preset["referenceMode"]
    if mode == "prompt_and_reference":
        transcript = (asset_dir / preset["promptTranscript"]).read_text(encoding="utf-8").strip()
        kwargs.update(prompt_wav_path=str(reference), prompt_text=transcript)
    elif mode != "reference_only":
        raise ValueError(f"Unsupported referenceMode: {mode}")

    wav = trim_edges(model.generate(**kwargs), sample_rate)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    raw_output = args.raw_output or args.output.with_name(f"{args.output.stem}-raw.wav")
    raw_output.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(raw_output), wav, sample_rate)

    mastering = preset.get("mastering", {})
    filters = [mastering[key] for key in ("stage1", "stage2") if mastering.get(key)]
    if filters:
        subprocess.run(
            [
                args.ffmpeg,
                "-y",
                "-hide_banner",
                "-loglevel",
                "error",
                "-i",
                str(raw_output),
                "-af",
                ",".join(filters),
                "-ar",
                str(sample_rate),
                "-ac",
                "2",
                "-c:a",
                "pcm_s16le",
                str(args.output),
            ],
            check=True,
        )
    else:
        sf.write(str(args.output), wav, sample_rate)

    result = {
        "preset": preset["id"],
        "label": preset["label"],
        "text": args.text,
        "seed": seed,
        "cfgValue": generation["cfgValue"],
        "inferenceTimesteps": generation["inferenceTimesteps"],
        "referenceMode": mode,
        "rawOutput": str(raw_output.resolve()),
        "output": str(args.output.resolve()),
        "outputSha256": sha256(args.output),
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
