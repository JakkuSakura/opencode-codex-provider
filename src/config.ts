import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseToml, TomlTable } from "./toml.js";

export type ProviderConfig = {
  name?: string;
  base_url?: string;
  env_key?: string;
  query_params?: Record<string, string | number | boolean>;
  http_headers?: Record<string, string>;
  env_http_headers?: Record<string, string>;
  requires_openai_auth?: boolean;
};

export type CodexConfig = {
  codexHome: string;
  providerId: string;
  model: string;
  baseUrl?: string;
  apiKey?: string | null;
  headers: Record<string, string>;
  queryParams?: Record<string, string | number | boolean> | null;
};

type ServerConfig = {
  api_key?: string;
  base_url?: string;
};

type ModelServerOverride = {
  servers?: Record<string, ServerConfig>;
  server?: string;
};

type PricingConfig = {
  input_per_mtoken?: number;
  output_per_mtoken?: number;
};

export type CodexProviderOptions = {
  name?: string;
  codexHome?: string;
  servers?: Record<string, ServerConfig>;
  server?: string;
  modelServers?: Record<string, ModelServerOverride>;
  pricing?: PricingConfig;
  instructions?: string;
  instructionsFile?: string;
  userInstructionsFile?: string;
  includeUserInstructions?: boolean;
};

function isProviderConfig(value: TomlTable | undefined): ProviderConfig {
  return (value ?? {}) as ProviderConfig;
}

function readJsonIfExists(filePath: string): Record<string, string> | null {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return null;
  }
}


function resolveBaseUrl(providerId: string, providerConfig: ProviderConfig): string | undefined {
  if (providerConfig.base_url) return providerConfig.base_url;
  if (providerId === "openai") return "https://api.openai.com/v1";
  return undefined;
}

function resolveRequiresOpenaiAuth(providerId: string, providerConfig: ProviderConfig): boolean {
  if (typeof providerConfig.requires_openai_auth === "boolean") return providerConfig.requires_openai_auth;
  return providerId === "openai";
}

function resolveApiKey(
  requiresOpenaiAuth: boolean,
  envKey: string | null,
  auth: Record<string, string>,
): string | null {
  if (envKey) {
    return process.env[envKey] || auth[envKey] || null;
  }
  if (requiresOpenaiAuth) {
    return process.env.OPENAI_API_KEY || auth.OPENAI_API_KEY || auth._OPENAI_API_KEY || null;
  }
  return process.env.OPENAI_API_KEY || auth.OPENAI_API_KEY || auth._OPENAI_API_KEY || null;
}

function buildServersFromCodex(
  providerTable: TomlTable,
  auth: Record<string, string>,
): Record<string, ServerConfig> {
  const servers: Record<string, ServerConfig> = {};
  for (const [providerId, value] of Object.entries(providerTable)) {
    const providerConfig = isProviderConfig(value as TomlTable | undefined);
    const baseUrl = resolveBaseUrl(providerId, providerConfig);
    const requiresOpenaiAuth = resolveRequiresOpenaiAuth(providerId, providerConfig);
    const envKey = providerConfig.env_key ?? (requiresOpenaiAuth ? "OPENAI_API_KEY" : null);
    const apiKey = resolveApiKey(requiresOpenaiAuth, envKey, auth);
    servers[providerId] = {
      api_key: apiKey ?? undefined,
      base_url: baseUrl,
    };
  }
  return servers;
}

export function loadCodexConfig(options: CodexProviderOptions = {}): CodexConfig {
  const codexHome =
    options.codexHome ?? process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex");

  const configPath = path.join(codexHome, "config.toml");
  const authPath = path.join(codexHome, "auth.json");

  const auth = readJsonIfExists(authPath) ?? {};
  const config: TomlTable = fs.existsSync(configPath)
    ? parseToml(fs.readFileSync(configPath, "utf8"))
    : { model_providers: {} };

  const providerId = (config.model_provider as string | undefined) ?? "openai";
  const model = (config.model as string | undefined) ?? "gpt-5-codex";
  const providerTable = (config.model_providers as TomlTable | undefined) ?? {};

  const codexServers = buildServersFromCodex(providerTable, auth);
  const mergedServers = { ...codexServers, ...(options.servers ?? {}) };

  const modelOverride = options.modelServers?.[model] ?? {};
  const modelServers = modelOverride.servers
    ? { ...mergedServers, ...modelOverride.servers }
    : mergedServers;

  const selectedServer = modelOverride.server ?? options.server ?? providerId;
  const selected = modelServers[selectedServer];
  const selectedProviderConfig = isProviderConfig(
    providerTable[selectedServer] as TomlTable | undefined,
  );

  const baseUrl = selected?.base_url ?? resolveBaseUrl(selectedServer, selectedProviderConfig);
  const requiresOpenaiAuth = resolveRequiresOpenaiAuth(selectedServer, selectedProviderConfig);
  const envKey = selectedProviderConfig.env_key ?? (requiresOpenaiAuth ? "OPENAI_API_KEY" : null);
  const apiKey = selected?.api_key ?? resolveApiKey(requiresOpenaiAuth, envKey, auth);

  const headers: Record<string, string> = { ...(selectedProviderConfig.http_headers ?? {}) };
  const envHeaders = selectedProviderConfig.env_http_headers ?? {};
  for (const [header, envVar] of Object.entries(envHeaders)) {
    const value = process.env[envVar];
    if (value && value.trim()) headers[header] = value;
  }

  return {
    codexHome,
    providerId: selectedServer,
    model,
    baseUrl,
    apiKey,
    headers,
    queryParams: selectedProviderConfig.query_params ?? null,
  };
}

export function resolveModel(
  configModel: string,
  modelId: string | undefined,
): string {
  if (modelId && modelId !== "default") return modelId;
  return configModel;
}

export function applyQueryParams(
  baseUrl: string,
  queryParams?: Record<string, string | number | boolean> | null,
): string {
  if (!queryParams || Object.keys(queryParams).length === 0) return baseUrl;
  const url = new URL(baseUrl);
  for (const [key, value] of Object.entries(queryParams)) {
    if (value === undefined || value === null) continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}
