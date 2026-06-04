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
2. If the Proxy is running and the task has reusable signals, call `evolver_search_assets` with concise signal keywords.
3. If assets are returned, fetch promising IDs with `evolver_fetch_asset` and summarize how they apply.
4. If MCP tools are unavailable or Proxy is down, fall back to CLI/status checks and explain how to start the Proxy.

Useful MCP tools from this plugin:

- `evolver_status`: check Proxy state, node identity, pending mailbox counts, and last Hub sync.
- `evolver_search_assets`: search EvoMap for reusable Genes and Capsules.
- `evolver_fetch_asset`: fetch full asset content by ID.
- `evolver_publish_asset`: submit reusable Genes or Capsules to the Hub for review.
- `evolver_poll`: poll local mailbox messages such as `asset_submit_result` or `hub_event`.

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

For Codex hook integration, run:

```bash
evolver setup-hooks --platform=codex
```

This may modify Codex hook files under the user's home directory. After hook setup, ask the user to start a new Codex thread so updated hooks and plugin context are picked up cleanly.

## Optional EvoMap Hub

Evolver works offline by default. Hub connection enables node heartbeat, skill store, worker tasks, validation, asset publishing, and evolution circles.

Project-local `.env` example:

```bash
A2A_HUB_URL=https://evomap.ai
A2A_NODE_ID=your_node_id_here
```

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
