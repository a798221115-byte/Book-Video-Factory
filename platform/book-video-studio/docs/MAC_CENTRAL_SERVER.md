# Mac 中央后台部署

## 结构

- Mac：唯一的 Book Video Studio、SQLite 数据库、`work/` 产物目录和任务调度。
- Windows：通过浏览器访问 Mac；可额外运行 `workers/index_tts2/server.py` 作为 GPU/TTS Worker。
- 其他电脑：只访问 Mac，不运行第二套数据库。

## 访问地址

后台监听 `0.0.0.0:3000`。同一局域网中的设备访问：

```text
http://<Mac 局域网 IP>:3000
```

如果 Mac 的本地主机名是 `book-video-mac`、局域网地址是 `192.168.1.20`，可使用：

```text
http://book-video-mac.local:3000
http://192.168.1.20:3000
```

优先使用 `.local` 地址；路由器重新分配 IP 后它通常仍然有效。

不要把端口 3000 直接映射到公网。跨网络访问应使用 Tailscale 或其他可信 VPN。

## 数据位置

`.env` 中必须使用绝对路径：

```dotenv
DATA_DIR=/Users/<username>/Library/Application Support/BookVideoFactory/data
BOOK_VIDEO_PROJECT_ROOT=/absolute/path/to/Book-Video-Factory/platform
```

不要把 `app.db` 放入 OneDrive、iCloud Drive、NAS 或 SMB 共享目录供多台机器同时写入。

## Windows TTS Worker

Windows 按 `workers/index_tts2/README.md` 启动服务并放行 TCP 7860。然后在 Mac 的 `.env` 中填写：

```dotenv
INDEX_TTS2_URL=http://<Windows-IP>:7860
```

重启 Mac 后台，再从 Mac 验证：

```bash
curl http://<Windows-IP>:7860/health
```

## 服务管理

用户级 LaunchAgent 名称：

```text
com.book-video-factory.server
```

服务通过 `caffeinate -i` 运行：后台在线期间阻止 Mac 因空闲而进入系统睡眠，但允许显示器按系统设置关闭。退出用户登录后，用户级服务也会停止。

中央数据库与备份保存在 macOS 的用户级应用数据目录，避免 LaunchAgent 访问“文稿”目录时受到隐私保护限制：

```text
~/Library/Application Support/BookVideoFactory/data/app.db
~/Library/Application Support/BookVideoFactory/backups/database/
```

LaunchAgent 可以在不含中文的用户目录中放置一个备份入口脚本，再调用仓库内的 `scripts/backup-server-db.sh`，避免部分 macOS 后台任务错误解码中文路径。

日志：

```text
book-video-studio/logs/server.out.log
book-video-studio/logs/server.err.log
```

数据库备份 LaunchAgent：

```text
com.book-video-factory.backup
```

它每天执行 SQLite 在线备份。备份保存在：

```text
~/Library/Application Support/BookVideoFactory/backups/database/
```

备份不会自动删除，避免误删；请结合 Time Machine 对整个 `Book-Video-Factory` 目录做第二份备份。
