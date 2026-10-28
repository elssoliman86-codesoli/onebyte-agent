import React, { useRef } from 'react';
import { Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { WebView } from 'react-native-webview';
import { useColors } from '@/hooks/useColors';

/**
 * In-app browser — the "open the platform" surface.
 *
 * Android: a real WebView (the user's sessions/cookies stay local to the
 * device). Web: honest fallback — major sites block iframe embedding, so we
 * open a real browser tab instead. This is a content-preparation browser,
 * not a full HTTPS-interception proxy (that needs a separate network layer).
 */
export default function BrowserScreen() {
  const colors = useColors();
  const params = useLocalSearchParams<{ url?: string | string[] }>();
  const url = (Array.isArray(params.url) ? params.url[0] : params.url) ?? '';
  const isWeb = Platform.OS === 'web';
  const webRef = useRef<React.ComponentRef<typeof WebView> | null>(null);

  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {
    host = url.slice(0, 40);
  }

  if (!url) {
    return (
      <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]}>
        <View style={styles.empty}>
          <Feather name="globe" size={30} color={colors.mutedForeground} />
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            مفيش رابط مفتوح — افتحي المتصفح من استوديو التسويق أو الشات.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.back()}
            style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
          >
            <Text style={[styles.primaryText, { color: colors.foreground }]}>رجوع</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]} edges={['top']}>
      {/* Top bar: back, host, reload, system browser */}
      <View style={[styles.topBar, { borderBottomColor: colors.border }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="رجوع للشاشة السابقة"
          onPress={() => router.back()}
          style={styles.iconBtn}
          hitSlop={6}
        >
          <Feather name="arrow-left" size={20} color={colors.foreground} />
        </Pressable>
        <View style={styles.hostWrap}>
          <Feather name="globe" size={13} color={colors.mutedForeground} />
          <Text style={[styles.host, { color: colors.foreground }]} numberOfLines={1}>
            {host}
          </Text>
        </View>
        {!isWeb ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="إعادة تحميل الصفحة"
            onPress={() => webRef.current?.reload()}
            style={styles.iconBtn}
            hitSlop={6}
          >
            <Feather name="refresh-cw" size={18} color={colors.foreground} />
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="فتح في متصفح النظام"
          onPress={() => void Linking.openURL(url)}
          style={styles.iconBtn}
          hitSlop={6}
        >
          <Feather name="external-link" size={18} color={colors.foreground} />
        </Pressable>
      </View>

      {isWeb ? (
        <View style={styles.empty}>
          <Feather name="monitor" size={28} color={colors.mutedForeground} />
          <Text style={[styles.note, { color: colors.mutedForeground }]}>
            المواقع الكبرى تمنع التضمين داخل iframe — على الويب بنفتح المنصة في تبويب متصفح حقيقي،
            وسيشنك بتفضل على جهازك.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="فتح المنصة في تبويب جديد"
            onPress={() => window.open(url, '_blank')}
            style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
          >
            <Text style={[styles.primaryText, { color: colors.foreground }]}>افتح المنصة الآن</Text>
          </Pressable>
        </View>
      ) : (
        <WebView
          ref={webRef}
          source={{ uri: url }}
          style={styles.webview}
          originWhitelist={['*']}
          javaScriptEnabled
          domStorageEnabled
          startInLoadingState
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  topBar: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  iconBtn: { padding: 4 },
  hostWrap: {
    flex: 1,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
    justifyContent: 'center',
  },
  host: { fontSize: 13, fontWeight: '700', textAlign: 'left' },
  webview: { flex: 1 },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    padding: 28,
  },
  emptyText: { fontSize: 13, textAlign: 'center', lineHeight: 20 },
  note: { fontSize: 13, textAlign: 'center', lineHeight: 21 },
  primaryBtn: {
    borderRadius: 12,
    paddingHorizontal: 18,
    paddingVertical: 11,
  },
  primaryText: { fontSize: 14, fontWeight: '800' },
});
