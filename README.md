# Book Video Factory

视频号图书视频生产工作台与 Codex 技能的统一仓库。

## 目录

- `platform/`：Book Video Studio 源码、项目规范、飞书集成模板和运维文档。
- `skills/produce-wechat-book-video/`：从抖音参考链接到微信读书取证、二创文案、分镜、默认女声后期、剪映草稿和封面的完整 Codex skill。

## 版本

当前版本：`1.1.3`

仓库使用语义化版本：

- PATCH：兼容性修正、文档或配置更新。
- MINOR：向后兼容的新功能。
- MAJOR：不兼容的流程、目录或接口变更。

每次修改工作平台或 `produce-wechat-book-video` skill 后，都应先运行最小验证，再递增版本、创建一次独立提交并立即推送。

## 安全边界

仓库不保存密钥、真实飞书绑定、`.env.local`、数据库、日志、缓存、依赖目录、模型、单次 `work/` 项目、最终视频或其他生成产物。请从 `.env.example` 和 `feishu-book-pipeline.example.json` 创建本地配置。
