# 交接说明（给 Windows 上的 Claude）

## 你的唯一任务
在这台 **Windows（RTX 4070 Super）** 上，把 `server.py` 跑成一个常驻的 HTTP TTS 服务。
另一台 Mac 上的主项目会通过局域网调用它，把文字合成成真人声配音。
**你不需要、也不会拿到 Mac 上的 Next.js 主项目代码——只管把这个服务跑起来即可。**

## 本目录有什么
- `server.py`        —— FastAPI 服务（已写好，一般不用改）
- `requirements.txt` —— 服务本身的依赖（torch / index-tts2 本体要另装，见下）
- `README.md`        —— 完整部署步骤（Windows 原生，非 WSL2）

## 必须遵守的契约（Mac 端写死了，不能改）
- `GET  /health`            → `{"ok": true, "model_loaded": bool}`
- `POST /tts {text, voice}` → 200 + `audio/wav` 字节流；失败返回 4xx/5xx + 文本
- 服务必须 bind `0.0.0.0:7860`（不是 127.0.0.1，否则 Mac 连不上）
- 返回的 wav 采样率不限（Mac 端会统一转 24k/mono）

## 推荐执行顺序
1. 按 `README.md` 一、装 CUDA 版 PyTorch，确认 `torch.cuda.is_available()` 为 True。
2. 先**不装 index-tts2**，直接 `pip install -r requirements.txt` 然后 `python server.py`。
   - server.py 在没装 index-tts2 时会返回**静音占位 wav**，用来先验证服务能起、能被访问。
   - 本机自测：`curl http://127.0.0.1:7860/health`
3. 按 `README.md` 二，git clone index-tts2、装依赖、用 huggingface-cli 下权重到 `checkpoints/`，
   并在 `voices/default.wav` 放一段 5~10s 干净的目标人声（声音克隆参考音）。
4. 把 `server.py` 拷到 index-tts2 项目根（与 `checkpoints/`、`voices/` 同级）再 `python server.py`。
   - 启动日志出现 `[index-tts2] 模型已加载` = 成功加载真模型（不再是静音占位）。
5. 按 `README.md` 四，放行防火墙 7860；`ipconfig` 查本机 IPv4 地址，把这个 IP 告诉用户
   （用户要在 Mac 的 .env 里写 `INDEX_TTS2_URL=http://<这个IP>:7860`）。

## server.py 里你可能需要按实际情况调的地方
- 模型加载入口：现在优先 `from indextts.infer_v2 import IndexTTS2`，失败回退 v1 `infer.IndexTTS`。
  如果官方 index-tts2 的实际 import 路径/类名/构造参数与此不同，**以你 clone 下来的官方仓库
  README 为准**去改 `load_model()`。
- 推理签名：现在用 `tts.infer(spk_audio_prompt=ref, text=text, output_path=out_path)`。
  若官方签名不同（参数名/是否需要 emo、语速等），改 `synth()` 里这一行。
- 路径：`INDEXTTS_MODEL_DIR` / `INDEXTTS_CFG` / `INDEXTTS_VOICES` 可用环境变量覆盖。

## 自测命令（确认真合成可用）
```powershell
curl -X POST http://127.0.0.1:7860/tts -H "Content-Type: application/json" `
  -d "{\"text\":\"大家好，今天给大家分享一本好书。\",\"voice\":\"default\"}" --output test.wav
# 用播放器打开 test.wav，听到清晰人声即成功；若是静音说明还在占位模式（模型没加载上）
```
