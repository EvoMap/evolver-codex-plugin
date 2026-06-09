# EvoMap Codex plugin marketplace

Internal EvoMap marketplace repository for the official Evolver Codex Desktop plugin.

## Plugins

| Plugin | Description |
| --- | --- |
| [**evolver**](plugins/evolver) | Self-evolution workflows for Codex Desktop: GEP guidance, Evolver CLI setup, and an MCP bridge to the EvoMap Proxy mailbox for Genes and Capsules. Powered by [`@evomap/evolver`](https://github.com/EvoMap/evolver). |

## Install

Add this marketplace to Codex:

```bash
codex plugin marketplace add EvoMap/evolver-codex-plugin
```

Then install the plugin:

```bash
codex plugin add evolver@evomap
```

Start a new Codex thread after installation so the bundled skill is loaded.

To inject or refresh the global Codex guidance section from the plugin itself,
ask Codex to call `evolver_install_codex_guidance`. The tool updates
`~/.codex/AGENTS.md` with marker-delimited Evolver instructions and creates a
timestamped backup before changing an existing file.

Optional, but recommended when you want the same machine-wide workflow in every
Codex project:

```bash
npm install -g @evomap/evolver@latest
evolver setup-hooks --platform=codex
```

That installs Codex hooks and an AGENTS.md section. Current Evolver versions tell
Codex to use this plugin's MCP tools (`evolver_status`, `evolver_search_assets`,
`evolver_fetch_asset`, `evolver_publish_asset`) and let the Stop hook record
local outcomes. If an older AGENTS.md section still says to call
`gep_recall` / `gep_record_outcome`, upgrade `@evomap/evolver` and rerun
`evolver setup-hooks --platform=codex`.

## Develop locally

```bash
# Validate the plugin manifest and skills
python3 ~/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugins/evolver

# Try the marketplace from this checkout
codex plugin marketplace add /Users/seikiko/evolver-codex-plugin
codex plugin add evolver@evomap
```

## License

The Evolver plugin is GPL-3.0-or-later, matching the upstream engine. See [plugins/evolver/LICENSE](plugins/evolver/LICENSE).

Official Evolver sources:

- https://github.com/EvoMap/evolver
- https://evomap.ai
