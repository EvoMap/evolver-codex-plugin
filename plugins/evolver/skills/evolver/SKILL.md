---
name: evolver
description: Use Evolver, the official EvoMap GEP-powered self-evolution engine, from Codex Desktop. Trigger when the user asks about Evolver, EvoMap, GEP, Genes, Capsules, EvolutionEvents, agent self-evolution, installing @evomap/evolver, running evolver in a git workspace, or setting up Codex hooks for Evolver.
---

# Evolver

Use this skill when a user wants Codex to install, verify, configure, or run the official Evolver open-source engine.

Official sources:

- Repository: https://github.com/EvoMap/evolver
- Package: `@evomap/evolver`
- Homepage: https://evomap.ai
- Docs/wiki: https://evomap.ai/wiki

## Core Model

Evolver is a GEP-powered prompt and evolution-asset generator. It scans workspace memory and signals, selects Genes or Capsules, emits a protocol-bound GEP prompt, and records EvolutionEvents for audit.

Important boundary:

- Evolver itself is not a general code patcher.
- In standalone mode it prints text output and GEP prompts.
- Do not apply Evolver output as code changes unless the user explicitly asks Codex to do that.
- Run Evolver inside a git-initialized workspace. Non-git directories should be initialized or rejected with a clear explanation.

## Before Running

Check prerequisites first:

```bash
node --version
git --version
command -v evolver
```

Requirements:

- Node.js 18 or newer.
- Git.
- A git workspace for project runs.
- Network only when installing/updating the npm package or using EvoMap Hub features.

If the CLI is missing, install the official package:

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

## Codex Desktop Integration

For Codex hook integration, run:

```bash
evolver setup-hooks --platform=codex
```

This may modify Codex hook files under the user's home directory. In Codex Desktop, request approval when the sandbox requires it. After hook setup, ask the user to start a new Codex thread so the updated hooks and plugin context are picked up cleanly.

## Optional EvoMap Hub

Evolver works offline by default. Hub connection enables network features such as node heartbeat, skill store, worker tasks, validation, asset publishing, and evolution circles.

Project-local `.env` example:

```bash
A2A_HUB_URL=https://evomap.ai
A2A_NODE_ID=your_node_id_here
```

Keep secrets out of transcript output. Do not print tokens or full `.env` files.

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

Useful local status endpoints:

```text
GET /proxy/status
GET /proxy/hub-status
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
```

Treat these as user-owned runtime state. Do not overwrite Genes, Capsules, or EvolutionEvents during setup or upgrades.

## Troubleshooting

If `evolver` prints no GEP prompt, confirm the current directory is a git repo.

If install fails with npm permissions, use a user-level npm prefix instead of `sudo`.

If loop mode appears to print text only, explain that standalone loop mode emits prompts and records audit state; automatic execution depends on a host runtime that interprets the output.

If Hub features do not work, check `A2A_HUB_URL`, `A2A_NODE_ID`, proxy status, and local network access.

## Helper Script

This plugin includes:

```bash
node ~/plugins/evolver/scripts/evolver-status.js
```

Run it from the workspace where the user wants to use Evolver. It reports Node, Git, Evolver CLI, git workspace status, and relevant environment flags without printing secret values.
