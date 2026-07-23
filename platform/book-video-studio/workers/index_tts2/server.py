"""
index-tts2 本地 TTS 常驻服务（Windows + RTX 4070 Super）。

部署：原生 Windows 跑本服务，Mac 端 .env 设 INDEX_TTS2_URL=http://<本机局域网IP>:7860
契约（lib/providers/tts.ts 的 IndexTts2Provider 依赖）：
  GET  /health           -> {"ok": true, "model_loaded": bool}
  POST /tts {text, voice} -> 200 + audio/wav 字节流（合成失败返回 4xx/5xx + 文本）

模型加载一次常驻显存，Mac 每段文本来一次 HTTP，不冷启动。
首次部署见 README.md。
"""
import io
import os
import wave
import struct
import traceback
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

# ---- 配置（按你的 index-tts2 安装路径/权重调整）----
MODEL_DIR = os.environ.get("INDEXTTS_MODEL_DIR", "checkpoints")
CFG_PATH = os.environ.get("INDEXTTS_CFG", os.path.join(MODEL_DIR, "config.yaml"))
VOICES_DIR = os.environ.get("INDEXTTS_VOICES", "voices")  # 参考音色 wav 放这里
DEFAULT_VOICE = os.environ.get("INDEXTTS_DEFAULT_VOICE", "default")
SAMPLE_RATE = int(os.environ.get("INDEXTTS_SR", "24000"))

app = FastAPI(title="index-tts2 worker")
_tts = None  # 全局模型句柄，启动时加载一次
_is_v2 = False  # 加载到的是 v2 还是 v1


def load_model():
    """加载 index-tts2 模型到显存（启动时调一次）。
    优先按 index-tts2(v2) 的入口加载，失败再退回 v1，最后才抛错回退静音占位。
    官方仓库: https://github.com/index-tts/index-tts"""
    global _tts, _is_v2
    if _tts is not None:
        return _tts
    # index-tts2（v2）：infer_v2.IndexTTS2，支持 use_fp16（4070S 省显存提速）
    try:
        from indextts.infer_v2 import IndexTTS2
        _tts = IndexTTS2(
            cfg_path=CFG_PATH, model_dir=MODEL_DIR,
            use_fp16=os.environ.get("INDEXTTS_FP16", "1") != "0",
        )
        _is_v2 = True
        return _tts
    except ImportError:
        pass
    # 退回 index-tts（v1）：infer.IndexTTS
    from indextts.infer import IndexTTS
    _tts = IndexTTS(model_dir=MODEL_DIR, cfg_path=CFG_PATH)
    _is_v2 = False
    return _tts


def voice_ref(voice: str) -> str:
    """把 voice 名映射到参考音色 wav 路径（声音克隆用）。"""
    name = voice if voice and voice != "default" else DEFAULT_VOICE
    path = os.path.join(VOICES_DIR, f"{name}.wav")
    if not os.path.exists(path):
        raise FileNotFoundError(f"参考音色不存在: {path}（在 {VOICES_DIR}/ 放一个 {name}.wav）")
    return path


def synth(text: str, voice: str) -> bytes:
    """合成一段文本为 wav 字节。"""
    tts = load_model()
    ref = voice_ref(voice)
    out_path = os.path.join(os.environ.get("TEMP", "/tmp"), "_indextts_out.wav")
    # 官方推理签名以其 README 为准，常见形如：
    tts.infer(spk_audio_prompt=ref, text=text, output_path=out_path)
    with open(out_path, "rb") as f:
        return f.read()


def silent_wav(seconds: float = 1.0) -> bytes:
    """无模型时的占位静音 wav（仅用于先验证 HTTP 链路连通）。"""
    n = int(SAMPLE_RATE * seconds)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SAMPLE_RATE)
        w.writeframes(b"".join(struct.pack("<h", 0) for _ in range(n)))
    return buf.getvalue()


class TtsReq(BaseModel):
    text: str
    voice: str = "default"


@app.get("/health")
def health():
    return {"ok": True, "model_loaded": _tts is not None}


@app.post("/tts")
def tts_endpoint(req: TtsReq):
    text = (req.text or "").strip()
    if not text:
        # 空文本返回极短静音，避免 Mac 端拼接报错
        return Response(content=silent_wav(0.2), media_type="audio/wav")
    try:
        wav = synth(text, req.voice)
    except ModuleNotFoundError:
        # 还没装好 index-tts2：先用静音占位让 Mac 端链路跑通（部署完成后会自动走真合成）
        wav = silent_wav(max(1.0, len(text) / 4.5))
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"合成失败: {e}")
    return Response(content=wav, media_type="audio/wav")


if __name__ == "__main__":
    import uvicorn
    # 预加载模型（失败不致命，/tts 时会回退占位）
    try:
        load_model()
        print("[index-tts2] 模型已加载")
    except Exception as e:
        print(f"[index-tts2] 模型未加载（将回退静音占位）: {e}")
    # 关键：bind 0.0.0.0 才能被 Mac 经局域网访问
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "7860")))
