import React, { useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';

/**
 * Full-screen live preview for runnable HTML code blocks (and mermaid
 * diagrams). Renders in a sandboxed WebView on native; on web the same inline
 * iframe is used, with an extra button to open it in a browser tab.
 */
export function HtmlPreview({
  visible,
  html,
  onClose,
}: {
  visible: boolean;
  html: string;
  onClose: () => void;
}) {
  const colors = useColors();
  const [reloadKey, setReloadKey] = useState(0);
  const isWeb = Platform.OS === 'web';

  function openInBrowserTab() {
    if (isWeb && typeof window !== 'undefined') {
      const blob = new Blob([html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <Text style={[styles.title, { color: colors.foreground }]}>
            معاينة حية — HTML
          </Text>
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="إعادة تحميل المعاينة"
              onPress={() => setReloadKey((k) => k + 1)}
              style={styles.btn}
            >
              <Feather name="refresh-cw" size={17} color={colors.primary} />
            </Pressable>
            {isWeb ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="فتح في تبويب المتصفح"
                onPress={openInBrowserTab}
                style={styles.btn}
              >
                <Feather name="external-link" size={17} color={colors.primary} />
              </Pressable>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="إغلاق المعاينة"
              onPress={onClose}
              style={styles.btn}
            >
              <Feather name="x" size={20} color={colors.destructive} />
            </Pressable>
          </View>
        </View>
        {isWeb ? (
          <iframe
            key={reloadKey}
            srcDoc={html}
            sandbox="allow-scripts allow-modals"
            style={{
              flex: 1,
              width: '100%',
              border: 'none',
              backgroundColor: '#0d1117',
            }}
          />
        ) : (
          <WebView
            key={reloadKey}
            source={{ html }}
            style={styles.webview}
            originWhitelist={['*']}
            onShouldStartLoadWithRequest={(request) => request.url === 'about:blank'}
            javaScriptEnabled
            javaScriptCanOpenWindowsAutomatically={false}
            setSupportMultipleWindows={false}
            domStorageEnabled={false}
            cacheEnabled={false}
            allowFileAccess={false}
            allowFileAccessFromFileURLs={false}
            allowUniversalAccessFromFileURLs={false}
            mixedContentMode="never"
            startInLoadingState
          />
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 46,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  title: { fontSize: 15, fontWeight: '700' },
  actions: { flexDirection: 'row-reverse', gap: 14 },
  btn: { padding: 4 },
  webview: { flex: 1 },
});
