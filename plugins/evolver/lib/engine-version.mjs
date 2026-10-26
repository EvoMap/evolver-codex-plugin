export const MIN_EVOLVER_VERSION = '2.0.44';

export function versionOf(text) {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(String(text ?? ''));
  return match ? match.slice(1, 4).join('.') : null;
}

function prereleaseOf(version) {
  return /\d+\.\d+\.\d+-([0-9A-Za-z.-]+)/.exec(String(version ?? ''))?.[1] ?? null;
}

function isOlderPrerelease(have, need) {
  if (have === null || need === null) return have !== null && need === null;
  return have.localeCompare(need, 'en', { numeric: true }) < 0;
}

export function isOlderThan(version, minimum) {
  const have = versionOf(version)?.split('.').map(Number);
  const need = versionOf(minimum)?.split('.').map(Number);
  if (!have || !need) return false;
  for (let index = 0; index < 3; index += 1) {
    if (have[index] !== need[index]) return have[index] < need[index];
  }
  return isOlderPrerelease(prereleaseOf(version), prereleaseOf(minimum));
}

export function meetsMinimum(version) {
  return Boolean(versionOf(version)) && !isOlderThan(version, MIN_EVOLVER_VERSION);
}

export function nodeRunsEvolver(nodeVersion) {
  const [major, minor] = (versionOf(nodeVersion) ?? '0.0.0').split('.').map(Number);
  if (major === 22) return minor >= 13;
  if (major === 23) return minor >= 4;
  return major > 23;
}
