# Windows (WSL2 + 4070 Super) 部署指南

本项目原在 macOS 开发。迁到 Windows 走 **WSL2（Ubuntu）**，4070S 用于本地 GPU 跑
TTS（index-tts2，已部署运行）。ASR 走云端腾讯云，配图固定走 gpt-image-2 云端，
跨平台无变化。

---

## 阶段 0：传代码

Mac 这边**不要**把 `node_modules/`、`.next/`、`models/`、`data/` 传过去（太大且平台相关）。
网盘只传项目源码即可。到 WSL2 后重新装依赖、重下模型。

> `.gitignore` 已忽略上述目录。若用网盘整目录拷贝，手动删掉 `node_modules .next models` 再传，
> `data/`（任务数据 80MB）可传可不传——想保留历史任务就传。
> **`.env` 含密钥，单独安全传输，不要进公开网盘分享链接。**

---

## 阶段 1：WSL2 基础环境

```bash
# 1. Windows PowerShell(管理员) 装 WSL2 + Ubuntu
wsl --install -d Ubuntu-22.04
# 重启后进入 Ubuntu，设用户名密码

# 2. WSL2 里装系统依赖
sudo apt update
sudo apt install -y ffmpeg python3 python3-pip fonts-noto-cjk build-essential git
# fonts-noto-cjk 是中文字幕字体（必装，否则 render 报"未找到中文字体"）
pip3 install pillow

# 3. 装 Node 20+（用 nvm）
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc
nvm install 20 && nvm use 20

# 4. 验证
ffmpeg -version | head -1
python3 -c "from PIL import Image; print('Pillow OK')"
fc-list :lang=zh | head   # 应列出中文字体
node --version
```

## 阶段 2：跑起来（先用云端，验证全链）

```bash
cd ~/book-video-studio   # 你放代码的位置
npm install              # 会重新编译 better-sqlite3 原生模块
cp .env.example .env     # 然后填入密钥（或直接用传过来的 .env）

# 关键 .env 配置（先全走云端，最稳）：
#   TIKHUB_API_KEY=...          抖音采集
#   OPENAI_*=...                改写/清洗(gpt-5.5)
#   DEEPSEEK_*=...              书名识别
#   TENCENT_SECRET_ID/KEY=...   ASR(腾讯云，跨平台可用)
#   IMAGE_*=...                 配图 gpt-image-2
#   ASR_API_KEY=                留空(中转站whisper不稳，直接走腾讯云)
#   INDEX_TTS2_URL=             阶段3填本地 worker 地址(此时留空 Linux 会用 Mock 静音)
#   SUBTITLE_FONT=/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc

npm run dev
# 浏览器开 localhost:3000，粘贴抖音链接，一键跑全链
# 此阶段 TTS 是 Mock 静音（Linux 无 say），其余真实。先确认链路通。
```

## 阶段 3：接 4070S 本地 GPU（TTS 真人声）

### 本地 TTS：index-tts2（4070S 真人声/声音克隆，已部署运行）
```bash
# worker 在 workers/index_tts2/server.py，已按 index-tts2 官方 repo 装好权重并运行
cd ~/book-video-studio/workers/index_tts2
pip3 install -r requirements.txt   # (按 index-tts2 官方 repo)
# 权重放 checkpoints/，启动常驻服务
python3 server.py    # 监听 :7860

# .env 配置：
#   INDEX_TTS2_URL=http://127.0.0.1:7860
# getTts() 检测到 URL 即优先用本地 TTS（真人声），不再 Mock
```

> ASR 固定走云端腾讯云（质量最好且自带标点），不部署本地 whisper.cpp。
> 配图固定走云端 gpt-image-2，不部署本地 SDXL/ComfyUI。

---

## WSL2 注意事项

- **GPU 直通**：WSL2 需 Windows 侧装 NVIDIA 驱动（含 WSL CUDA 支持），WSL 内**不要**再装驱动，
  只装 CUDA Toolkit。验证：WSL 里 `nvidia-smi` 能看到 4070S。
- **文件放 WSL 内**：项目放在 `~/`（WSL 文件系统）而非 `/mnt/c/`，否则 IO 极慢。
- **端口**：WSL2 的 localhost 默认与 Windows 互通，浏览器直接开 `localhost:3000`。
- **字体**：`fonts-noto-cjk` 必装；render 会自动探测，找不到会明确报错。

---

## 跨平台兼容点（已在代码中处理）

| 组件 | 处理方式 |
|------|---------|
| 字幕字体 | `findFont()` 自动探测 macOS + Linux 路径，支持 `SUBTITLE_FONT` 覆盖 |
| TTS | Linux 无 `say`，`getTts()` 自动走 index-tts2(已部署) → Replicate → Mock |
| ASR | 固定走云端腾讯云（质量最好且自带标点），不走本地 whisper.cpp |
| 配图 | 固定走云端 gpt-image-2，不走本地 SDXL/ComfyUI |
| sqlite | `npm install` 自动按平台编译 better-sqlite3 |
| 临时文件 | 用 `os.tmpdir()`，跨平台 |
