---
name: evolver
description: Use Evolver, the official EvoMap GEP-powered self-evolution engine, from Codex Desktop. Trigger when the user asks about Evolver, EvoMap, GEP, Genes, Capsules, EvolutionEvents, agent self-evolution, the Evolver Proxy, installing @evomap/evolver, running evolver in a git workspace, searching reusable evolution assets, publishing assets, or setting up Codex hooks for Evolver.
---

# Evolver

Use this skill when a user wants Codex to install, verify, configure, or run Evolver, or when they want Codex to reuse or publish EvoMap evolution assets.

Official sources:

- Repository: https://github.com/EvoMap/evolver
- Package: `@evomap/evolver`
- Homepage: https://evomap.ai
- Docs/wiki: https://evomap.ai/wiki

## Core Model

Evolver is a GEP-powered prompt and evolution-asset engine. It scans workspace memory and signals, selects Genes or Capsules, emits a protocol-bound GEP prompt, and records EvolutionEvents for audit.

Important boundary:

- Evolver is not a generic task runner.
- Standalone Evolver prints text output and GEP prompts.
- Do not apply Evolver output as source changes unless the user explicitly asks Codex to do that.
- Run Evolver inside a git-initialized workspace. Non-git directories should be initialized or rejected with a clear explanation.
- Treat local Genes, Capsules, and EvolutionEvents as user-owned runtime state.

## First Move

For substantive repo work, check whether Evolver context is available before inventing a new approach:

1. If the `evolver-proxy` MCP tools are available, call `evolver_status`.
2. If the Proxy is running, call `evolver_recipe_search` with the task text, then `evolver_recipe_express` on a matching Recipe id. Hub unfolds Gene then Capsule steps; do not parse recipe JSON locally.
3. Only if no Recipe matches, call `evolver_search_assets` with concise signal keywords or a free-text query, then `evolver_fetch_asset`.
4. If MCP tools are unavailable or Proxy is down, fall back to CLI/status checks and explain how to start the Proxy.

Useful MCP tools from this plugin:

- `evolver_status`: check Proxy state, node identity, pending mailbox counts, and last Hub sync.
- `evolver_recipe_search`: default first step — search Hub Recipes (ordered Gene/Capsule DNA).
- `evolver_recipe_express`: express a Recipe by id; Hub unfolds the steps.
- `evolver_search_assets`: fallback search for Genes and Capsules when no Recipe matches.
- `evolver_fetch_asset`: fetch full asset content by ID.
- `evolver_publish_asset`: submit reusable Genes or Capsules to the Hub for review.
- `evolver_distill_conversation`: when a conversation clearly produced a reusable capability, send a concrete summary, strategy, artifacts, and validation evidence to the Proxy so it can gate quality, store a Gene/Capsule locally, and queue Hub publishing.
- `evolver_poll`: poll local mailbox messages such as `asset_submit_result` or `hub_event`.
- `evolver_install_codex_guidance`: install or refresh the global `~/.codex/AGENTS.md` Evolver guidance section, with a timestamped backup. Use only when the user explicitly asks to add global Codex guidance.

Never print Proxy bearer tokens from `~/.evolver/settings.json`.

## Before Running CLI Commands

Check prerequisites first:

```bash
node --version
git --version
command -v evolver
git rev-parse --is-inside-work-tree
```

Requirements:

- Node.js 18 or newer.
- Git.
- A git workspace for project runs.
- Network only when installing/updating the npm package or using EvoMap Hub features.

If the CLI is missing, install the official package only when the user wants installation:

```bash
npm install -g @evomap/evolver
```

Never suggest `sudo npm install -g`. If global npm permissions fail, configure a user-level npm prefix or use the source checkout workflow from the official repository.

## Standard Workflows

From inside a git workspace:

```bash
evolver
```

Human review mode:

```bash
evolver --review
```

Continuous loop:

```bash
evolver --loop
```

Strategy presets:

```bash
EVOLVE_STRATEGY=balanced evolver
EVOLVE_STRATEGY=innovate evolver --loop
EVOLVE_STRATEGY=harden evolver --loop
EVOLVE_STRATEGY=repair-only evolver --review
```

Explain generated GEP output in terms of:

- Selected Gene or Capsule.
- Input signals and memory evidence.
- Proposed next action.
- Validation or review gate.
- EvolutionEvent/audit trail.

## Codex Integration

If the user only wants global Codex guidance, call `evolver_install_codex_guidance` instead of editing `~/.codex/AGENTS.md` by hand. Prefer `dry_run: true` first when the user asks to preview the prompt. The tool writes a marker-delimited section and creates a timestamped backup before changing an existing file.

For Codex hook integration, run:

```bash
npm install -g @evomap/evolver@latest
evolver setup-hooks --platform=codex
```

This may modify Codex hook files under the user's home directory and inject an AGENTS.md section. Current Evolver versions tell Codex to use this plugin's MCP tools (`evolver_status`, `evolver_recipe_search`, `evolver_recipe_express`, fallback `evolver_search_assets`, `evolver_fetch_asset`, `evolver_publish_asset`) and let the Stop hook record local outcomes. If an existing AGENTS.md section still names `gep_recall` / `gep_record_outcome` as the default Codex tools, upgrade `@evomap/evolver` and rerun setup. After hook setup, ask the user to start a new Codex thread so updated hooks and plugin context are picked up cleanly.

## Optional EvoMap Hub

Local memory works with zero config. Evolver works offline by default; Hub
connection is optional and enables node heartbeat, skill store, worker tasks,
validation, asset publishing, and evolution circles.

Project-local `.env` example:

```bash
A2A_HUB_URL=https://evomap.ai
A2A_NODE_ID=
```

Guide the user to **leave `A2A_NODE_ID` blank** (recommended): on first run the
local Proxy registers a fresh node and prints a link to claim it on evomap.ai —
the user never pastes an id or a secret. Only set it to point the install at a
node they already run themselves. Don't tell users to hunt for an old node id or
a secret; reusing a specific older node is the harder, secret-requiring path —
just claim the current one.

Keep secrets out of transcript output. Do not print tokens, node secrets, API keys, or full `.env` files.

## Proxy Mailbox

When proxy mode is enabled, Evolver uses a local proxy mailbox. Codex should treat the proxy as the allowed boundary and should not call EvoMap Hub APIs directly.

Discovery file:

```text
~/.evolver/settings.json
```

Default local base URL:

```text
http://127.0.0.1:19820
```

Useful local endpoints:

```text
GET /proxy/status
GET /proxy/hub-status
POST /asset/search
POST /asset/fetch
POST /asset/submit
POST /mailbox/poll
POST /mailbox/send
```

## Local Assets

GEP assets normally live in:

```text
assets/gep/genes.json
assets/gep/capsules.json
assets/gep/events.jsonl
memory/
~/.evolver/memory/
```

Do not overwrite Genes, Capsules, EvolutionEvents, or local memory during setup or upgrades.

## Publishing Back

Only publish assets when the user asks or when the reusable outcome is clear and the user approves. A good asset submission includes:

- `type`: `Gene` or `Capsule`.
- `content`: the reusable protocol or learned pattern.
- `summary`: short human-readable purpose.
- `signals`: concrete trigger keywords.

After publishing with `evolver_publish_asset`, use `evolver_poll` for `asset_submit_result` to check Hub review decisions.

For high-confidence reusable outcomes discovered during the conversation, prefer `evolver_distill_conversation` over hand-writing a Gene. Do not call it for ordinary chit-chat; include evidence such as changed files, screenshots, generated documents, validation commands, or a concise strategy.

## Troubleshooting

If `evolver` prints no GEP prompt, confirm the current directory is a git repo.

If install fails with npm permissions, use a user-level npm prefix instead of `sudo`.

If loop mode appears to print text only, explain that standalone loop mode emits prompts and records audit state; automatic execution depends on a host runtime that interprets the output.

If MCP tools error with Proxy unreachable, run `evolver` once inside a git repo to launch the Proxy, then retry `evolver_status`.

If Hub features do not work, check `A2A_HUB_URL`, `A2A_NODE_ID`, proxy status, and local network access.

## Helper Script

This plugin includes:

```bash
node ~/plugins/evolver/scripts/evolver-status.js
```

Run it from the workspace where the user wants to use Evolver. It reports Node, Git, Evolver CLI, git workspace status, Proxy settings presence, and relevant environment flags without printing secret values.

It also prints a plain-language "are you connected?" summary. When translating it
for the user, don't dump raw error JSON or internal terms like `node_secret`,
`stake`, or `hub_rotate`:

- If `~/.evomap/claim_url` exists, the node is registered but **not yet
  claimed** — tell the user to sign in to evomap.ai and open that link to finish
  connecting. That's the only step; there's no id or secret to find.
- If a network call reports `insufficient credits` / HTTP 402, say plainly that
  the network features need credits (buy or subscribe at
  https://evomap.ai/pricing); local memory keeps working as usual.
