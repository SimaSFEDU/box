import {
  applySmartNewline,
  continueListOnEnter,
  insertCodeBlock,
  insertLink,
  insertTable,
  toggleInline,
  toggleLinePrefix,
  type EditorState,
} from '../src/domain/markdown/editing';
import { deriveTitle, splitFrontmatter } from '../src/domain/markdown/frontmatter';
import { createRenderer } from '../src/domain/markdown/render';
import { taskStats, toggleTaskAtLine } from '../src/domain/markdown/tasks';

const st = (text: string, start: number, end = start): EditorState => ({ text, selection: { start, end } });

describe('inline formatting', () => {
  it('wraps and unwraps selection', () => {
    const a = toggleInline(st('hello world', 6, 11), '**');
    expect(a.text).toBe('hello **world**');
    expect(a.selection).toEqual({ start: 8, end: 13 });
    expect(toggleInline(a, '**').text).toBe('hello world');
  });
  it('inserts placeholder at caret', () => {
    const a = toggleInline(st('x ', 2), '_');
    expect(a.text).toBe('x _текст_');
    expect(a.text.slice(a.selection.start, a.selection.end)).toBe('текст');
  });
});

describe('line prefixes', () => {
  it('toggles heading on current line keeping caret on text', () => {
    const a = toggleLinePrefix(st('one\ntwo', 5), 'h2');
    expect(a.text).toBe('one\n## two');
    expect(a.selection.start).toBe(8);
    expect(toggleLinePrefix(a, 'h2').text).toBe('one\ntwo');
  });
  it('replaces an existing prefix instead of stacking', () => {
    expect(toggleLinePrefix(st('# title', 3), 'h2').text).toBe('## title');
    expect(toggleLinePrefix(st('- item', 3), 'task').text).toBe('- [ ] item');
  });
  it('numbers multiple lines and preserves indentation', () => {
    const a = toggleLinePrefix(st('a\n  b\nc', 0, 7), 'numbered');
    expect(a.text).toBe('1. a\n  2. b\n3. c');
  });
});

describe('blocks', () => {
  it('inserts table on its own paragraph', () => {
    const a = insertTable(st('text', 4), 2, 1);
    expect(a.text).toBe('text\n\n| Столбец 1 | Столбец 2 |\n| --- | --- |\n|     |     |\n');
  });
  it('wraps selection in a code block', () => {
    const a = insertCodeBlock(st('let x', 0, 5), 'ts');
    expect(a.text).toBe('```ts\nlet x\n```\n');
  });
  it('link selects the url for editing', () => {
    const a = insertLink(st('see docs', 4, 8));
    expect(a.text).toBe('see [docs](https://)');
    expect(a.text.slice(a.selection.start, a.selection.end)).toBe('https://');
  });
});

describe('smart enter', () => {
  it('continues bullets, numbers and tasks', () => {
    expect(continueListOnEnter(st('- a', 3))!.text).toBe('- a\n- ');
    expect(continueListOnEnter(st('9. a', 4))!.text).toBe('9. a\n10. ');
    expect(continueListOnEnter(st('  - [x] a', 9))!.text).toBe('  - [x] a\n  - [ ] ');
  });
  it('ends the list on an empty item', () => {
    expect(continueListOnEnter(st('- a\n- ', 6))!.text).toBe('- a\n');
  });
  it('ignores plain lines', () => {
    expect(continueListOnEnter(st('plain', 5))).toBeNull();
  });
});

describe('tasks', () => {
  const md = '# T\n- [ ] one\n- [x] two\n```\n- [ ] not a task\n```';
  it('toggles by line', () => {
    expect(toggleTaskAtLine(md, 1)).toContain('- [x] one');
    expect(toggleTaskAtLine(md, 2)).toContain('- [ ] two');
    expect(toggleTaskAtLine(md, 0)).toBe(md);
    expect(toggleTaskAtLine(md, 99)).toBe(md);
  });
  it('counts tasks outside code fences', () => {
    expect(taskStats(md)).toEqual({ done: 1, total: 2 });
  });
});

describe('frontmatter & titles', () => {
  it('splits frontmatter', () => {
    expect(splitFrontmatter('---\na: 1\n---\nbody')).toEqual({ frontmatter: 'a: 1', body: 'body' });
    expect(splitFrontmatter('no fm').frontmatter).toBeNull();
  });
  it('derives titles', () => {
    expect(deriveTitle('---\ntitle: "Hi"\n---\n# Other')).toBe('Hi');
    expect(deriveTitle('\n\n## **Plan** for _today_')).toBe('Plan for today');
    expect(deriveTitle('- [ ] buy [milk](http://x)')).toBe('buy milk');
    expect(deriveTitle('```\ncode\n```')).toBe('code');
    expect(deriveTitle('')).toBe('');
  });
});

describe('renderer', () => {
  const r = createRenderer();
  it('renders GFM: tables, strikethrough, task lists with source lines', () => {
    const html = r.render('| a | b |\n|---|---|\n| 1 | 2 |\n\n~~old~~\n\n- [x] done\n- [ ] todo');
    expect(html).toContain('<div class="table-wrap"><table');
    expect(html).toContain('<s>old</s>');
    expect(html).toContain('<input type="checkbox" class="task-box" data-line="6" checked>');
    expect(html).toContain('data-line="7">');
    expect(html).toContain('class="tasks"');
  });
  it('highlights code', () => {
    expect(r.render('```js\nconst a = 1\n```')).toContain('<span class="hljs-keyword">const</span>');
  });
  it('escapes raw html and neutralises dangerous links', () => {
    const html = r.render('<script>alert(1)</script>\n\n[x](javascript:alert(1))');
    expect(html).not.toContain('<script>');
    expect(html).not.toMatch(/href="javascript/i);
  });
  it('blocks remote images but allows local attachments', () => {
    expect(r.render('![p](https://tracker.example/p.gif)')).toContain('img-blocked');
    expect(r.render('![p](attachments/01H.png)')).toContain('<img src="attachments/01H.png"');
  });
  it('offsets task lines by frontmatter length', () => {
    const src = '---\na: 1\n---\n- [ ] t';
    const html = r.render(src);
    const line = Number(/data-line="(\d+)" ?>?/.exec(html.slice(html.indexOf('task-box')))![1]);
    expect(src.split('\n')[line]).toBe('- [ ] t');
    expect(html).toContain('class="frontmatter"');
  });
});

describe('applySmartNewline', () => {
  it('only reacts to a single typed newline at the caret', () => {
    expect(applySmartNewline(st('- a', 3), '- a\n')!.text).toBe('- a\n- ');
    expect(applySmartNewline(st('- a', 3), '- ab')).toBeNull();
    expect(applySmartNewline(st('- a', 1), '-\n a')).toBeNull();
  });
});
