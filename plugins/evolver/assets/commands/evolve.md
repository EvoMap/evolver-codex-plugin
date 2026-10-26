---
description: Run an evolution checkpoint — recall relevant past outcomes, reflect on the current task, and record what was learned.
---

Take a deliberate evolution step for the current task.

1. **Recall.** Look at the evolution memory this plugin injected behind the prompt, or read
   the tail of the full engine's memory graph — `~/.evolver/memory/evolution/memory_graph.jsonl`, or the
   project's `memory/evolution/memory_graph.jsonl` when it exists. Summarize any recent
   outcome — success or failure — relevant to what we're working on.

2. **Reflect.** Given the current diff and task state, say in one or two lines: what
   worked, what didn't, and what the durable lesson is.

Reuse of an injected strategy is reported at every turn end, and the session's verified work is
distilled when the session ends; `evolver-distill` distills it now. Keep this lightweight — it is an
explicit checkpoint, not a ceremony on every turn.
