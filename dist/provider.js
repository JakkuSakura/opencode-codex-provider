import { createOpenAI } from "@ai-sdk/openai";
import { applyQueryParams, loadCodexConfig, resolveModel } from "./config";
export function selectModel(client, wireApi, modelId) {
    return wireApi === "chat" ? client.chat(modelId) : client.responses(modelId);
}
function extractInstructions(prompt) {
    if (!prompt || typeof prompt !== "object")
        return undefined;
    if (prompt.type !== "messages")
        return undefined;
    const messages = Array.isArray(prompt.messages) ? prompt.messages : [];
    const systemTexts = messages
        .filter((msg) => msg?.role === "system")
        .map((msg) => {
        if (typeof msg.content === "string")
            return msg.content;
        if (Array.isArray(msg.content)) {
            return msg.content
                .filter((part) => part?.type === "text" && typeof part.text === "string")
                .map((part) => part.text)
                .join("");
        }
        return "";
    })
        .filter((text) => text.trim().length > 0);
    if (systemTexts.length === 0)
        return undefined;
    return systemTexts.join("\n");
}
export function withResponsesInstructions(options) {
    const existing = options.providerOptions?.openai?.instructions;
    if (typeof existing === "string" && existing.length > 0)
        return options;
    const instructions = extractInstructions(options.prompt) ?? "You are a helpful assistant.";
    return {
        ...options,
        providerOptions: {
            ...(options.providerOptions ?? {}),
            openai: {
                ...(options.providerOptions?.openai ?? {}),
                instructions,
            },
        },
    };
}
function wrapResponsesModel(model) {
    const wrapped = Object.create(model);
    wrapped.doGenerate = (options) => model.doGenerate(withResponsesInstructions(options));
    wrapped.doStream = (options) => model.doStream(withResponsesInstructions(options));
    return wrapped;
}
export function createLanguageModel(provider, modelId, options, overrideWireApi) {
    const config = loadCodexConfig(options);
    const resolvedModel = resolveModel(config.model, modelId, options.useCodexConfigModel);
    if (!resolvedModel) {
        throw new Error("No model configured (set model in ~/.codex/config.toml or OpenCode config)");
    }
    if (!config.baseUrl) {
        throw new Error("No base_url configured for the selected model provider");
    }
    const baseURL = applyQueryParams(config.baseUrl, config.queryParams);
    const client = createOpenAI({
        apiKey: config.apiKey ?? undefined,
        baseURL,
        headers: config.headers,
    });
    const wireApi = overrideWireApi ?? config.wireApi;
    const model = selectModel(client, wireApi, resolvedModel);
    if (wireApi === "responses") {
        return wrapResponsesModel(model);
    }
    return model;
}
