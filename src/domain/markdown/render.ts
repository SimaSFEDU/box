/**
 * Markdown → HTML renderer used inside the Preview WebView (bundled by scripts/build-preview.mjs)
 * and directly in unit tests. Security policy:
 *  - raw HTML in Markdown is escaped (html: false) — notes cannot inject scripts;
 *  - only http(s), mailto, tel and relative links are kept (markdown-it validateLink + our check);
 *  - images may only be relative paths to local attachments or data: URIs (no remote tracking pixels);
 *  - every block token carries data-line so the preview can map clicks back to source lines.
 */
import hljs from 'highlight.js/lib/common';
import MarkdownIt, { type MarkdownIt as MD } from 'markdown-it';

import { splitFrontmatter } from './frontmatter';

const SAFE_LINK = /^(https?:|mailto:|tel:|#|\.{0,2}\/?[\w%-])/i;
const LOCAL_IMG = /^(attachments\/[\w.-]+|data:image\/(png|jpe?g|gif|webp);base64,)/i;

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** GFM task lists: `- [ ]` / `- [x]` → checkbox with source line, item gets a class. */
function taskListPlugin(md: MD) {
  md.core.ruler.after('inline', 'clipbox_tasks', (state) => {
    const tokens = state.tokens;
    for (let i = 2; i < tokens.length; i++) {
      const inline = tokens[i]!;
      if (inline.type !== 'inline' || tokens[i - 1]!.type !== 'paragraph_open' || tokens[i - 2]!.type !== 'list_item_open') continue;
      const m = /^\[([ xX])\]\s/.exec(inline.content);
      if (!m) continue;
      const item = tokens[i - 2]!;
      const line = item.map?.[0] ?? -1;
      item.attrJoin('class', 'task');
      const first = inline.children?.[0];
      if (first && first.type === 'text') first.content = first.content.slice(m[0].length);
      const box = new state.Token('html_inline', '', 0);
      box.content = `<input type="checkbox" class="task-box" data-line="${line}"${m[1] !== ' ' ? ' checked' : ''}>`;
      inline.children?.unshift(box);
      // Mark the parent list.
      for (let j = i - 3; j >= 0; j--) {
        const t = tokens[j]!;
        if ((t.type === 'bullet_list_open' || t.type === 'ordered_list_open') && t.level === item.level - 1) {
          if (!String(t.attrGet('class') ?? '').includes('tasks')) t.attrJoin('class', 'tasks');
          break;
        }
      }
    }
  });
}

/** Adds data-line to block-level opening tokens for scroll sync / click mapping. */
function sourceLinePlugin(md: MD) {
  md.core.ruler.push('clipbox_lines', (state) => {
    for (const t of state.tokens) {
      if (t.map && t.nesting === 1) t.attrSet('data-line', String(t.map[0]));
    }
  });
}

export interface RenderOptions {
  /** Shift applied to data-line values (frontmatter lines removed before rendering). */
  lineOffset?: number;
}

export function createRenderer() {
  const md: MD = new MarkdownIt({
    html: false,
    linkify: true,
    typographer: false,
    breaks: false,
    highlight(code: string, lang: string): string {
      const language = lang && hljs.getLanguage(lang) ? lang : null;
      try {
        const html = language ? hljs.highlight(code, { language, ignoreIllegals: true }).value : escapeHtml(code);
        return `<pre class="code"><code class="hljs${language ? ` language-${language}` : ''}">${html}</code></pre>`;
      } catch {
        return `<pre class="code"><code class="hljs">${escapeHtml(code)}</code></pre>`;
      }
    },
  });
  md.use(taskListPlugin).use(sourceLinePlugin);

  md.renderer.rules.link_open = (tokens, idx, opts, _env, self) => {
    const href = String(tokens[idx]!.attrGet('href') ?? '');
    if (!SAFE_LINK.test(href)) tokens[idx]!.attrSet('href', '#');
    return self.renderToken(tokens, idx, opts);
  };
  md.renderer.rules.image = (tokens, idx) => {
    const t = tokens[idx]!;
    const src = String(t.attrGet('src') ?? '');
    const alt = escapeHtml(t.content);
    if (!LOCAL_IMG.test(src)) {
      return `<span class="img-blocked" title="${escapeHtml(src)}">🖼 ${alt || 'внешнее изображение'}</span>`;
    }
    return `<img src="${escapeHtml(src)}" alt="${alt}" loading="lazy">`;
  };
  // Tables scroll horizontally on phones.
  md.renderer.rules.table_open = (tokens, idx, opts, _env, self) => '<div class="table-wrap">' + self.renderToken(tokens, idx, opts);
  md.renderer.rules.table_close = (tokens, idx, opts, _env, self) => self.renderToken(tokens, idx, opts) + '</div>';

  return {
    render(source: string, options: RenderOptions = {}): string {
      const { frontmatter, body } = splitFrontmatter(source);
      const offset = (options.lineOffset ?? 0) + (frontmatter !== null ? frontmatter.split('\n').length + 2 : 0);
      let html = md.render(body);
      if (offset) html = html.replace(/data-line="(-?\d+)"/g, (_, n: string) => `data-line="${Number(n) + offset}"`);
      if (frontmatter !== null) {
        html = `<details class="frontmatter"><summary>Properties</summary><pre>${escapeHtml(frontmatter)}</pre></details>` + html;
      }
      return html;
    },
  };
}
