import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';

/**
 * Full-screen live preview for runnable HTML code blocks. Renders in a sandboxed
 * WebView with a reload control. On web the preview opens in a new browser tab
 * (a Modal there would still need the same iframe, and the app runs on web too,
 * so we use the browser's own renderer).
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

  function openInBrowserTab() {
    if (PlatformWeb()) {
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
            {PlatformWeb() ? (
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
        {PlatformWeb() ? (
          <View style={styles.webFallback}>
            <Feather name="monitor" size={26} color={colors.mutedForeground} />
            <Text style={[styles.fallbackText, { color: colors.mutedForeground }]}>
              افتحي المعاينة في تبويب متصفح جديد من الزر أعلاه.
            </Text>
          </View>
        ) : (
          <WebView
            key={reloadKey}
            source={{ html }}
            style={styles.webview}
            originWhitelist={['*']}
            javaScriptEnabled
            domStorageEnabled
            startInLoadingState
          />
        )}
      </View>
    </Modal>
  );
}

function PlatformWeb(): boolean {
  // Avoid importing react-native Platform again; check via a cheap marker.
  return typeof navigator !== 'undefined' && navigator.product === 'Web';
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
  webFallback: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24 },
  fallbackText: { fontSize: 13, textAlign: 'center' },
});
