/**
 * @lykling/pi-vision — on-demand vision tool for the Pi coding agent.
 *
 * Keep the main session on a text coding/analysis model; when the user asks to
 * look at an image, the agent calls the `see` tool, which forwards the image to
 * a configurable vision model and returns its textual answer.
 *
 * Configuration (config files first, env as fallback):
 *   1. <project>/.pi/vision.json   (trusted projects only, JSONC ok)
 *   2. ~/.pi/agent/vision.json     (global, JSONC ok)
 *   3. VISION_MODEL / VISION_BASE_URL / VISION_API_KEY
 *   4. defaults: glm-4.6v @ bigmodel coding endpoint,
 *      key from ~/.pi/agent/auth.json "zai-coding-cn".key
 */
import { CONFIG_DIR_NAME, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { readFileSync } from "node:fs";
import { resolveSettings } from "./config.ts";

const MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
};

function toImageUrl(path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  const buf = readFileSync(path); // missing file throws, caught by caller
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const mime = MIME[ext] ?? "image/jpeg";
  const b64 = buf.toString("base64");
  if (b64.length > 5 * 1024 * 1024) {
    throw new Error(`image base64 exceeds 5MB (${path}), downscale it first`);
  }
  return `data:${mime};base64,${b64}`;
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "see",
    label: "看图",
    description:
      "调用视觉模型查看一张图片并回答问题。当用户让你看照片/截图/识别图片内容时使用。" +
      "image 传本地路径或 http(s) URL；prompt 传想让视觉模型回答的问题。",
    parameters: Type.Object({
      image: Type.String({ description: "图片的本地路径或 http(s) URL" }),
      prompt: Type.String({
        description: "想让视觉模型回答的问题，例如'这张图里是什么硬件？丝印写了什么？'",
      }),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      // Per-call resolution: config file edits take effect without /reload.
      const settings = resolveSettings({
        cwd: ctx.cwd,
        trusted: ctx.isProjectTrusted(),
        configDirName: CONFIG_DIR_NAME,
      });

      if (!settings.apiKey) {
        return {
          content: [
            {
              type: "text" as const,
              text:
                "错误：无可用 API key。配置方式任选其一：" +
                "~/.pi/agent/vision.json 的 apiKey、项目 .pi/vision.json 的 apiKey、" +
                "环境变量 VISION_API_KEY，或确保 ~/.pi/agent/auth.json 里有 zai-coding-cn.key",
            },
          ],
          details: {},
        };
      }

      let imageUrl: string;
      try {
        imageUrl = toImageUrl(params.image);
      } catch (e) {
        return {
          content: [{ type: "text" as const, text: `读取图片失败：${e}` }],
          details: {},
        };
      }

      try {
        const resp = await fetch(`${settings.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${settings.apiKey}`,
          },
          body: JSON.stringify({
            model: settings.model,
            messages: [
              {
                role: "user",
                content: [
                  { type: "image_url", image_url: { url: imageUrl } },
                  { type: "text", text: params.prompt },
                ],
              },
            ],
            max_tokens: 2048,
          }),
          signal,
        });
        if (!resp.ok) {
          const t = await resp.text().catch(() => "");
          return {
            content: [
              {
                type: "text" as const,
                text: `视觉模型 API 错误 HTTP ${resp.status}: ${t.slice(0, 300)}`,
              },
            ],
            details: { model: settings.model, baseUrl: settings.baseUrl },
          };
        }
        const j = (await resp.json()) as ChatCompletionResponse;
        const text =
          j?.choices?.[0]?.message?.content ??
          `视觉模型返回了无法解析的内容：${JSON.stringify(j).slice(0, 400)}`;
        return {
          content: [{ type: "text" as const, text }],
          details: {
            model: settings.model,
            baseUrl: settings.baseUrl,
            configSource: settings.source,
            image: params.image,
          },
        };
      } catch (e) {
        if ((e as Error).name === "AbortError") {
          return {
            content: [{ type: "text" as const, text: "视觉模型调用已取消" }],
            details: {},
          };
        }
        return {
          content: [{ type: "text" as const, text: `视觉模型调用失败：${e}` }],
          details: { model: settings.model, baseUrl: settings.baseUrl },
        };
      }
    },
  });
}
