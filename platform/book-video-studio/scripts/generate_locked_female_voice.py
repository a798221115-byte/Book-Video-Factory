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
    parser.add_argument("--segments-file", type=Path, required=True)
    parser.add_argument("--pauses-file", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--segments-dir", type=Path, required=True)
    parser.add_argument("--timeline", type=Path, required=True)
    parser.add_argument("--cache-dir", type=Path, required=True)
    args = parser.parse_args()

    import numpy as np
    import soundfile as sf
    import torch
    from voxcpm import VoxCPM

    preset_path = args.preset.resolve()
    preset = json.loads(preset_path.read_text(encoding="utf-8"))
    preset_root = preset_path.parent
    reference = (preset_root / preset["referenceAudio"]).resolve()
    prompt_text_path = (preset_root / preset["promptTranscript"]).resolve()
    prompt_text = prompt_text_path.read_text(encoding="utf-8").strip()

    if preset.get("id") != "female-book-narrator-locked-v1":
        raise ValueError(f"Unexpected preset: {preset.get('id')}")
    if preset.get("referenceMode") != "prompt_and_reference":
        raise ValueError("Locked female preset must use prompt_and_reference")
    if sha256(reference) != preset["referenceSha256"]:
        raise ValueError(f"Reference SHA-256 mismatch: {reference}")
    if not torch.cuda.is_available():
        raise RuntimeError("CUDA is required for locked VoxCPM2 narration")

    segments = [
        line.strip()
        for line in args.segments_file.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    pauses = json.loads(args.pauses_file.read_text(encoding="utf-8"))["pauseAfterSeconds"]
    if not segments or len(segments) != len(pauses):
        raise ValueError(f"segments={len(segments)} pauses={len(pauses)}")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.segments_dir.mkdir(parents=True, exist_ok=True)
    generation = preset["generation"]
    model = VoxCPM.from_pretrained(
        preset["model"],
        cache_dir=str(args.cache_dir.resolve()),
        load_denoiser=False,
        optimize=False,
        device="cuda",
    )
    sample_rate = int(model.tts_model.sample_rate)
    timeline = []
    parts = []
    cursor = 0.0

    for index, (text, pause_seconds) in enumerate(zip(segments, pauses), start=1):
        print(f"PROGRESS_START {index}/{len(segments)} {text}", flush=True)
        seed = int(generation["seed"])
        torch.manual_seed(seed)
        torch.cuda.manual_seed_all(seed)
        wav = model.generate(
            text=text,
            prompt_wav_path=str(reference),
            prompt_text=prompt_text,
            cfg_value=float(generation["cfgValue"]),
            inference_timesteps=int(generation["inferenceTimesteps"]),
            normalize=bool(generation["normalize"]),
            denoise=bool(generation["denoise"]),
            max_len=4096,
        )
        wav = trim_edges(wav, sample_rate)
        segment_path = args.segments_dir / f"segment{index:02d}.wav"
        sf.write(str(segment_path), wav, sample_rate)
        speech_duration = len(wav) / sample_rate
        timeline.append(
            {
                "index": index,
                "text": text,
                "seed": seed,
                "cfgValue": generation["cfgValue"],
                "inferenceTimesteps": generation["inferenceTimesteps"],
                "startSeconds": round(cursor, 3),
                "speechDurationSeconds": round(speech_duration, 3),
                "pauseAfterSeconds": pause_seconds,
                "endSeconds": round(cursor + speech_duration + pause_seconds, 3),
                "file": segment_path.name,
            }
        )
        parts.append(wav)
        if pause_seconds > 0:
            parts.append(np.zeros(round(sample_rate * pause_seconds), dtype=np.float32))
        cursor += speech_duration + pause_seconds
        print(f"PROGRESS_DONE {index}/{len(segments)} {speech_duration:.3f}", flush=True)

    combined = np.concatenate(parts)
    sf.write(str(args.output), combined, sample_rate)
    result = {
        "preset": preset["id"],
        "variant": "female",
        "engine": preset["engine"],
        "model": preset["model"],
        "referenceAudio": str(reference),
        "promptTranscript": str(prompt_text_path),
        "referenceMode": preset["referenceMode"],
        "referenceModeUsed": "prompt_and_reference",
        "sampleRate": sample_rate,
        "durationSeconds": round(len(combined) / sample_rate, 3),
        "cfgValue": generation["cfgValue"],
        "inferenceTimesteps": generation["inferenceTimesteps"],
        "seedPolicy": "fixed_42_for_every_segment",
        "speechSpeed": 1.0,
        "timeline": timeline,
    }
    args.timeline.write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print("RESULT " + json.dumps(result, ensure_ascii=False), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
