import { createHash } from 'crypto';
import { unzipSync, zipSync } from 'fflate';

import {
  buildExport,
  frontmatterTags,
  planImport,
  resolvePlaceholders,
  type ExportNote,
  type ImportEntry,
} from '../src/domain/notes/archive';
import { noteFileName, relativeFrom, sanitizeFileName } from '../src/domain/notes/exportPaths';

const sha = async (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const enc = new TextEncoder();
const entries = (files: Record<string, string | Uint8Array>): ImportEntry[] =>
  Object.entries(files).map(([path, v]) => {
    const bytes = typeof v === 'string' ? enc.encode(v) : v;
    return { path, size: bytes.length, read: async () => bytes };
  });
const fromZip = (zip: Uint8Array): ImportEntry[] =>
  Object.entries(unzipSync(zip)).map(([path, bytes]) => ({ path, size: bytes.length, read: async () => bytes }));

const note = (o: Partial<ExportNote>): ExportNote => ({
  id: 'id1',
  title: 'Note',
  format: 'markdown',
  body: '',
  sourcePath: null,
  tags: [],
  favorite: false,
  archived: false,
  createdAt: 1,
  updatedAt: 2,
  ...o,
});

describe('file names', () => {
  it('sanitizes and dedupes', () => {
    expect(sanitizeFileName('a/b:c*?')).toBe('a b c');
    expect(sanitizeFileName('...')).toBe('Без названия');
    const used = new Set<string>();
    expect(noteFileName('Plan', '', used)).toBe('Plan.md');
    expect(noteFileName('plan', '', used)).toBe('plan 2.md');
    expect(noteFileName('', '# From body', used)).toBe('From body.md');
    expect(relativeFrom('Notes/a/b/x.md', 'attachments/i.png')).toBe('../../../attachments/i.png');
  });
});

describe('frontmatter tags', () => {
  it('parses inline and block lists', () => {
    expect(frontmatterTags('tags: [a, "b"]')).toEqual(['a', 'b']);
    expect(frontmatterTags('tags: x, #y')).toEqual(['x', 'y']);
    expect(frontmatterTags('title: t\ntags:\n  - one\n  - two\n')).toEqual(['one', 'two']);
    expect(frontmatterTags(null)).toEqual([]);
  });
});

describe('export → import round trip', () => {
  it('restores notes, metadata, folders and attachments losslessly', async () => {
    const png = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
    const notes = [
      note({ id: 'A', title: 'Daily', body: '# Daily\n\n![pic](attachments/X.png)\n- [ ] task', tags: ['work'], favorite: true, sourcePath: 'Journal/2026/Daily.md' }),
      note({ id: 'B', title: 'Daily', body: 'second with same title', archived: true }),
    ];
    const files = await buildExport(notes, new Map([['attachments/X.png', png]]), sha, 99);
    expect([...files.keys()].sort()).toEqual(['Notes/Daily.md', 'Notes/Journal/2026/Daily.md', 'attachments/X.png', 'clipbox.json']);
    expect(new TextDecoder().decode(files.get('Notes/Journal/2026/Daily.md'))).toContain('](../../../attachments/X.png)');

    const zip = zipSync(Object.fromEntries(files));
    const plan = await planImport(fromZip(zip), sha);
    expect(plan.kind).toBe('clipbox');
    const a = plan.notes.find((n) => n.originalId === 'A')!;
    expect(a).toMatchObject({ title: 'Daily', tags: ['work'], favorite: true, sourcePath: 'Journal/2026/Daily.md', createdAt: 1, updatedAt: 2 });
    expect(a.attachments).toEqual(['attachments/X.png']);
    const restored = resolvePlaceholders(a.body, new Map([['attachments/X.png', 'attachments/NEW.png']]));
    expect(restored).toBe('# Daily\n\n![pic](attachments/NEW.png)\n- [ ] task');
    expect(plan.notes.find((n) => n.originalId === 'B')).toMatchObject({ archived: true, body: 'second with same title' });
  });

  it('rejects tampered archives', async () => {
    const files = await buildExport([note({ body: 'original' })], new Map(), sha, 1);
    files.set('Notes/Note.md', enc.encode('tampered'));
    await expect(planImport(fromZip(zipSync(Object.fromEntries(files))), sha)).rejects.toThrow('Контрольная сумма');
    files.delete('Notes/Note.md');
    await expect(planImport(fromZip(zipSync(Object.fromEntries(files))), sha)).rejects.toThrow('отсутствует');
  });
});

describe('Obsidian vault import', () => {
  it('imports notes, frontmatter tags, relative images and ![[embeds]]; skips .obsidian', async () => {
    const img = new Uint8Array([1, 2, 3]);
    const plan = await planImport(
      entries({
        '.obsidian/app.json': '{}',
        'Projects/Idea.md': '---\ntags: [idea]\n---\n# Idea\n![[diagram.png|Diagram]] and ![](../assets/photo.jpg) [[Other note]] ![[Other note]] [web](https://x.y)',
        'assets/photo.jpg': img,
        'media/diagram.png': img,
        'Inbox.md': '﻿plain\r\ntext',
      }),
      sha,
    );
    expect(plan.kind).toBe('markdown');
    expect(plan.notes).toHaveLength(2);
    const idea = plan.notes.find((n) => n.sourcePath === 'Projects/Idea.md')!;
    expect(idea.title).toBe('Idea');
    expect(idea.tags).toEqual(['idea']);
    expect(idea.attachments.sort()).toEqual(['assets/photo.jpg', 'media/diagram.png']);
    expect(idea.body).toContain('![Diagram](clipbox-att://media/diagram.png)');
    expect(idea.body).toContain('![](clipbox-att://assets/photo.jpg)');
    expect(idea.body).toContain('[[Other note]] ![[Other note]]'); // non-image wikilinks preserved
    expect(idea.body).toContain('[web](https://x.y)');
    expect(plan.notes.find((n) => n.sourcePath === 'Inbox.md')!.body).toBe('plain\ntext');
  });

  it('warns when nothing to import', async () => {
    const plan = await planImport(entries({ 'a.txt': 'x' }), sha);
    expect(plan.warnings).toContain('Не найдено ни одного .md файла');
  });
});
