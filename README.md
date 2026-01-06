# opencode-codex-exec-provider

Custom AI SDK provider that forwards OpenCode requests to `codex exec --json`.

Options:
- `codexPath`: path to the Codex CLI (default: `codex`)
- `args`: extra args for `codex exec`
- `env`: extra environment variables for the child process
- `includeReasoning`: include Codex reasoning items in the stream
- `skipGitRepoCheck`: set to false to enforce git repo check
- `emptyPromptFallback`: behavior when the prompt is empty (`placeholder`, `json`, `error`, `skip`)
