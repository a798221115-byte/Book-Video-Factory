# index-tts2 远程 TTS 服务（Windows + RTX 4070 Super）

把改写稿合成为真人声配音的常驻服务。**部署在 Windows（用 4070S 推理），Mac 经局域网 HTTP 调用。**
Mac 主项目除 TTS 外全部本地跑，只把这一步外包给 Windows GPU。

```
Mac (主项目, 6步流水线)  ──HTTP POST /tts {text,voice}──►  Windows (本服务, 4070S 推理)
        tts 步骤逐段调用          ◄──── audio/wav 字节 ────          index-tts2 合成
```

## 契约（勿改，Mac 端 `lib/providers/tts.ts` 依赖）
- `GET  /health` → `{"ok":true,"model_loaded":bool}`
- `POST /tts {text, voice}` → 200 + `audio/wav` 字节流；失败 4xx/5xx + 文本
- Mac 端会把返回的 wav 统一转 24k/mono，故采样率不强制。

---

## 一、Windows 端部署（原生 Windows，不用 WSL2）

### 1. 装 Python + CUDA 版 PyTorch
```powershell
# 装 Python 3.10/3.11（python.org），勾选 Add to PATH
# 装 NVIDIA 驱动（最新 Game Ready/Studio 即可，自带 CUDA 运行时）
python -m venv venv
venv\Scripts\activate
# CUDA 12.1 版 PyTorch（4070S 适用；版本以 pytorch.org 当前为准）
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121
python -c "import torch; print('CUDA可用:', torch.cuda.is_available(), torch.cuda.get_device_name(0))"
# 应打印 CUDA可用: True NVIDIA GeForce RTX 4070 SUPER
```

### 2. 装 index-tts2 + 下权重
```powershell
git clone https://github.com/index-tts/index-tts2
cd index-tts2
pip install -r requirements.txt
pip install -e .          # 让 `import indextts` 可用

# 下载权重到 checkpoints/（推荐用 huggingface-cli；含 config.yaml 与各子模型）
pip install huggingface-hub
huggingface-cli download IndexTeam/IndexTTS-2 --local-dir checkpoints
# 国内网络可加镜像：set HF_ENDPOINT=https://hf-mirror.com 再执行上面命令

# 准备参考音色：把一段 5~10s 干净的目标人声 wav 放到 voices/default.wav（声音克隆用）
```

> server.py 会优先按 **index-tts2（v2）** 的 `infer_v2.IndexTTS2` 加载（4070S 默认开 fp16
> 省显存提速，可用 `set INDEXTTS_FP16=0` 关闭）；若仓库只有 v1 则自动回退 `infer.IndexTTS`。

### 3. 放入本服务并启动
```powershell
# 把本目录的 server.py 拷到 index-tts2 项目根（与 checkpoints/ voices/ 同级）
pip install fastapi uvicorn
# 可选环境变量覆盖默认路径：
#   set INDEXTTS_MODEL_DIR=checkpoints
#   set INDEXTTS_CFG=checkpoints\config.yaml
#   set INDEXTTS_VOICES=voices
#   set INDEXTTS_DEFAULT_VOICE=default
#   set INDEXTTS_FP16=0        （关闭 fp16，显存够时可不设）
python server.py
# 看到 "[index-tts2] 模型已加载" + uvicorn 监听 0.0.0.0:7860 即成功
```

> **未装好模型也能先启动**：server.py 在 `import indextts` 失败时会用**静音占位**返回，
> 用于先打通 Mac↔Windows 的 HTTP 链路；装好权重后自动切换为真合成。

### 4. 放行防火墙端口 7860
```powershell
# 管理员 PowerShell
New-NetFirewallRule -DisplayName "index-tts2" -Direction Inbound -LocalPort 7860 -Protocol TCP -Action Allow
```

### 5. 查本机局域网 IP
```powershell
ipconfig   # 找 "IPv4 地址"，如 192.168.1.23
```

---

## 二、Mac 端配置

`.env` 里设（IP 换成上一步 Windows 的）：
```
INDEX_TTS2_URL=http://192.168.1.23:7860
# 可选：单段合成超时(ms)，默认 120000
INDEX_TTS2_TIMEOUT_MS=120000
```
重启 `next dev`。`getTts()` 检测到 URL 即自动用远程真人声，不再 Mock/say。

---

## 三、连通性自检

```bash
# Mac 上测健康检查
curl http://192.168.1.23:7860/health
# 期望 {"ok":true,"model_loaded":true}

# 测合成（存成 wav 听一下）
curl -X POST http://192.168.1.23:7860/tts \
  -H "Content-Type: application/json" \
  -d '{"text":"大家好，今天给大家分享一本好书。","voice":"default"}' \
  --output /tmp/test.wav
afplay /tmp/test.wav   # Mac 播放
```

连不上排查顺序：
1. 两台机器同一局域网？Mac `ping 192.168.1.23` 通不通。
2. Windows 服务是否 bind `0.0.0.0`（不是 127.0.0.1）——本 server.py 已是 0.0.0.0。
3. Windows 防火墙 7860 是否放行（见步骤 4）。
4. Windows 杀软/公司网络是否拦截局域网入站。

---

## 四、与主流程的关系

- Mac 的 `tts` 步骤（`lib/steps/tts.ts`）：先用 LLM 把改写稿按附件F拆段，**逐段**调本服务，
  再用 ffmpeg concat 成 `tts.wav`。所以本服务每次只处理一段（规避单次字数上限）。
- 真人声接上后，`subtitle` 步骤会自动启用真实 whisper 词级对齐（不再按字数估时）。
- 停顿规则：Mac 端 `lib/tts-pause.ts` 已实现标点→停顿，如需可在拆段后注入停顿标记再发送
  （取决于 index-tts2 是否识别 `<break>` 标记，按实测调整）。
