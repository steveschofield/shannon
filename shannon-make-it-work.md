# Shannon Repo — “Make It Work” Notes (Markdown)

## Goal

> **User:** *“Take a look at the repo and what is needed to make this work.”*

## Approach

> **GitHub Copilot:** *“I’ll quickly inspect the repo’s entrypoints + docs (README/package scripts/config) to understand how it’s intended to run, then I’ll try a minimal `npm` install/build/run flow to see what’s missing and report concrete fixes/steps.”*

- Created **4 TODOs**
- First pass: scan README, package scripts, and the main CLI entrypoint to understand the intended “happy path.”

## Files & Artifacts Reviewed

- `package.json``file:///Users/ss/code/shannon/package.json`
- `README.md``file:///Users/ss/code/shannon/README.md`
- `CLAUDE.md` (lines 1–240)`file:///Users/ss/code/shannon/CLAUDE.md#1-1`
- `shannon.mjs` (lines 1–260)`file:///Users/ss/code/shannon/shannon.mjs#1-1`
- `configs/config-schema.json``file:///Users/ss/code/shannon/configs/config-schema.json`
- `configs/example-config.yaml``file:///Users/ss/code/shannon/configs/example-config.yaml`
- `src/tool-checker.js``file:///Users/ss/code/shannon/src/tool-checker.js`
- `src/setup/environment.js``file:///Users/ss/code/shannon/src/setup/environment.js`
- `src/ai/claude-executor.js``file:///Users/ss/code/shannon/src/ai/claude-executor.js#1-1`
- `src/phases/pre-recon.js``file:///Users/ss/code/shannon/src/phases/pre-recon.js`
- `mcp-server/package.json``file:///Users/ss/code/shannon/mcp-server/package.json`
- `src/constants.js``file:///Users/ss/code/shannon/src/constants.js`
- `src/cli/ui.js`
  `file:///Users/ss/code/shannon/src/cli/ui.js`

## Intended CLI Usage

Docs indicate:

```
./shannon.mjs <WEB_URL> <REPO_PATH> --config <CONFIG_FILE>
```

## Key Findings

- The repo includes a **config schema** and **tool availability checks**—most “make it work” items are **external dependencies**:
  - Binaries: `nmap`, `subfinder`, `whatweb`, `schemathesis`, optionally `naabu`
  - **Git** access to the target repo
  - An **Anthropic API key** (unless using Bedrock mode; see below)
- **Runtime bug in `pre-recon`**: `Promise.all` destructuring is misaligned; the Claude code-analysis result is assigned to `naabu` and `codeAnalysis` becomes `undefined`.
- **Optional `naabu`** support should be wired so “Port Discovery” runs for real or is clearly skipped.

> **Action noted in log:**
>
> - Fixed `Promise.all` ordering bug
> - Added optional `naabu` support + included `naabu` in tool checks

## Minimal Local Sanity Check

Run:

```bash
npm install
./shannon.mjs --help
```

**Gotcha**: Local run failed with `env: zx: No such file or directory`.Fix by **either**:

- `npm i -g zx` *(global install)*, **or**
- `npx zx shannon.mjs --help` *(use `npx`)*

*(Not required if you run in a container.)*

## Podman Run Error & Root Cause

**User attempted run:**

```bash
podman run --rm -it   --network host   --cap-add=NET_RAW   --cap-add=NET_ADMIN   -e ANTHROPIC_API_KEY="<REDACTED>"   -e CLAUDE_CODE_MAX_OUTPUT_TOKENS=64000   -v "$(pwd)/repos:/app/repos"   -v "$(pwd)/configs:/app/configs"   shannon:latest   "http://192.168.1.130:3000/"   "/Users/ss/code/juice-shop-master"   --config /configs/juiceshop-config.yaml
```

**Error:**

```
Error: unable to copy from source docker://shannon:latest: ...
requested access to the resource is denied
```

**Why it failed:**

- `shannon:latest` **does not exist locally**; Podman tried to pull `docker.io/library/shannon:latest` and was denied.
- **Config path mismatch**: repo uses `configs/juiceshop.yaml` (not `juiceshop-config.yaml`).
- **Mounted path mismatch**: Inside container, host path `/Users/...` is not visible; you must reference the **in-container mount path** (e.g., `/app/repos/...`).

## Build the Image Locally

From repo root:

```bash
podman build -t shannon:latest .
podman images | grep shannon
```

## Corrected Podman Run

**Option A (recommended): mount the target repo directly and use correct config path**

```bash
podman run --rm -it   -e ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY"   -e CLAUDE_CODE_MAX_OUTPUT_TOKENS=64000   -v "$(pwd)/configs:/app/configs:ro"   -v "/Users/ss/code/juice-shop-master:/app/repos/juice-shop-master:rw"   shannon:latest   "http://192.168.1.130:3000/"   "/app/repos/juice-shop-master"   --config /app/configs/juiceshop.yaml
```

**Option B:** If you prefer `$(pwd)/repos:/app/repos`, ensure the repo exists at `./repos/juice-shop-master` and pass `/app/repos/juice-shop-master` to the CLI.

> **Note:** `--network host` on macOS Podman often does not behave like Linux host networking. Start without it unless strictly required.

### If `nmap` fails due to permissions

The image runs as a non-root user; `nmap` may need raw socket privileges. Use:

```bash
podman run --rm -it   --user 0   --cap-add=NET_RAW   --cap-add=NET_ADMIN   ... (rest of args)
```

Or accept reduced external scanning (Shannon will warn and proceed).

### Security Reminder

A live `ANTHROPIC_API_KEY` appeared in the original command. Treat it as **compromised**; **rotate/revoke** immediately and store securely (env var or `.env`), not in chat/history.

---

## Switch LLM Provider Without Code Changes

You can switch Shannon’s Claude runtime to **Amazon Bedrock (Anthropic)** or **Ollama (via an Anthropic-compatible proxy)** **without modifying Shannon’s code**.

### 1) Amazon Bedrock (Anthropic) — No Code Changes

Set the following in your shell (or `podman run -e ...`):

```bash
export CLAUDE_CODE_USE_BEDROCK=1
export AWS_REGION=us-east-1          # choose your region
# Choose one auth method:
export AWS_ACCESS_KEY_ID=...         # or use
export AWS_SECRET_ACCESS_KEY=...     # AWS_PROFILE=...
export AWS_SESSION_TOKEN=...         # (optional, if using STS)
# OR:
export AWS_PROFILE=your-profile
```

- In **Bedrock mode**, **do not** set `ANTHROPIC_API_KEY`; it’s not required.
- For Podman, pass via `-e` and optionally mount `~/.aws` if using profiles.

### 2) Ollama — No Code Changes (via Anthropic `/v1/messages` Proxy)

Ollama does **not** speak Anthropic’s API directly. Use a proxy (e.g., **LiteLLM Proxy**) that exposes **`POST /v1/messages`**.

**Steps:**

1. **Start Ollama & pull a model:**

   ```bash
   ollama serve
   ollama pull llama3.1   # choose your model
   ```
2. **Create a LiteLLM proxy config** mapping Shannon’s expected model name to your Ollama model (example name shown—adjust to your use):

   ```yaml
   model_list:
     - model_name: claude-sonnet-4-5-20250929
       litellm_params:
         model: ollama/llama3.1
         api_base: http://localhost:11434
   ```
3. **Run the LiteLLM proxy:**

   ```bash
   pip install 'litellm[proxy]'
   litellm --config /path/to/your_config.yaml  # default port 4000
   ```
4. **Point Shannon at the proxy:**

   ```bash
   export ANTHROPIC_BASE_URL=http://localhost:4000
   export ANTHROPIC_API_KEY=sk-anything   # placeholder to satisfy key checks
   ```

- Then run Shannon as usual (local or Podman). For Podman, pass `-e ANTHROPIC_BASE_URL=... -e ANTHROPIC_API_KEY=...` and ensure container networking can reach the proxy.

---

## Troubleshooting Checklist

- **Image exists?** `podman images | grep shannon`
- **Correct config path?** `configs/juiceshop.yaml`
- **Correct in-container repo path?** Use `/app/...` matching your mounts
- **External tools present?** `nmap`, `subfinder`, `whatweb`, `schemathesis`, optional `naabu`
- **Local run needs `zx`?** Install globally or use `npx`
- **Networking from container to target URL?** Verify `192.168.1.130:3000` reachable without `--network host`
- **Secrets managed properly?** Rotate any exposed API keys; prefer env vars or secrets management

---

### Reference Commands (Copy/Paste Friendly)

**Build:**

```bash
podman build -t shannon:latest .
```

**Run (recommended mounts):**

```bash
podman run --rm -it   -e ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY"   -e CLAUDE_CODE_MAX_OUTPUT_TOKENS=64000   -v "$(pwd)/configs:/app/configs:ro"   -v "/Users/ss/code/juice-shop-master:/app/repos/juice-shop-master:rw"   shannon:latest   "http://192.168.1.130:3000/"   "/app/repos/juice-shop-master"   --config /app/configs/juiceshop.yaml
```

**Bedrock mode (env preflight):**

```bash
export CLAUDE_CODE_USE_BEDROCK=1
export AWS_REGION=us-east-1
export AWS_PROFILE=your-profile
# or use ACCESS_KEY/SECRET/SESSION_TOKEN environment variables
```

**Ollama + LiteLLM proxy (env preflight):**

```bash
export ANTHROPIC_BASE_URL=http://localhost:4000
export ANTHROPIC_API_KEY=sk-anything
```

## Example commands

podman run --rm -it --cap-add=NET_RAW --cap-add=NET_ADMIN -e SHANNON_LLM_PROVIDER=openai -e OPENAI_BASE_URL="http://192.168.1.69:47537" -e OPENAI_API_KEY="sk-any" -e SHANNON_OPENAI_MODEL="llama3.1:8b" -v "$(pwd)/configs:/app/configs:ro" -v "$(pwd)/repos:/app/repos:rw" shannon:latest "http://192.168.1.130:3000" --blackbox --skip-mcp-phases --config /app/configs/juiceshop.yaml

litellm --config your_config.yaml --port **4000**


**model_list:**

**  **- model_name: llama3.1:8b

**    **litellm_params:

**      **model: ollama/llama3.1:8b

**      **api_base: http://192.168.1.69:11434

Running with no blackbox

podman run --rm -it --cap-add=NET_RAW --cap-add=NET_ADMIN -e SHANNON_LLM_PROVIDER=openai -e OPENAI_BASE_URL="http://192.168.1.69:28887" -e OPENAI_API_KEY="sk-any" -e SHANNON_OPENAI_MODEL="llama3.1:8b" -v "$(pwd)/configs:/app/configs:ro" -v "/Users/ss/code/juice-shop:/app/repos/juice-shop:rw" shannon:latest "http://192.168.1.130:3000" "/app/repos/juice-shop" --config /app/configs/juiceshop.yaml --skip-mcp-phases
