# Evolver — Codex plugin

Evolver for Codex, powered by [Evolver](https://github.com/EvoMap/evolver) (`@evomap/evolver`) and [EvoMap](https://evomap.ai):
before each prompt it recalls one proven strategy, grades how the turn that used it went on evidence (the checks
the turn ran, whether its edits were kept, your next reply), reports that back to the EvoMap network, and distills
the session's verified work into a new Gene when the session ends.

The plugin runs entirely from Codex hooks. It registers **no tools and no skill**, so nothing of Evolver enters
the model's context but the recalled steps, which end with `Apply them where they fit.` — no instruction to
search, report or distill. Reports and distillation run on hook events; people reach Evolver through the
plugin's `scripts/evolver.mjs`.

## What runs when

| Codex hook | What the plugin does |
| --- | --- |
| `SessionStart` | Reports the previous session's kept or reverted edits (retention) and the open strategies of a killed session (aborted), starts Evolver if it is missing or too old, and distills leftover candidates — all in a detached background worker. Adds no context, except a one-off notice when it installed, upgraded or could not start Evolver. |
| `UserPromptSubmit` | Recalls by the prompt text (`POST /asset/fetch {text}` on the local Proxy) and adds the best strategy as `additionalContext`; labels the previous turn's reuse from this prompt (correction or praise) and drops its candidate on a correction. |
| `PreToolUse` (`Bash`, `apply_patch`) | Hashes the files a patch is about to touch, for the retention report. |
| `PostToolUse` (`Bash`, `apply_patch`) | Notes the turn's commands, checks (test, build, lint, type check) with pass or fail, touched paths and the files its patches edited. |
| `Stop` | Reports every strategy injected into the turn; makes the turn the session's distillation candidate when it ended verified. A continuation another Stop hook starts joins the turn: its work re-judges the candidate (the reports have already gone out). |
| `Interrupt` (Codex 0.150+) | Reports the turn's strategies as aborted. |
| `SessionEnd` (Codex 0.145+) | Closes a turn still open as one that ended on an error (Codex interrupts a running turn before it), reports what is left as aborted, closes the candidate and starts its distillation in the background. Keeps the session's turn counter, so a resumed thread never repeats a task id. |

### Codex versions

Codex 0.150 or newer runs every hook. Older versions read the same `hooks/hooks.json` and ignore the events they
do not have (0.144 parses hook events into named fields without rejecting unknown ones), and the plugin falls
back as follows:

- Without `Interrupt` (before 0.150), an interrupted turn is closed by the next prompt, as one that ended on an
  error (`outcome: failed`, `aborted: false`).
- Without `SessionEnd` (before 0.145), a session counts as over once its Codex process is
  gone: the next session start reports its open strategies as aborted and claims its candidate.
- Codex Desktop runs sessions in one long-lived app-server, so there a killed session only counts as gone once
  the app-server exits.

## Prerequisites

- Codex with hooks enabled (`[features] hooks`, on by default). Plugin hooks run only once you trust them: open
  `/hooks` in Codex after installing or updating the plugin and approve the Evolver hooks.
- Node.js 20 or newer on the `PATH` Codex hooks see (hooks run through your login shell).
- Evolver 2.0.44 or newer. The plugin installs it under `~/.evolver/state/codex-engine` and starts its Proxy in the
  background when it is missing; `npm install -g @evomap/evolver@latest` works too.

## Configure

**Local memory works with zero config** — no account, no key, no node id. The plugin reads the live Proxy URL
and token from `~/.evolver/settings.json` (written by the Proxy), else `http://127.0.0.1:19820`
(`EVOMAP_PROXY_PORT` changes the port).

### Connecting to the EvoMap network (optional)

1. **Leave `A2A_NODE_ID` blank.** The first run registers a fresh node for you and prints a **claim link**.
2. Open that link while signed in to [evomap.ai](https://evomap.ai). `evolver.mjs status` shows a pending link.

## Commands

Codex plugins cannot add commands, so the commands dsh offers as `/evolver-*` are one script the person runs in
a terminal. Nothing of it reaches the model.

```bash
node ~/.codex/plugins/cache/evomap/evolver/<version>/scripts/evolver.mjs <command> [arguments]
```

| Command | What it does |
| --- | --- |
| `status` | The Proxy, engine setup, the latest recall, recent reuse reports with the Hub's verdict, waiting candidates, claim link. |
| `search <text>` | Searches the EvoMap network (`POST /asset/search`). |
| `distill [--session <id>] [focus]` | Distills a session's latest verified turn now. A terminal has no current session, so it takes the most recently written candidate unless `--session` names one (dsh distills its own session). |
| `evolve [focus]` | Prints an evolution-checkpoint instruction to paste into Codex; the only command meant for the agent. |
| `sync`, `review`, `run`, `solidify` | Run the `evolver` CLI (`npx -y @evomap/evolver@^2.0.44` when it is not installed), ten minutes at most. |

## Session-end distillation

A turn that ended completed (`Stop`), used tools and passed its last check leaves a candidate in
`~/.evolver/state/codex-distill-pending.json`, a turn that reused an injected strategy too (the engine's intake
drops a Gene that repeats one it already has); a later verified turn replaces it, and a next prompt
that reads as a correction drops it (a distillation already running sees that and stops). When the session ends,
a detached worker runs Codex itself headless on the session's model —
`codex exec --ephemeral --json --sandbox read-only --disable hooks --disable plugins --disable shell_tool …` with
the prompt on stdin — to write a Gene from a digest of that turn (task, commands, touched paths, checks, final
answer — never the whole history), and sends it to the Proxy's `POST /conversation/distill` with
`platform: 'codex'`, `trigger: 'session_end'`, `persist: true`, `publish: false` and its own token cost as
`distill_usage`. Keys and tokens are stripped from the candidate first, paths and a manual focus included.

A candidate stays on disk until it is distilled; three failed tries (no `codex` to run, not logged in, an
unparsed answer, a Proxy error) give it up. One whose session is over — ended, or killed with its Codex process —
is claimed by the next session start, one process at a time, while an idle session keeps its own.

**Owner.** Codex runs each hook through `$SHELL -lc` in a process session of its own, so the hook's own pid says
nothing. The owner recorded with a candidate or an injection is the nearest ancestor process whose executable is
named `codex*` (the CLI, or the Desktop app's app-server). Where no process table can be read (Windows) no owner is
recorded, and such entries are only reported or distilled once their session ends.

## Reuse reports

Every strategy injected into a turn is reported through the Proxy's `POST /asset/reuse-result` as
`{asset_id, outcome, task_id, reason, evidence}`:

| Report | When | `task_id` | `evidence` |
|---|---|---|---|
| Turn end | `Stop`, `Interrupt`, or the next prompt after a turn that ended on an error | `codex:<session>:<turn>` | `tier` `L1` when the turn ran a test, build, lint or type check, else `none`; `applied: used`; `check` `{kind, passed, fail_then_pass}` of the last check; `aborted`; `stage: immediate` |
| Correction | the next prompt says the answer did not hold, or approves it | `…:correction` | `tier: L3`, `applied: used`, `stage: correction` |
| Retention | the next session in the same project finds the turn's edits kept or reverted | `…:retention` | `tier: L2`, `applied: used`, `stage: retention` |
| Aborted | the session ends, or is killed, before the turn ends (a killed session's go out at the next session start, once its Codex process is gone) | `codex:<session>:<turn>` | `tier: none`, `applied: used`, `aborted: true`, `stage: immediate` |

- **`applied`** is always `used`: the model follows a strategy injected into its turn. Whether the strategy
  helped is what the outcome says, judged by the turn's last check (or how the turn ended when it ran none), the
  next prompt and whether its edits were kept.
- **Checks** are `Bash` commands that run tests, builds, linters or type checkers. Codex hands the `Bash` hook
  the bare output, not the exit code, so a check fails on failure output or a timeout; a result formatted with
  an `Exit code:` header fails on a non-zero code. A command still running at its wait limit is pending until
  Codex reports its completion (a later `Bash` PostToolUse for the same call, from the poll that saw it exit);
  one still pending when the turn ends counts as not run. Such a check is judged by the output of that last poll
  alone, so a failure is seen only when the runner's closing summary repeats it.
- **Delivery.** Reports wait in `~/.evolver/state/codex-reports-outbox.json` and are retried by the background
  worker at every turn end, follow-up prompt and session start for 8 days. One the Hub refuses as invalid is
  settled as rejected and never resent. Reports with evidence are also written once to the local root event log.
- Reasons name the turn and the check kind, never the prompt, a command or code, and the
  prompt loses keys and tokens before recall sends it.

## Develop

```bash
npm test
python3 ~/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugins/evolver
```

## Uninstall

Remove or disable the plugin from Codex Plugins. Local Evolver memory under `~/.evolver/` is left intact.

## License

GPL-3.0-or-later, matching the upstream Evolver engine. See [LICENSE](LICENSE).
