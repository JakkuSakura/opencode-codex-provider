import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseToml } from "../src/toml";
import { loadCodexConfig, resolveModel } from "../src/config";

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "codex-provider-"));
}

test("parseToml handles inline tables and comments", () => {
  const input = `
model = "gpt-5.2-codex" # comment
model_provider = "tabcode"

[model_providers.tabcode]
name = "openai"
base_url = "https://api.example.com/v1"
wire_api = "responses"
http_headers = { "X-Test" = "ok" }
`;
  const parsed = parseToml(input);
  assert.equal(parsed.model, "gpt-5.2-codex");
  const providers = parsed.model_providers as Record<string, any>;
  assert.equal(providers.tabcode.base_url, "https://api.example.com/v1");
  assert.equal(providers.tabcode.http_headers["X-Test"], "ok");
});

test("loadCodexConfig resolves api key from auth.json", () => {
  const dir = makeTempDir();
  fs.writeFileSync(
    path.join(dir, "config.toml"),
    `model_provider = "tabcode"\nmodel = "gpt-5.2-codex"\n\n[model_providers.tabcode]\nname = "openai"\nbase_url = "https://api.example.com/v1"\nwire_api = "responses"\nrequires_openai_auth = true\n`,
  );
  fs.writeFileSync(
    path.join(dir, "auth.json"),
    JSON.stringify({ OPENAI_API_KEY: "sk-test" }),
  );

  const cfg = loadCodexConfig({ codexHome: dir });
  assert.equal(cfg.apiKey, "sk-test");
  assert.equal(cfg.baseUrl, "https://api.example.com/v1");
});

test("loadCodexConfig falls back to OPENAI_API_KEY without env_key", () => {
  const dir = makeTempDir();
  fs.writeFileSync(
    path.join(dir, "config.toml"),
    `model_provider = "tabcode"\nmodel = "gpt-5.2-codex"\n\n[model_providers.tabcode]\nname = "custom"\nbase_url = "https://api.example.com/v1"\nwire_api = "responses"\n`,
  );
  fs.writeFileSync(
    path.join(dir, "auth.json"),
    JSON.stringify({ OPENAI_API_KEY: "sk-fallback" }),
  );

  const cfg = loadCodexConfig({ codexHome: dir });
  assert.equal(cfg.apiKey, "sk-fallback");
});

test("resolveModel prefers codex config unless disabled", () => {
  assert.equal(resolveModel("gpt-5.2", "foo"), "foo");
  assert.equal(resolveModel("gpt-5.2", "default"), "gpt-5.2");
});
