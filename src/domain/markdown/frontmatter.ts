/** YAML frontmatter is preserved verbatim; we only split it off for title derivation and preview. */
export function splitFrontmatter(md: string): { frontmatter: string | null; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(md);
  if (!m) return { frontmatter: null, body: md };
  return { frontmatter: m[1]!, body: md.slice(m[0].length) };
}

/** Reads a top-level scalar `title:` from frontmatter (no full YAML parser needed for this). */
export function frontmatterTitle(fm: string | null): string | null {
  if (!fm) return null;
  const m = /^title:\s*(.+?)\s*$/m.exec(fm);
  if (!m) return null;
  return m[1]!.replace(/^(['"])(.*)\1$/, '$2').trim() || null;
}

/** Title for a note: frontmatter title → first heading → first non-empty line, trimmed to 120 chars. */
export function deriveTitle(md: string): string {
  const { frontmatter, body } = splitFrontmatter(md);
  const fmTitle = frontmatterTitle(frontmatter);
  if (fmTitle) return fmTitle.slice(0, 120);
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (!line || /^(```|~~~|---|\|)/.test(line)) continue;
    const text = line
      .replace(/^#{1,6}\s+/, '')
      .replace(/^(>\s*)+/, '')
      .replace(/^([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/, '')
      .replace(/[*_~`]/g, '')
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      .trim();
    if (text) return text.slice(0, 120);
  }
  return '';
}
