import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readJsonFile, resolveSettings, stripJsoncComments } from "../src/config.ts";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "pi-vision-test-"));
}

test("stripJsoncComments removes comments and trailing commas", () => {
  const jsonc = `{
    // line comment
    "model": "qwen-vl-max", /* block
    comment */
    "baseUrl": "https://x.example/v1",
  }`;
  assert.deepEqual(JSON.parse(stripJsoncComments(jsonc)), {
    model: "qwen-vl-max",
    baseUrl: "https://x.example/v1",
  });
});

test("readJsonFile returns null for missing or broken files", () => {
  const dir = tempDir();
  try {
    assert.equal(readJsonFile(join(dir, "nope.json")), null);
    const broken = join(dir, "broken.json");
    writeFileSync(broken, "{ not json");
    assert.equal(readJsonFile(broken), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("precedence: project > global > env > default", () => {
  const dir = tempDir();
  const prevModel = process.env.VISION_MODEL;
  const prevUrl = process.env.VISION_BASE_URL;
  try {
    const global = join(dir, "vision.json");
    const projectDir = join(dir, "proj");
    const piDir = join(projectDir, ".pi");
    mkdirSync(piDir, { recursive: true });
    const project = join(piDir, "vision.json");
    const untrustedProject = join(dir, "untrusted");
    mkdirSync(join(untrustedProject, ".pi"), { recursive: true });
    const untrustedConfig = join(untrustedProject, ".pi", "vision.json");

    writeFileSync(global, JSON.stringify({ model: "global-model", baseUrl: "https://global/v1" }));
    writeFileSync(project, JSON.stringify({ model: "project-model" }));
    writeFileSync(untrustedConfig, JSON.stringify({ model: "should-not-load" }));
    process.env.VISION_MODEL = "env-model";
    process.env.VISION_BASE_URL = "https://env/v1";

    // project wins over global and env
    let s = resolveSettings({
      cwd: projectDir,
      trusted: true,
      globalConfigPath: global,
    });
    assert.equal(s.model, "project-model");
    assert.equal(s.source.model, "project-config");
    assert.equal(s.baseUrl, "https://global/v1"); // project only sets model

    // untrusted project: config file must not be honored
    s = resolveSettings({
      cwd: untrustedProject,
      trusted: false,
      globalConfigPath: global,
    });
    assert.equal(s.model, "global-model");
    assert.equal(s.source.model, "global-config");

    // no project config: global over env
    s = resolveSettings({ cwd: projectDir, trusted: true, globalConfigPath: global });
    writeFileSync(project, "{}");
    s = resolveSettings({ cwd: projectDir, trusted: true, globalConfigPath: global });
    // now project file exists but sets nothing -> global still wins
    assert.equal(s.model, "global-model");

    // no files at all: env wins
    const empty = join(dir, "empty.json");
    s = resolveSettings({ cwd: projectDir, trusted: true, globalConfigPath: empty });
    assert.equal(s.model, "env-model");
    assert.equal(s.source.model, "env");
    assert.equal(s.baseUrl, "https://env/v1");

    // nothing set: built-in defaults
    delete process.env.VISION_MODEL;
    delete process.env.VISION_BASE_URL;
    s = resolveSettings({ globalConfigPath: empty });
    assert.equal(s.model, "glm-4.6v");
    assert.equal(s.baseUrl, "https://open.bigmodel.cn/api/coding/paas/v4");
    assert.equal(s.source.model, "default");
  } finally {
    if (prevModel === undefined) delete process.env.VISION_MODEL;
    else process.env.VISION_MODEL = prevModel;
    if (prevUrl === undefined) delete process.env.VISION_BASE_URL;
    else process.env.VISION_BASE_URL = prevUrl;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("apiKey comes from global config when present", () => {
  const dir = tempDir();
  const prevKey = process.env.VISION_API_KEY;
  try {
    const global = join(dir, "vision.json");
    writeFileSync(global, JSON.stringify({ apiKey: "sk-from-file" }));
    let s = resolveSettings({ globalConfigPath: global });
    assert.equal(s.apiKey, "sk-from-file");
    assert.equal(s.source.apiKey, "global-config");

    process.env.VISION_API_KEY = "sk-from-env";
    s = resolveSettings({ globalConfigPath: join(dir, "none.json") });
    assert.equal(s.apiKey, "sk-from-env");
    assert.equal(s.source.apiKey, "env");
  } finally {
    if (prevKey === undefined) delete process.env.VISION_API_KEY;
    else process.env.VISION_API_KEY = prevKey;
    rmSync(dir, { recursive: true, force: true });
  }
});
