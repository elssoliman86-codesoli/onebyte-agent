import React, { useEffect, useRef, useState } from 'react';
import {
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { WebView } from 'react-native-webview';
import { useColors } from '@/hooks/useColors';
import { alertCompat } from '@/src/web-alert';

export default function BrowserScreen() {
  const colors = useColors();
  const params = useLocalSearchParams<{ url?: string | string[] }>();
  const initialUrl = (Array.isArray(params.url) ? params.url[0] : params.url) ?? '';
  const [address, setAddress] = useState(initialUrl);
  const [url, setUrl] = useState(initialUrl);
  const isWeb = Platform.OS === 'web';
  const webRef = useRef<React.ComponentRef<typeof WebView> | null>(null);

  useEffect(() => {
    setAddress(initialUrl);
    setUrl(initialUrl);
  }, [initialUrl]);

  let host = '';
  try {
    host = url ? new URL(url).hostname : '';
  } catch {
    host = '';
  }

  function navigate() {
    const value = address.trim();
    if (!value) return;
    const candidate = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    try {
      const parsed = new URL(candidate);
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
        throw new Error('رابط غير مسموح');
      }
      const cleanUrl = parsed.toString();
      setAddress(cleanUrl);
      setUrl(cleanUrl);
    } catch {
      alertCompat('الرابط غير صالح', 'اكتبي رابطًا يبدأ بـ https:// أو http://');
    }
  }

  function openOutside() {
    if (!url) return;
    if (isWeb && typeof window !== 'undefined') {
      window.open(url, '_blank', 'noopener,noreferrer');
      return;
    }
    void Linking.openURL(url);
  }

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={[styles.topBar, { borderBottomColor: colors.border }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="رجوع للشات"
          onPress={() => router.back()}
          style={styles.iconBtn}
          hitSlop={6}
        >
          <Feather name="arrow-left" size={20} color={colors.foreground} />
        </Pressable>
        <View style={[styles.addressWrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Feather name="lock" size={13} color={colors.mutedForeground} />
          <TextInput
            value={address}
            onChangeText={setAddress}
            onSubmitEditing={navigate}
            placeholder="اكتبي رابط الصفحة"
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="go"
            style={[styles.addressInput, { color: colors.foreground }]}
            accessibilityLabel="رابط الصفحة"
          />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="افتح الرابط"
          onPress={navigate}
          style={[styles.goBtn, { backgroundColor: colors.primary }]}
          hitSlop={6}
        >
          <Feather name="arrow-up-left" size={18} color={colors.primaryForeground} />
        </Pressable>
        {!isWeb && url ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="إعادة تحميل الصفحة"
            onPress={() => webRef.current?.reload()}
            style={styles.iconBtn}
            hitSlop={6}
          >
            <Feather name="refresh-cw" size={17} color={colors.foreground} />
          </Pressable>
        ) : null}
        {url ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="فتح في متصفح النظام"
            onPress={openOutside}
            style={styles.iconBtn}
            hitSlop={6}
          >
            <Feather name="external-link" size={17} color={colors.foreground} />
          </Pressable>
        ) : null}
      </View>

      {url && !isWeb ? (
        <WebView
          ref={webRef}
          source={{ uri: url }}
          style={styles.webview}
          originWhitelist={['http://*', 'https://*']}
          javaScriptEnabled
          domStorageEnabled
          startInLoadingState
          onShouldStartLoadWithRequest={(request) => /^https?:\/\//i.test(request.url)}
          onNavigationStateChange={(state) => {
            setAddress(state.url);
            setUrl(state.url);
          }}
        />
      ) : (
        <View style={styles.empty}>
          <Feather name={url ? 'monitor' : 'globe'} size={30} color={colors.mutedForeground} />
          <Text style={[styles.host, { color: colors.foreground }]} numberOfLines={1}>
            {host || 'المتصفح الخاص'}
          </Text>
          <Text style={[styles.note, { color: colors.mutedForeground }]}>
            {url
              ? 'المواقع قد تمنع العرض داخل متصفح الويب. افتحي الرابط في متصفح الجهاز، أو أرسليه في الشات لقراءته وتحليله.'
              : 'اكتبي رابط الصفحة لفتحها. لقراءة المصدر ومناقشته، ارسلي الرابط في الشات.'}
          </Text>
          {url ? (
            <Pressable
              accessibilityRole="button"
              onPress={openOutside}
              style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
            >
              <Text style={[styles.primaryText, { color: colors.primaryForeground }]}>افتح الصفحة</Text>
            </Pressable>
          ) : (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.back()}
              style={[styles.primaryBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <Text style={[styles.primaryText, { color: colors.foreground }]}>العودة للشات</Text>
            </Pressable>
          )}
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  topBar: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderBottomWidth: 1,
  },
  iconBtn: { padding: 4 },
  addressWrap: {
    flex: 1,
    minWidth: 0,
    height: 38,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 10,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
  },
  addressInput: { flex: 1, minWidth: 0, fontSize: 13, textAlign: 'left' },
  goBtn: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  webview: { flex: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 26 },
  host: { maxWidth: '100%', fontSize: 15, fontWeight: '700', textAlign: 'center' },
  note: { fontSize: 13, lineHeight: 21, textAlign: 'center' },
  primaryBtn: { borderRadius: 12, borderWidth: 1, paddingHorizontal: 18, paddingVertical: 11, marginTop: 4 },
  primaryText: { fontSize: 14, fontWeight: '700' },
});
