/**
 * Runs INSIDE the Preview WebView (bundled to an IIFE string by scripts/build-preview.mjs).
 * Protocol:
 *   RN → WebView: window.clipboxRender(markdown)
 *   WebView → RN: {type:'ready'} | {type:'toggleTask', line} | {type:'openLink', href} | {type:'height', value}
 */
import { createRenderer } from '../../../domain/markdown/render';

declare global {
  interface Window {
    ReactNativeWebView?: { postMessage(msg: string): void };
    clipboxRender?: (md: string) => void;
  }
}

const renderer = createRenderer();
const post = (msg: object) => window.ReactNativeWebView?.postMessage(JSON.stringify(msg));

window.clipboxRender = (md: string) => {
  const root = document.getElementById('root');
  if (!root) return;
  root.innerHTML = md.trim() ? renderer.render(md) : '<p class="empty">Пустая заметка</p>';
};

document.addEventListener('click', (e) => {
  const target = e.target as HTMLElement | null;
  if (!target) return;
  if (target instanceof HTMLInputElement && target.classList.contains('task-box')) {
    e.preventDefault();
    const line = Number(target.dataset.line);
    if (Number.isInteger(line) && line >= 0) post({ type: 'toggleTask', line });
    return;
  }
  const a = target.closest('a');
  if (a) {
    e.preventDefault();
    const href = a.getAttribute('href') ?? '';
    if (href && href !== '#') post({ type: 'openLink', href });
  }
});

post({ type: 'ready' });
