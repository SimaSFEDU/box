/**
 * Pure Markdown editing operations over `{ text, selection }`.
 * The editor UI only dispatches these; all logic is unit-tested here.
 */
export interface Selection {
  start: number;
  end: number;
}
export interface EditorState {
  text: string;
  selection: Selection;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

function normalize(s: EditorState): EditorState {
  const len = s.text.length;
  const a = clamp(Math.min(s.selection.start, s.selection.end), 0, len);
  const b = clamp(Math.max(s.selection.start, s.selection.end), 0, len);
  return { text: s.text, selection: { start: a, end: b } };
}

/** Wraps the selection in an inline marker (`**`, `_`, `~~`, `` ` ``); unwraps if already wrapped. */
export function toggleInline(state: EditorState, marker: string, placeholder = 'текст'): EditorState {
  const { text, selection } = normalize(state);
  const { start, end } = selection;
  const m = marker.length;
  const before = text.slice(Math.max(0, start - m), start);
  const after = text.slice(end, end + m);
  if (before === marker && after === marker) {
    return {
      text: text.slice(0, start - m) + text.slice(start, end) + text.slice(end + m),
      selection: { start: start - m, end: end - m },
    };
  }
  const inner = start === end ? placeholder : text.slice(start, end);
  return {
    text: text.slice(0, start) + marker + inner + marker + text.slice(end),
    selection: { start: start + m, end: start + m + inner.length },
  };
}

/** Returns [lineStart, lineEnd) covering every line touched by the selection. */
function lineRange(text: string, sel: Selection): [number, number] {
  const ls = text.lastIndexOf('\n', sel.start - 1) + 1;
  const nl = text.indexOf('\n', sel.end === sel.start ? sel.end : Math.max(sel.start, sel.end - 1));
  return [ls, nl === -1 ? text.length : nl];
}

export type LinePrefix = 'h1' | 'h2' | 'h3' | 'quote' | 'bullet' | 'numbered' | 'task';

const PREFIX_RE: Record<LinePrefix, RegExp> = {
  h1: /^# /,
  h2: /^## /,
  h3: /^### /,
  quote: /^> /,
  bullet: /^- (?!\[[ xX]\] )/,
  numbered: /^\d+\. /,
  task: /^- \[[ xX]\] /,
};
const ANY_BLOCK_PREFIX = /^(#{1,6} |> |- \[[ xX]\] |- |\* |\d+\. )/;

/** Toggles a block prefix on every selected line (keeps indentation for list nesting). */
export function toggleLinePrefix(state: EditorState, kind: LinePrefix): EditorState {
  const { text, selection } = normalize(state);
  const [ls, le] = lineRange(text, selection);
  const lines = text.slice(ls, le).split('\n');
  const parsed = lines.map((l) => {
    const indent = /^\s*/.exec(l)![0];
    return { indent, body: l.slice(indent.length) };
  });
  const allHave = parsed.filter((p) => p.body.length > 0 || lines.length === 1).every((p) => PREFIX_RE[kind].test(p.body));
  let n = 0;
  const out = parsed.map(({ indent, body }) => {
    if (body.length === 0 && lines.length > 1) return indent;
    const stripped = body.replace(ANY_BLOCK_PREFIX, '');
    if (allHave) return indent + stripped;
    n++;
    const prefix =
      kind === 'h1' ? '# ' : kind === 'h2' ? '## ' : kind === 'h3' ? '### ' : kind === 'quote' ? '> ' : kind === 'bullet' ? '- ' : kind === 'numbered' ? `${n}. ` : '- [ ] ';
    return indent + prefix + stripped;
  });
  const replaced = out.join('\n');
  const newText = text.slice(0, ls) + replaced + text.slice(le);
  const delta = replaced.length - (le - ls);
  const caret = lines.length === 1 && selection.start === selection.end ? clamp(selection.end + delta, ls, ls + replaced.length) : null;
  return {
    text: newText,
    selection: caret !== null ? { start: caret, end: caret } : { start: ls, end: ls + replaced.length },
  };
}

/** Inserts a block snippet on its own line(s); `cursorOffset` positions the caret inside the snippet. */
export function insertBlock(state: EditorState, snippet: string, cursorOffset = snippet.length): EditorState {
  const { text, selection } = normalize(state);
  const before = text.slice(0, selection.start);
  const after = text.slice(selection.end);
  const lead = before.length === 0 || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  const trail = after.length === 0 || after.startsWith('\n') ? '\n' : '\n\n';
  const pos = before.length + lead.length + cursorOffset;
  return { text: before + lead + snippet + trail + after, selection: { start: pos, end: pos } };
}

export function insertCodeBlock(state: EditorState, lang = ''): EditorState {
  const { text, selection } = normalize(state);
  const code = text.slice(selection.start, selection.end);
  const snippet = '```' + lang + '\n' + code + '\n```';
  return insertBlock({ text: text.slice(0, selection.start) + text.slice(selection.end), selection: { start: selection.start, end: selection.start } }, snippet, 4 + lang.length + code.length);
}

export function insertTable(state: EditorState, cols = 3, rows = 2): EditorState {
  const header = '| ' + Array.from({ length: cols }, (_, i) => `Столбец ${i + 1}`).join(' | ') + ' |';
  const sep = '| ' + Array.from({ length: cols }, () => '---').join(' | ') + ' |';
  const row = '| ' + Array.from({ length: cols }, () => '   ').join(' | ') + ' |';
  const snippet = [header, sep, ...Array.from({ length: rows }, () => row)].join('\n');
  return insertBlock(state, snippet, header.length + sep.length + 4);
}

export const insertHorizontalRule = (s: EditorState) => insertBlock(s, '---');

export function insertLink(state: EditorState, url = 'https://'): EditorState {
  const { text, selection } = normalize(state);
  const label = text.slice(selection.start, selection.end) || 'ссылка';
  const md = `[${label}](${url})`;
  const urlStart = selection.start + label.length + 3;
  return {
    text: text.slice(0, selection.start) + md + text.slice(selection.end),
    selection: { start: urlStart, end: urlStart + url.length },
  };
}

export function insertImage(state: EditorState, relPath: string, alt = ''): EditorState {
  return insertBlock(state, `![${alt}](${relPath})`);
}

/**
 * Smart Enter: continues lists/tasks/quotes; an empty list item ends the list.
 * Returns null when the default newline behaviour is fine.
 */
export function continueListOnEnter(state: EditorState): EditorState | null {
  const { text, selection } = normalize(state);
  if (selection.start !== selection.end) return null;
  const ls = text.lastIndexOf('\n', selection.start - 1) + 1;
  const line = text.slice(ls, selection.start);
  const m = /^(\s*)(- \[[ xX]\] |- |\* |> |(\d+)\. )(.*)$/.exec(line);
  if (!m) return null;
  const [, indent, marker, num, rest] = m;
  if (rest!.trim() === '') {
    // Empty item: remove the marker and end the list.
    return { text: text.slice(0, ls) + text.slice(selection.start), selection: { start: ls, end: ls } };
  }
  const next = num ? `${Number(num) + 1}. ` : marker!.startsWith('- [') ? '- [ ] ' : marker!;
  const ins = '\n' + indent + next;
  const pos = selection.start + ins.length;
  return { text: text.slice(0, selection.start) + ins + text.slice(selection.end), selection: { start: pos, end: pos } };
}

/**
 * Called from onChangeText. If the change is exactly one '\n' typed at the caret, applies
 * list continuation; otherwise returns null and the raw text is used.
 */
export function applySmartNewline(prev: EditorState, nextText: string): EditorState | null {
  const { text, selection } = normalize(prev);
  if (selection.start !== selection.end) return null;
  const expected = text.slice(0, selection.start) + '\n' + text.slice(selection.start);
  if (nextText !== expected) return null;
  return continueListOnEnter({ text, selection });
}
