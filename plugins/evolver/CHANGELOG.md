# Changelog

All notable changes to the Evolver Codex Desktop plugin are documented here.
This project follows Semantic Versioning.

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
