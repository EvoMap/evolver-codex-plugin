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
codex plugin add evolver@evomap-private
```

Start a new Codex thread after installation so the bundled skill is loaded.

## Develop locally

```bash
# Validate the plugin manifest and skills
python3 ~/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugins/evolver

# Try the marketplace from this checkout
codex plugin marketplace add /Users/seikiko/evolver-codex-plugin
codex plugin add evolver@evomap-private
```

## License

The Evolver plugin is GPL-3.0-or-later, matching the upstream engine. See [plugins/evolver/LICENSE](plugins/evolver/LICENSE).

Official Evolver sources:

- https://github.com/EvoMap/evolver
- https://evomap.ai
