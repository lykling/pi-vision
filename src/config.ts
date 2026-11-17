import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Settings for the vision backend, resolved from config files, env, defaults. */
export interface VisionSettings {
  model: string;
  baseUrl: string;
  apiKey: string | undefined;
  /** Human-readable source of each resolved field, for tool result details. */
  source: { model: string; baseUrl: string; apiKey: string };
}

/** Injection point for tests and project-local resolution. */
export interface ResolveOptions {
  /** Project directory; project config is read from <cwd>/.pi/vision.json. */
  cwd?: string;
  /** Whether the project is trusted. Project config is only honored when true. */
  trusted?: boolean;
  /** Config dir name inside the project (pi convention: ".pi", rebrandable). */
  configDirName?: string;
  /** Override paths for tests. */
  globalConfigPath?: string;
  projectConfigPath?: string;
}

const DEFAULT_MODEL = "glm-4.6v";
const DEFAULT_BASE_URL = "https://open.bigmodel.cn/api/coding/paas/v4";

/**
 * Strip line and block comments plus trailing commas so JSONC files parse.
 * Same approach as @lykling/pi-supermemory config.
 */
export function stripJsoncComments(content: string): string {
  let result = "";
  let i = 0;
  let inString = false;
  let inSingleLineComment = false;
  let inMultiLineComment = false;
  while (i < content.length) {
    const char = content[i];
    const nextChar = content[i + 1];
    if (!inSingleLineComment && !inMultiLineComment) {
      if (char === '"') {
        let backslashCount = 0;
        let j = i - 1;
        while (j >= 0 && content[j] === "\\") {
          backslashCount++;
          j--;
        }
        if (backslashCount % 2 === 0) {
          inString = !inString;
        }
        result += char;
        i++;
        continue;
      }
    }
    if (inString) {
      result += char;
      i++;
      continue;
    }
    if (!inSingleLineComment && !inMultiLineComment) {
      if (char === "/" && nextChar === "/") {
        inSingleLineComment = true;
        i += 2;
        continue;
      }
      if (char === "/" && nextChar === "*") {
        inMultiLineComment = true;
        i += 2;
        continue;
      }
    }
    if (inSingleLineComment) {
      if (char === "\n") {
        inSingleLineComment = false;
        result += char;
      }
      i++;
      continue;
    }
    if (inMultiLineComment) {
      if (char === "*" && nextChar === "/") {
        inMultiLineComment = false;
        i += 2;
        continue;
      }
      if (char === "\n") {
        result += char;
      }
      i++;
      continue;
    }
    result += char;
    i++;
  }
  return result.replace(/,\s*([}\]])/g, "$1");
}

/** Read and parse a JSON or JSONC file, returning null on any failure. */
export function readJsonFile(path: string): Record<string, unknown> | null {
  try {
    if (!existsSync(path)) return null;
    const raw = readFileSync(path, "utf-8");
    return JSON.parse(stripJsoncComments(raw)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Fallback API key: reuse the pi zai-coding-cn credential. */
function authJsonKey(): string | undefined {
  try {
    const auth = readJsonFile(join(homedir(), ".pi", "agent", "auth.json"));
    const key = auth?.["zai-coding-cn"];
    if (key && typeof key === "object") {
      const v = (key as Record<string, unknown>).key;
      return typeof v === "string" && v.trim() ? v.trim() : undefined;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolve vision backend settings.
 *
 * Precedence (config files first, env as fallback, built-ins last):
 * 1. <project>/.pi/vision.json   — only when the project is trusted
 * 2. ~/.pi/agent/vision.json     — global (JSONC allowed)
 * 3. VISION_MODEL / VISION_BASE_URL / VISION_API_KEY env vars
 * 4. built-in defaults (glm-4.6v on the bigmodel coding endpoint;
 *    apiKey falls back to ~/.pi/agent/auth.json "zai-coding-cn".key)
 */
export function resolveSettings(options: ResolveOptions = {}): VisionSettings {
  const globalPath =
    options.globalConfigPath ?? join(homedir(), ".pi", "agent", "vision.json");
  const projectPath =
    options.projectConfigPath ??
    (options.cwd !== undefined
      ? join(options.cwd, options.configDirName ?? ".pi", "vision.json")
      : undefined);

  const projectConfig =
    options.trusted && projectPath ? readJsonFile(projectPath) : null;
  const globalConfig = readJsonFile(globalPath);

  const pick = (
    projectValue: unknown,
    globalValue: unknown,
    envValue: string | undefined,
    fallback: string | undefined,
  ): { value: string | undefined; source: string } => {
    const first = (v: unknown): string | undefined =>
      typeof v === "string" && v.trim() ? v.trim() : undefined;
    if (first(projectValue)) {
      return { value: first(projectValue), source: "project-config" };
    }
    if (first(globalValue)) {
      return { value: first(globalValue), source: "global-config" };
    }
    if (envValue && envValue.trim()) {
      return { value: envValue.trim(), source: "env" };
    }
    return { value: fallback, source: "default" };
  };

  const model = pick(projectConfig?.model, globalConfig?.model, process.env.VISION_MODEL, DEFAULT_MODEL);
  const baseUrl = pick(
    projectConfig?.baseUrl,
    globalConfig?.baseUrl,
    process.env.VISION_BASE_URL,
    DEFAULT_BASE_URL,
  );
  const apiKey = pick(
    projectConfig?.apiKey,
    globalConfig?.apiKey,
    process.env.VISION_API_KEY,
    authJsonKey(),
  );
  if (apiKey.source === "default" && apiKey.value) apiKey.source = "auth.json";

  return {
    model: model.value as string,
    baseUrl: baseUrl.value as string,
    apiKey: apiKey.value,
    source: { model: model.source, baseUrl: baseUrl.source, apiKey: apiKey.source },
  };
}
