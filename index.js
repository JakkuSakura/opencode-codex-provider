import { spawn } from "node:child_process";

const DEFAULT_USAGE = Object.freeze({
  inputTokens: {
    total: undefined,
    noCache: undefined,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: {
    total: undefined,
    text: undefined,
    reasoning: undefined,
  },
});

function buildPrompt(prompt, options) {
  const lines = [];

  for (const message of prompt) {
    if (message.role === "system") {
      const systemText = extractText(message.content);
      if (systemText) {
        lines.push(`System:\n${systemText}`);
      }
      continue;
    }

    const label = message.role === "user" ? "User" : message.role === "assistant" ? "Assistant" : "Tool";
    const text = extractText(message.content);
    if (!text) continue;
    lines.push(`${label}:\n${text}`);
  }

  const promptText = lines.join("\n\n").trim();
  if (promptText) return promptText;

  const fallback = options?.emptyPromptFallback ?? "placeholder";
  if (fallback === "json") {
    try {
      return JSON.stringify(prompt, null, 2);
    } catch {
      return "User:\n[empty prompt: failed to serialize prompt]";
    }
  }
  if (fallback === "error") return "";
  if (fallback === "skip") return "";
  return "User:\n[empty prompt]";
}

function extractText(content) {
  if (!content) return "";
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) {
    if (typeof content === "object" && content.text) return String(content.text).trim();
    return "";
  }

  const parts = [];
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    if (part.type === "text" || part.type === "reasoning") {
      if (part.text) parts.push(part.text);
      continue;
    }
    if (part.type === "tool-result") {
      try {
        parts.push(JSON.stringify(part.output));
      } catch {
        parts.push(String(part.output));
      }
      continue;
    }
    if (part.type === "tool-call") {
      try {
        parts.push(`[tool:${part.toolName}] ${JSON.stringify(part.input)}`);
      } catch {
        parts.push(`[tool:${part.toolName}]`);
      }
      continue;
    }
    if (part.type === "image") {
      parts.push("[image]");
      continue;
    }
    if (part.type === "file") {
      const name = part.filename ? ` ${part.filename}` : "";
      parts.push(`[file${name}]`);
      continue;
    }
    if (typeof part.text === "string") {
      parts.push(part.text);
      continue;
    }
  }

  return parts.join("\n").trim();
}

function buildArgs(modelId, options) {
  const args = ["exec", "--json"];

  if (options?.skipGitRepoCheck !== false) {
    args.push("--skip-git-repo-check");
  }

  if (modelId) {
    args.push("--model", modelId);
  }

  if (Array.isArray(options?.args)) {
    args.push(...options.args);
  }

  return args;
}

function parseJsonLine(line) {
  if (!line.trim()) return null;
  try {
    return JSON.parse(line);
  } catch {
    return { type: "parse.error", raw: line };
  }
}

function mapUsage(turnUsage) {
  if (!turnUsage) return DEFAULT_USAGE;

  return {
    inputTokens: {
      total: turnUsage.input_tokens ?? undefined,
      noCache: undefined,
      cacheRead: turnUsage.cached_input_tokens ?? undefined,
      cacheWrite: undefined,
    },
    outputTokens: {
      total: turnUsage.output_tokens ?? undefined,
      text: turnUsage.output_tokens ?? undefined,
      reasoning: undefined,
    },
    raw: turnUsage,
  };
}

function runCodexExec({
  promptText,
  modelId,
  options,
  onEvent,
  onStderr,
  abortSignal,
}) {
  const codexPath = options?.codexPath ?? "codex";
  const args = buildArgs(modelId, options);
  const env = {
    ...process.env,
    ...(options?.env ?? {}),
  };

  const child = spawn(codexPath, args, {
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });

  if (abortSignal) {
    if (abortSignal.aborted) {
      child.kill("SIGTERM");
    } else {
      abortSignal.addEventListener("abort", () => child.kill("SIGTERM"), { once: true });
    }
  }

  child.stdin.setDefaultEncoding("utf8");
  child.stdin.write(promptText);
  child.stdin.end();

  let stdoutBuffer = "";
  let stderrBuffer = "";

  child.stdout.on("data", (chunk) => {
    stdoutBuffer += chunk.toString("utf8");
    let idx;
    while ((idx = stdoutBuffer.indexOf("\n")) !== -1) {
      const line = stdoutBuffer.slice(0, idx);
      stdoutBuffer = stdoutBuffer.slice(idx + 1);
      const event = parseJsonLine(line);
      if (event) onEvent(event);
    }
  });

  child.stderr.on("data", (chunk) => {
    const text = chunk.toString("utf8");
    stderrBuffer += text;
    if (onStderr) onStderr(text);
  });

  return new Promise((resolve) => {
    child.on("close", (code, signal) => {
      if (stdoutBuffer.trim()) {
        const event = parseJsonLine(stdoutBuffer);
        if (event) onEvent(event);
      }
      resolve({ code, signal, stderr: stderrBuffer });
    });
  });
}

function createLanguageModel({ provider, modelId, options }) {
  return {
    specificationVersion: "v3",
    provider,
    modelId,
    supportedUrls: {},
    async doGenerate(callOptions) {
      const promptText = buildPrompt(callOptions.prompt, options);
      let text = "";
      let usage = DEFAULT_USAGE;
      let finishReason = { unified: "other", raw: undefined };
      const warnings = [];

      if (!promptText) {
        warnings.push({ type: "other", message: "Empty prompt; skipping codex exec." });
        return {
          content: [{ type: "text", text: "" }],
          finishReason: { unified: "other", raw: "empty-prompt" },
          usage,
          warnings,
        };
      }

      await runCodexExec({
        promptText,
        modelId,
        options,
        abortSignal: callOptions.abortSignal,
        onEvent: (event) => {
          if (callOptions.includeRawChunks) {
            // no-op for non-stream generate
          }

          if (event.type === "item.completed") {
            const item = event.item;
            if (item?.type === "agent_message" && item.text) {
              text += item.text;
            }
            if (options?.includeReasoning && item?.type === "reasoning" && item.text) {
              text += `\n\n[Reasoning]\n${item.text}`;
            }
          }

          if (event.type === "turn.completed") {
            usage = mapUsage(event.usage);
            finishReason = { unified: "stop", raw: "turn.completed" };
          }

          if (event.type === "parse.error") {
            finishReason = { unified: "error", raw: "parse.error" };
          }
        },
      });

      return {
        content: [{ type: "text", text }],
        finishReason,
        usage,
        warnings,
      };
    },

    async doStream(callOptions) {
      const promptText = buildPrompt(callOptions.prompt, options);

      let usage = DEFAULT_USAGE;
      let finishReason = { unified: "other", raw: undefined };
      const textId = "text-1";
      const reasoningId = "reasoning-1";
      let textStarted = false;
      let reasoningStarted = false;

      const stream = new ReadableStream({
        start(controller) {
          const warnings = [];
          if (!promptText) {
            warnings.push({ type: "other", message: "Empty prompt; skipping codex exec." });
          }
          controller.enqueue({ type: "stream-start", warnings });

          if (!promptText) {
            controller.enqueue({
              type: "finish",
              usage,
              finishReason: { unified: "other", raw: "empty-prompt" },
            });
            controller.close();
            return;
          }

          runCodexExec({
            promptText,
            modelId,
            options,
            abortSignal: callOptions.abortSignal,
            onEvent: (event) => {
              if (callOptions.includeRawChunks) {
                controller.enqueue({ type: "raw", rawValue: event });
              }

              if (event.type === "item.completed") {
                const item = event.item;
                if (item?.type === "agent_message" && item.text) {
                  if (!textStarted) {
                    controller.enqueue({ type: "text-start", id: textId });
                    textStarted = true;
                  }
                  controller.enqueue({ type: "text-delta", id: textId, delta: item.text });
                }

                if (options?.includeReasoning && item?.type === "reasoning" && item.text) {
                  if (!reasoningStarted) {
                    controller.enqueue({ type: "reasoning-start", id: reasoningId });
                    reasoningStarted = true;
                  }
                  controller.enqueue({ type: "reasoning-delta", id: reasoningId, delta: item.text });
                }
              }

              if (event.type === "turn.completed") {
                usage = mapUsage(event.usage);
                finishReason = { unified: "stop", raw: "turn.completed" };
              }

              if (event.type === "parse.error") {
                controller.enqueue({ type: "error", error: new Error("Failed to parse codex JSONL output") });
                finishReason = { unified: "error", raw: "parse.error" };
              }
            },
          }).then(({ code, signal, stderr }) => {
            if (stderr) {
              controller.enqueue({ type: "error", error: new Error(stderr.trim()) });
              finishReason = { unified: "error", raw: "stderr" };
            }

            if (code !== 0) {
              finishReason = { unified: "error", raw: signal ?? String(code) };
            }

            if (reasoningStarted) {
              controller.enqueue({ type: "reasoning-end", id: reasoningId });
            }
            if (textStarted) {
              controller.enqueue({ type: "text-end", id: textId });
            }
            controller.enqueue({
              type: "finish",
              usage,
              finishReason,
            });
            controller.close();
          });
        },
        cancel() {
          // handled by abort signal if provided
        },
      });

      return { stream };
    },
  };
}

export function createCodexExec(options = {}) {
  const providerId = options.name ?? "codex-exec";

  const provider = {
    specificationVersion: "v3",
    languageModel(modelId) {
      return createLanguageModel({ provider: providerId, modelId, options });
    },
    embeddingModel() {
      throw new Error("codex-exec does not support embeddings");
    },
    imageModel() {
      throw new Error("codex-exec does not support images");
    },
  };

  const callable = (modelId) => provider.languageModel(modelId);
  return Object.assign(callable, provider);
}
