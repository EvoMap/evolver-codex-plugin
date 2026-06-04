# Evolver — Codex Desktop plugin

Self-evolution workflows for Codex Desktop, powered by [Evolver](https://github.com/EvoMap/evolver) (`@evomap/evolver`) and [EvoMap](https://evomap.ai).

This plugin packages Evolver as a Codex-ready workflow: a model-invoked skill, a local status helper, and an MCP bridge to the Evolver Proxy mailbox for Genes and Capsules.

> "Evolution is not optional. Adapt or die."

## What it does

| Layer | Mechanism | Behavior |
| --- | --- | --- |
| Passive recall | Skill guidance | Prompts Codex to look for past outcomes, local memory, and relevant Genes before starting substantive work. |
| Network bridge | MCP server `evolver-proxy` | Exposes `evolver_status`, `evolver_search_assets`, `evolver_fetch_asset`, `evolver_publish_asset`, and `evolver_poll` through the local EvoMap Proxy mailbox. |
| Active control | CLI workflow | Guides Codex through `evolver`, `evolver --review`, `evolver --loop`, strategy presets, and Codex hook setup. |
| Safety boundary | Git + review | Evolver emits protocol-bound GEP prompts and auditable events; Codex should not auto-apply generated output unless the user asks. |

The plugin is self-contained on the Codex side. Active evolution still uses the official Evolver CLI or the local Proxy started by Evolver.

## Prerequisites

- Node.js 18 or newer.
- Git.
- A git-initialized workspace for project runs.
- Optional: global Evolver CLI.

```bash
npm install -g @evomap/evolver
```

If the CLI is not installed globally, Codex can still explain setup and use `npx -y @evomap/evolver` when the user approves network access.

## Configure

Evolver works offline by default. Hub features use project-local environment variables:

```bash
A2A_HUB_URL=https://evomap.ai
A2A_NODE_ID=your_node_id_here
```

The MCP bridge reads the live Proxy URL and token from:

```text
~/.evolver/settings.json
```

If that file is absent, it falls back to:

```text
http://127.0.0.1:19820
```

Start the Proxy by running `evolver` once inside a git repo.

## Verify

From a workspace where you want to use Evolver:

```bash
node ~/plugins/evolver/scripts/evolver-status.js
```

After installing the plugin from a repo marketplace, the same script lives inside the plugin cache. In normal Codex use, ask Codex to check Evolver status; when the MCP bridge is loaded it should call `evolver_status` first.

## Typical Codex prompts

- "Use Evolver to check whether this repo has reusable Genes before we change the architecture."
- "Run Evolver review mode and explain the GEP output before applying anything."
- "Check Evolver Proxy status and search for assets related to flaky tests."
- "Set up Evolver Codex hooks for this machine."

## Uninstall

Remove or disable the plugin from Codex Plugins. Local Evolver memory under `~/.evolver/` is left intact.

## License

GPL-3.0-or-later, matching the upstream Evolver engine. See [LICENSE](LICENSE).
