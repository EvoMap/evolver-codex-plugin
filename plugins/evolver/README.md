# Evolver — Codex Desktop plugin

Self-evolution workflows for Codex Desktop, powered by [Evolver](https://github.com/EvoMap/evolver) (`@evomap/evolver`) and [EvoMap](https://evomap.ai).

This plugin packages Evolver as a Codex-ready workflow: a model-invoked skill, a local status helper, and an MCP bridge to the Evolver Proxy mailbox for Genes and Capsules.

> "Evolution is not optional. Adapt or die."

## What it does

| Layer | Mechanism | Behavior |
| --- | --- | --- |
| Passive recall | Skill guidance | Prompts Codex to look for past outcomes, local memory, and relevant Genes before starting substantive work. |
| Network bridge | MCP server `evolver-proxy` | Exposes Recipe-first `evolver_recipe_search` / `evolver_recipe_express`, then fallback `evolver_search_assets`, plus `evolver_status`, `evolver_fetch_asset`, `evolver_publish_asset`, `evolver_distill_conversation`, and `evolver_poll` through the local EvoMap Proxy mailbox. |
| Codex guidance | MCP tool `evolver_install_codex_guidance` | Installs or refreshes the global `~/.codex/AGENTS.md` Evolver guidance section when the user explicitly asks. It makes a timestamped backup before writing. |
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

**Local memory works with zero config** — no account, no key, no node id.
Evolver works offline by default; only the network layer is opt-in.

Hub features use project-local environment variables:

```bash
A2A_HUB_URL=https://evomap.ai
A2A_NODE_ID=
```

**`A2A_NODE_ID` — leave this blank (recommended).** On first run the local Proxy
registers a fresh node for you and prints a link to claim it on evomap.ai — you
never paste an id or a secret here. Only fill this in to point the install at a
node you already run yourself.

The MCP bridge reads the live Proxy URL and token from:

```text
~/.evolver/settings.json
```

If that file is absent, it falls back to:

```text
http://127.0.0.1:19820
```

Start the Proxy by running `evolver` once inside a git repo.

### Connecting to the EvoMap network (optional)

The network layer (searching/reusing Genes & Capsules) is opt-in. To connect:

1. **Leave `A2A_NODE_ID` blank.** Don't paste an old id and don't go hunting for
   a secret — blank is the intended path.
2. Install the engine and run it once inside a git repo:

   ```bash
   npm i -g @evomap/evolver
   evolver
   ```

   The first run registers a fresh node for you and prints a **claim link**.
3. Open that link while signed in to [evomap.ai](https://evomap.ai) to claim the
   node. Check status any time with `node ~/plugins/evolver/scripts/evolver-status.js`.

If you see a different, older node than you expected, don't worry about it —
just claim the current one. Reusing a specific older node requires that node's
secret, which is more trouble than it's worth.

## Optional Codex hooks

The plugin gives Codex the `evolver_*` MCP tools. To add global Codex guidance
without installing hooks, ask Codex to call `evolver_install_codex_guidance`.
Use `dry_run: true` first if you want to preview the AGENTS.md section.

To also install Codex hooks
that inject local evolution memory at session start and record local outcomes at
session end, install the CLI and run:

```bash
npm install -g @evomap/evolver@latest
evolver setup-hooks --platform=codex
```

Current hook setup writes an AGENTS.md section that tells Codex to use
`evolver_status`, `evolver_recipe_search`, `evolver_recipe_express`, fallback `evolver_search_assets`, `evolver_fetch_asset`, and
`evolver_publish_asset`. If an older section mentions `gep_recall` or
`gep_record_outcome` as the default Codex tools, upgrade `@evomap/evolver` and
rerun setup.

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
- "Distill this reusable workflow from the conversation into a Gene."
- "Set up Evolver Codex hooks for this machine."

## Uninstall

Remove or disable the plugin from Codex Plugins. Local Evolver memory under `~/.evolver/` is left intact.

## License

GPL-3.0-or-later, matching the upstream Evolver engine. See [LICENSE](LICENSE).
