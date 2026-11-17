# @lykling/pi-vision

Pi coding agent 的按需视觉工具：主会话继续用文本模型做编码与分析，
需要识图时由 agent 调用 `see` 工具，把图片转发给可配置的视觉模型并返回文字回答。

## 安装

```bash
pi install npm:@lykling/pi-vision
```

然后 `/reload`（或重启 pi）。agent 的工具列表里会出现 `see`。

## 工具

**see(image, prompt)** — 查看一张图片并回答问题。

- `image`：本地路径或 http(s) URL（png/jpg/webp/gif/bmp，base64 后 ≤5MB）
- `prompt`：想让视觉模型回答的问题

触发逻辑是标准 LLM function calling：你让 agent "看看这张图/识别照片"，
agent 根据工具描述发起调用，视觉模型的文字回答作为 tool result 回到对话。

## 配置

优先级从高到低（**配置文件为主，环境变量只是 fallback**）：

| 优先级 | 来源 | 说明 |
|---|---|---|
| 1 | `<项目>/.pi/vision.json` | 仅受信项目加载，支持 JSONC 注释 |
| 2 | `~/.pi/agent/vision.json` | 全局，支持 JSONC 注释 |
| 3 | `VISION_MODEL` / `VISION_BASE_URL` / `VISION_API_KEY` | 环境变量 |
| 4 | 内置默认 | `glm-4.6v` @ `https://open.bigmodel.cn/api/coding/paas/v4`；key 复用 `~/.pi/agent/auth.json` 的 `zai-coding-cn.key` |

字段：

```jsonc
// ~/.pi/agent/vision.json 示例
{
  "model": "glm-4.6v",                      // 任意 OpenAI 兼容视觉模型
  "baseUrl": "https://open.bigmodel.cn/api/coding/paas/v4",
  "apiKey": "sk-..."                        // 缺省时读 auth.json，一般不用填
}
```

换后端示例（通义千问 VL）：

```json
{
  "model": "qwen-vl-max-latest",
  "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
  "apiKey": "sk-xxx"
}
```

配置在每次工具调用时解析，改完文件即生效，无需 `/reload`。
每次调用的 details 里会标注实际命中的配置来源（project-config / global-config / env / default / auth.json）。

## 开发

```bash
npm install
npm run typecheck
npm test
```

发布走 GitHub Actions OIDC trusted publishing（见 `.github/workflows/publish.yml`）：
npmjs.com 上为 `lykling/pi-vision` 配置 Trusted Publisher（workflow 文件名 `publish.yml`），
然后打 tag `v*` 推送即可。

## License

MIT
