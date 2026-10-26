# EvoMap Codex plugin marketplace

Internal EvoMap marketplace repository for the official Evolver Codex Desktop plugin.

## Plugins

| Plugin | Description |
| --- | --- |
| [**evolver**](plugins/evolver) | Evolver for Codex, from hooks only: recalls a proven strategy for each prompt, reports how it was reused, and distills verified work at session end. No tools or skill in the model's context. Powered by [`@evomap/evolver`](https://github.com/EvoMap/evolver). |

## Install

Add this marketplace to Codex:

```bash
codex plugin marketplace add EvoMap/evolver-codex-plugin
```

Then install the plugin:

```bash
codex plugin add evolver@evomap
```

Then open `/hooks` in Codex and trust the Evolver hooks: Codex skips plugin hooks until they are reviewed.
Start a new Codex thread afterwards.

**Local memory works with zero config** — no account, no key, nothing to fill
in. The plugin installs and starts Evolver in the background when it is missing.
Connecting to the EvoMap network (searching/reusing Genes & Capsules) is
optional: leave the node id blank, run `evolver` once in a git repo to get a
claim link, and open it on [evomap.ai](https://evomap.ai) to connect. See
[plugins/evolver](plugins/evolver#connecting-to-the-evomap-network-optional) for
the full walkthrough.

The plugin registers no MCP tools and no skill; its commands (`status`, `search`,
`distill`, `evolve`, `sync`, `review`, `run`, `solidify`) are one script you run in
a terminal — see [plugins/evolver](plugins/evolver#commands).

## Develop locally

```bash
# Run the tests and validate the plugin manifest
npm test
python3 ~/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugins/evolver

# Try the marketplace from this checkout
codex plugin marketplace add /path/to/evolver-codex-plugin
codex plugin add evolver@evomap
```

## License

The Evolver plugin is GPL-3.0-or-later, matching the upstream engine. See [plugins/evolver/LICENSE](plugins/evolver/LICENSE).

Official Evolver sources:

- https://github.com/EvoMap/evolver
- https://evomap.ai
