import test from "node:test";
import assert from "node:assert/strict";
import { selectModel, withResponsesInstructions } from "../src/provider";

test("selectModel uses chat when wire_api is chat", () => {
  const calls: string[] = [];
  const client = {
    chat: (id: string) => {
      calls.push(`chat:${id}`);
      return { kind: "chat", id };
    },
    responses: (id: string) => {
      calls.push(`responses:${id}`);
      return { kind: "responses", id };
    },
  };

  const model = selectModel(client, "chat", "gpt-5.2-codex");
  assert.equal(calls[0], "chat:gpt-5.2-codex");
  assert.equal((model as any).kind, "chat");
});

test("selectModel uses responses when wire_api is responses", () => {
  const calls: string[] = [];
  const client = {
    chat: (id: string) => {
      calls.push(`chat:${id}`);
      return { kind: "chat", id };
    },
    responses: (id: string) => {
      calls.push(`responses:${id}`);
      return { kind: "responses", id };
    },
  };

  const model = selectModel(client, "responses", "gpt-5.2-codex");
  assert.equal(calls[0], "responses:gpt-5.2-codex");
  assert.equal((model as any).kind, "responses");
});

test("withResponsesInstructions injects instructions from system message", () => {
  const options = {
    prompt: {
      type: "messages",
      messages: [
        { role: "system", content: "You are Codex." },
        { role: "user", content: "hi" },
      ],
    },
  };

  const next = withResponsesInstructions(options as any);
  assert.equal((next.providerOptions as any).openai.instructions, "You are Codex.");
});

test("withResponsesInstructions preserves existing instructions", () => {
  const options = {
    providerOptions: {
      openai: {
        instructions: "Keep this.",
      },
    },
  };

  const next = withResponsesInstructions(options as any);
  assert.equal((next.providerOptions as any).openai.instructions, "Keep this.");
});
