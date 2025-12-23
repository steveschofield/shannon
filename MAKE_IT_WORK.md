# Shannon — Make It Work Notes

## Goal

- Provide concrete steps to get the repo running end-to-end, note pitfalls, and fix critical issues that block a first successful run.

## Quick Start

- Local sanity check:
  - `npm install`
  - `./shannon.mjs --help`
  - If you see `env: zx: No such file or directory`, install zx globally (`npm i -g zx`) or run with `npx`.

- Build container (Podman):
  - `podman build -t shannon:latest .`

- Run container (example):
  - `podman run --rm -it \
      -e ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" \
      -e CLAUDE_CODE_MAX_OUTPUT_TOKENS=64000 \
      -v "$(pwd)/configs:/app/configs:ro" \
      -v "/path/to/your/app:/app/repos/your-app:rw" \
      shannon:latest \
      "https://your-app.example" \
      "/app/repos/your-app" \
      --config /app/configs/example-config.yaml`

- Blackbox mode (URL-only run, REPO_PATH optional):
  - `podman run --rm -it \
      -e ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" \
      shannon:latest \
      "https://your-app.example" \
      --blackbox`

- Text-only adapters (OpenAI/Ollama) — stop after Pre‑Recon:
  - Add `--skip-mcp-phases` to exit cleanly before Recon and later MCP-dependent phases.
  - Example with LiteLLM proxy to Ollama:
    - `podman run --rm -it \
        -e SHANNON_LLM_PROVIDER=openai \
        -e OPENAI_BASE_URL="http://192.168.1.69:4000" \
        -e OPENAI_API_KEY="sk-any" \
        -e SHANNON_OPENAI_MODEL="llama3.1:8b" \
        shannon:latest \
        "http://192.168.1.130:3000" \
        --blackbox \
        --skip-mcp-phases`

- Text-only adapters (OpenAI/Ollama) — relax validation:
  - If you want to run non‑blackbox (with a REPO_PATH) but avoid failing pre‑recon validation, add `--relax-validation`.
  - This bypasses the check for `deliverables/code_analysis_deliverable.md` and `recon_deliverable.md` when `SHANNON_LLM_PROVIDER=openai`.

Notes:
- Use the in-container paths for CLI arguments (e.g., `/app/repos/...`).
- macOS Podman host networking often differs from Linux; start without `--network host` unless needed.
- External tools may require privileges; add `--cap-add=NET_RAW --cap-add=NET_ADMIN` or run as root (`--user 0`) if scans are restricted.

## Key Fixes Implemented

- Pre-Recon Promise.all ordering bug: fixed so output alignment is correct and stable.
- Optional `naabu` port scan support:
  - Added to tool checks (optional).
  - Integrated into Pre-Recon Wave 1; gracefully skipped if not present.

Files changed:
- `src/phases/pre-recon.js` — add optional `naabu` scan and fix results alignment.
- `src/tool-checker.js` — include `naabu` in availability checks and install hints.

## External Dependencies

- Binaries used (auto-checked on startup):
  - `nmap`, `subfinder`, `whatweb`, `schemathesis`
  - Optional: `naabu`, `httpx`, `nuclei`, `sqlmap`
- LLM provider:
  - Claude via `@anthropic-ai/claude-agent-sdk` (requires `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY`).
  - OpenAI-compatible via adapter (set `SHANNON_LLM_PROVIDER=openai` etc.).
  - Bedrock (Anthropic) via Claude Agent SDK passthrough (set `SHANNON_LLM_PROVIDER=bedrock` or `CLAUDE_CODE_USE_BEDROCK=1`, plus AWS creds and `AWS_REGION`).

## Common Pitfalls & Fixes

- Image not found on run:
  - Build locally first (`podman build -t shannon:latest .`).

- Wrong config/repo path:
  - The CLI expects in-container paths matching your mounts (e.g., `/app/repos/…`, `/app/configs/…`).

- nmap permissions:
  - If raw sockets are restricted, add `--cap-add=NET_RAW --cap-add=NET_ADMIN` or run as root (`--user 0`).

- Nuclei templates:
  - First run downloads templates. If template fetch fails due to network/DNS, re-run with network fixed; otherwise, nuclei output may be empty.

- zx missing on local host:
  - `npm i -g zx` or use `npx`.

## About Provider Proxies

- Default runs use the Claude Agent SDK. Anthropic-compatible base URL proxies must fully implement the Claude/Anthropic semantics to work reliably.

## LLM Adapter (OpenAI-compatible)

- You can switch Shannon to an OpenAI-compatible endpoint (OpenAI, LiteLLM, OpenRouter, or LiteLLM→Ollama) without touching code.

Enable the adapter:

```
export SHANNON_LLM_PROVIDER=openai
# Point to your gateway
export OPENAI_BASE_URL=https://api.openai.com/v1   # or http://localhost:4000 for LiteLLM
export OPENAI_API_KEY=sk-...                       # can be dummy if gateway doesn’t require it
# Choose model served by your gateway
export SHANNON_OPENAI_MODEL=gpt-4o-mini            # e.g., openai, or litellm alias -> ollama/llama3.1
```

Podman example (with LiteLLM proxy routing to Ollama):

```
podman run --rm -it \
  -e SHANNON_LLM_PROVIDER=openai \
  -e OPENAI_BASE_URL="http://host.containers.internal:4000" \
  -e OPENAI_API_KEY="sk-any" \
  -e SHANNON_OPENAI_MODEL="ollama/llama3.1" \
  -v "$(pwd)/configs:/app/configs:ro" \
  -v "/path/to/your/app:/app/repos/your-app:rw" \
  shannon:latest \
  "https://your-app.example" \
  "/app/repos/your-app" \
  --config /app/configs/example-config.yaml
```

Limitations of the OpenAI adapter:
- MCP tools and Playwright browser automation are not invoked through this path. You’ll get basic text outputs, and some deliverables might not auto-save.
- For full autonomy (MCP + browser), use the default Anthropic provider.

## Bedrock (Anthropic) Usage

- Enable Bedrock route through the Claude Agent SDK:

```
export SHANNON_LLM_PROVIDER=bedrock            # or set CLAUDE_CODE_USE_BEDROCK=1
export AWS_REGION=us-east-1                    # your region
# Auth via env or profile
export AWS_ACCESS_KEY_ID=...                   # or use AWS_PROFILE=...
export AWS_SECRET_ACCESS_KEY=...
export AWS_SESSION_TOKEN=...                   # if using STS
```

- In Podman, pass with `-e` and mount `~/.aws` if using profiles. The Anthropic path still handles MCP/browser automation.

## Recommended Next Steps

- Validate scans on your target app and confirm deliverables under `<repo>/deliverables`.
- If you need a different LLM provider, consider adding an adapter interface to replace the SDK call site in `src/ai/claude-executor.js`.
