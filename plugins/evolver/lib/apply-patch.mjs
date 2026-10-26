const FILE_HEADER = /^\*\*\* (?:Add|Update|Delete) File: (.+)$|^\*\*\* Move to: (.+)$/;
const ADDED_LINE = /^\+(?!\+\+ )/;
const APPLIED = /^Exit code: 0\b|^Success\./m;
const EMBEDDED_PATCH = /^\*\*\* Begin Patch$[\s\S]*?^\*\*\* End Patch$/m;

// Codex models also apply a patch through the shell (`apply_patch <<'PATCH' … PATCH`), which reaches the hooks
// as a Bash call, so the patch is found in either tool's command.
export function patchOf(toolName, command) {
  if (typeof command !== 'string') return null;
  if (toolName === 'apply_patch') return command;
  return EMBEDDED_PATCH.exec(command)?.[0] ?? null;
}

export function patchedPaths(patch) {
  const paths = [];
  for (const line of String(patch ?? '').split('\n')) {
    const match = FILE_HEADER.exec(line.trimEnd());
    const file = match?.[1] ?? match?.[2];
    if (file && !paths.includes(file.trim())) paths.push(file.trim());
  }
  return paths;
}

export function patchedContent(patch) {
  return String(patch ?? '')
    .split('\n')
    .filter((line) => ADDED_LINE.test(line))
    .map((line) => line.slice(1))
    .join('\n');
}

export function patchApplied(response) {
  return typeof response === 'string' && APPLIED.test(response);
}
