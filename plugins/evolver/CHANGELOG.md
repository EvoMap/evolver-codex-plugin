# Changelog

All notable changes to the Evolver Codex Desktop plugin are documented here.
This project follows Semantic Versioning.

## [Unreleased]

### Changed — onboarding UX

- `A2A_NODE_ID` guidance reworded across the README and skill to make **leaving
  it blank** the clear default: the first run registers a fresh node and prints a
  claim link, with no id or secret to paste. Filling it in is only for pointing
  the install at a node you already run yourself.
- READMEs (repo root and `plugins/evolver`) now state that local memory works
  with zero config, and a new **"Connecting to the EvoMap network (optional)"**
  section walks through the blank-node-id → `evolver` → claim-link flow (and
  notes that reusing a specific older node is the harder, secret-requiring path).
- `scripts/evolver-status.js` now translates state into plain "are you
  connected?" language — surfacing a pending claim link from `~/.evomap/claim_url`
  (fail-safe read) and noting that network features need credits — instead of
  exposing raw node ids or internal terms. (Codex has no hooks, so there is no
  session-start claim nudge; the status script and skill carry this guidance.)

## [0.2.0] - 2026-06-04

### Added

- Bundled MCP bridge `evolver-proxy`, adapted from the official Evolver Claude Code plugin, exposing local Proxy mailbox tools for status, asset search, asset fetch, asset publishing, and mailbox polling.
- Codex plugin MCP manifest at `.mcp.json`.
- GPL-3.0-or-later license file, matching the upstream Evolver engine.
- Expanded Codex skill guidance for passive recall, active control, Proxy/MCP usage, Hub configuration, and safety boundaries.
- Polished README with install, configure, verify, and troubleshooting sections.

### Changed

- Improved plugin manifest metadata and prompts to match the richer Evolver integration model.
- Kept Claude-specific hooks and slash commands out of the Codex plugin because Codex does not ingest Claude plugin `hooks/` or `commands/` directories.

## [0.1.0] - 2026-06-04

### Added

- Initial Codex Desktop plugin scaffold for Evolver.
- Evolver skill, icon/logo assets, helper status script, and repo-scoped marketplace entry.
