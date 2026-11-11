/** Task-list helpers shared by the preview (checkbox clicks) and checklist UI. */
const TASK_RE = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\]\s)/;

/** Toggles the task checkbox on a 0-based source line. Returns the input unchanged if that line is not a task. */
export function toggleTaskAtLine(md: string, line: number): string {
  const lines = md.split('\n');
  const l = lines[line];
  if (l === undefined) return md;
  const m = TASK_RE.exec(l);
  if (!m) return md;
  const checked = m[2] !== ' ';
  lines[line] = l.replace(TASK_RE, `$1${checked ? ' ' : 'x'}$3`);
  return lines.join('\n');
}

export function taskStats(md: string): { done: number; total: number } {
  let done = 0;
  let total = 0;
  let inFence = false;
  for (const l of md.split('\n')) {
    if (/^\s*(```|~~~)/.test(l)) inFence = !inFence;
    if (inFence) continue;
    const m = TASK_RE.exec(l);
    if (m) {
      total++;
      if (m[2] !== ' ') done++;
    }
  }
  return { done, total };
}
