export const ABSENT = 'absent';

function fileFateOf({ before, after, now }) {
  if (now === after) return 'kept';
  if (now === before) return 'reverted';
  return 'rewritten';
}

export function retentionOf(files) {
  const changed = (files ?? []).filter(({ before, after }) => before !== after);
  if (changed.length === 0) return { class: 'no_change', files: 0 };
  const fates = new Set(changed.map(fileFateOf));
  const verdict = fates.size === 1 ? [...fates][0] : 'rewritten';
  return { class: verdict, files: changed.length };
}
