import type { Colors } from '../../../ui/theme/tokens';
import { PREVIEW_JS } from './previewBundle.generated';

/**
 * Full preview document. CSP forbids any network access: no remote scripts, styles, fonts,
 * frames or images (only local file: attachments and data: URIs).
 */
export function buildPreviewHtml(c: Colors, scheme: 'light' | 'dark'): string {
  const csp = [
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    'img-src file: data:',
    "connect-src 'none'",
    "frame-src 'none'",
    "form-action 'none'",
  ].join('; ');
  const code = scheme === 'dark'
    ? { kw: '#C792EA', str: '#C3E88D', num: '#F78C6C', com: '#697098', fn: '#82AAFF', type: '#FFCB6B', attr: '#89DDFF' }
    : { kw: '#7C3AED', str: '#15803D', num: '#C2410C', com: '#8A94A6', fn: '#2563EB', type: '#B45309', attr: '#0E7490' };
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<style>
:root{color-scheme:${scheme}}
*{box-sizing:border-box}
html,body{margin:0;background:${c.background};color:${c.text};font:16px/1.6 -apple-system,Roboto,"Segoe UI",sans-serif;-webkit-text-size-adjust:100%;word-wrap:break-word}
#root{padding:4px 16px 120px}
h1,h2,h3,h4,h5,h6{line-height:1.25;margin:1.4em 0 .5em;font-weight:700}
h1{font-size:1.75em;letter-spacing:-.02em}h2{font-size:1.4em}h3{font-size:1.18em}h4{font-size:1.05em}h5,h6{font-size:1em;color:${c.secondary}}
#root>:first-child{margin-top:12px}
p,ul,ol,blockquote,pre,.table-wrap{margin:0 0 1em}
a{color:${c.primary};text-decoration:none;border-bottom:1px solid ${c.primary}55}
blockquote{margin-left:0;padding:.2em 1em;border-left:3px solid ${c.primary};color:${c.secondary};background:${c.surface};border-radius:0 8px 8px 0}
ul,ol{padding-left:1.4em}li{margin:.2em 0}
ul.tasks{list-style:none;padding-left:.2em}ul.tasks ul.tasks{padding-left:1.4em}
li.task{position:relative;padding-left:1.75em}
li>p{margin:0}
blockquote>:last-child{margin-bottom:0}
.task-box{appearance:none;-webkit-appearance:none;position:absolute;left:0;top:.2em;width:20px;height:20px;margin:0;border:2px solid ${c.secondary};border-radius:6px;display:grid;place-content:center}
.task-box:checked{background:${c.primary};border-color:${c.primary}}
.task-box:checked::after{content:"";width:10px;height:6px;border:2px solid ${c.onPrimary};border-top:0;border-right:0;transform:translateY(-1px) rotate(-45deg)}
li.task:has(> .task-box:checked){color:${c.secondary}}
li.task ul,li.task ol{color:${c.text}}
code{font:14px/1.5 ui-monospace,"Roboto Mono",monospace;background:${c.elevated};padding:.1em .35em;border-radius:5px}
pre.code{background:${c.surface};border:1px solid ${c.border};border-radius:12px;padding:12px 14px;overflow-x:auto}
pre.code code{background:none;padding:0;white-space:pre}
hr{border:0;border-top:1px solid ${c.border};margin:1.6em 0}
.table-wrap{overflow-x:auto;border:1px solid ${c.border};border-radius:10px}
table{border-collapse:collapse;min-width:100%;font-size:.94em}
th,td{border-bottom:1px solid ${c.border};padding:8px 12px;text-align:left;vertical-align:top}
th{background:${c.surface};font-weight:600}tr:last-child td{border-bottom:0}
img{max-width:100%;border-radius:10px}
.img-blocked{display:inline-block;padding:2px 8px;border:1px dashed ${c.border};border-radius:6px;color:${c.secondary};font-size:.9em}
.frontmatter{margin:12px 0;color:${c.secondary};font-size:.9em}
.frontmatter pre{background:${c.surface};padding:10px;border-radius:8px;overflow-x:auto}
.empty{color:${c.secondary}}
.hljs-keyword,.hljs-built_in,.hljs-selector-tag{color:${code.kw}}
.hljs-string,.hljs-regexp{color:${code.str}}
.hljs-number,.hljs-literal{color:${code.num}}
.hljs-comment,.hljs-quote{color:${code.com};font-style:italic}
.hljs-title,.hljs-function{color:${code.fn}}
.hljs-type,.hljs-class{color:${code.type}}
.hljs-attr,.hljs-attribute,.hljs-variable,.hljs-meta{color:${code.attr}}
</style></head><body><div id="root"></div>
<script>${PREVIEW_JS.replace(/<\/script/gi, '<\\/script')}</script>
</body></html>`;
}
