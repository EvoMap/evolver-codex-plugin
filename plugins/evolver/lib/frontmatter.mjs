const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function unquote(value) {
  const trimmed = value.trim();
  const quoted = /^(['"])([\s\S]*)\1$/.exec(trimmed);
  return quoted ? quoted[2] : trimmed;
}

export function splitFrontmatter(markdown) {
  const match = FRONTMATTER.exec(markdown);
  if (!match) return { fields: {}, body: markdown };

  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator <= 0 || /^\s/.test(line)) continue;
    fields[line.slice(0, separator).trim()] = unquote(line.slice(separator + 1));
  }
  return { fields, body: markdown.slice(match[0].length).trim() };
}
