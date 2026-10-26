import fs from 'node:fs';

export function projectDirOf(input) {
  const candidate = typeof input?.cwd === 'string' && input.cwd ? input.cwd : process.cwd();
  try {
    return fs.realpathSync(candidate);
  } catch {
    return candidate;
  }
}
