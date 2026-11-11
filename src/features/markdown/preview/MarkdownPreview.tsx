import { Paths } from 'expo-file-system';
import * as Linking from 'expo-linking';
import { useEffect, useMemo, useRef, useState } from 'react';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { createLogger } from '../../../core/logger';
import { useTheme } from '../../../ui/theme/ThemeProvider';
import { buildPreviewHtml } from './previewHtml';

const log = createLogger('preview');

// react-native-webview 14 declares `WebView<P = undefined>` with props `WebViewProps & P`,
// which collapses to `never` under strict TS; instantiate with an empty props extension.
const WebViewView = WebView<object>;
type WebViewRef = InstanceType<typeof WebViewView>;

type Msg = { type: 'ready' } | { type: 'toggleTask'; line: number } | { type: 'openLink'; href: string };

export interface MarkdownPreviewProps {
  markdown: string;
  onToggleTask?: (line: number) => void;
}

/** Offline Markdown preview. The WebView never navigates; links open in the system browser. */
export function MarkdownPreview({ markdown, onToggleTask }: MarkdownPreviewProps) {
  const { colors, scheme } = useTheme();
  const ref = useRef<WebViewRef>(null);
  const [ready, setReady] = useState(false);
  const html = useMemo(() => buildPreviewHtml(colors, scheme), [colors, scheme]);

  useEffect(() => {
    if (!ready) return;
    ref.current?.injectJavaScript(`window.clipboxRender(${JSON.stringify(markdown)});true;`);
  }, [markdown, ready]);

  const onMessage = (e: WebViewMessageEvent) => {
    let msg: Msg;
    try {
      msg = JSON.parse(e.nativeEvent.data) as Msg;
    } catch {
      return;
    }
    if (msg.type === 'ready') setReady(true);
    else if (msg.type === 'toggleTask') onToggleTask?.(msg.line);
    else if (msg.type === 'openLink' && /^(https?:|mailto:|tel:)/i.test(msg.href)) {
      Linking.openURL(msg.href).catch((err) => log.warn('openURL failed', err));
    }
  };

  return (
    <WebViewView
      ref={ref}
      key={scheme}
      originWhitelist={['file://*']}
      source={{ html, baseUrl: Paths.document.uri }}
      onMessage={onMessage}
      onLoadStart={() => setReady(false)}
      onShouldStartLoadWithRequest={(req) => req.url.startsWith(Paths.document.uri) || req.url === 'about:blank'}
      javaScriptEnabled
      allowFileAccess
      allowFileAccessFromFileURLs={false}
      allowUniversalAccessFromFileURLs={false}
      setSupportMultipleWindows={false}
      cacheEnabled={false}
      incognito
      overScrollMode="never"
      style={{ flex: 1, backgroundColor: colors.background }}
      accessibilityLabel="Предпросмотр заметки"
    />
  );
}
