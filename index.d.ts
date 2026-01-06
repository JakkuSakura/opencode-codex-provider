import type { ProviderV3 } from "@ai-sdk/provider";

type CodexExecOptions = {
  name?: string;
  codexPath?: string;
  args?: string[];
  env?: Record<string, string>;
  includeReasoning?: boolean;
  skipGitRepoCheck?: boolean;
  emptyPromptFallback?: "placeholder" | "json" | "error" | "skip";
};

export declare function createCodexExec(options?: CodexExecOptions): ProviderV3 & {
  (modelId: string): any;
};
