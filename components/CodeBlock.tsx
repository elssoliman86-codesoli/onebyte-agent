import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';

/**
 * A rendered fenced code block inside a chat message: language label, themed
 * dark editor surface (matching the app palette), and a copy button.
 */
export function CodeBlock({ code, language }: { code: string; language?: string }) {
  const colors = useColors();
  const [copied, setCopied] = useState(false);

  async function copy() {
    await Clipboard.setStringAsync(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <Text style={[styles.lang, { color: colors.mutedForeground }]}>
          {language || 'code'}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="نسخ الكود"
          onPress={() => void copy()}
          style={styles.copyBtn}
        >
          <Feather
            name={copied ? 'check' : 'copy'}
            size={13}
            color={copied ? colors.success : colors.primary}
          />
          <Text style={[styles.copyText, { color: copied ? colors.success : colors.primary }]}>
            {copied ? 'تم النسخ' : 'نسخ'}
          </Text>
        </Pressable>
      </View>
      <Text style={[styles.code, { color: colors.foreground }]} selectable>
        {code}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(128,128,128,0.28)',
    backgroundColor: 'rgba(8,22,16,0.92)',
    marginTop: 8,
    marginBottom: 8,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(128,128,128,0.22)',
  },
  lang: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  copyBtn: { flexDirection: 'row-reverse', alignItems: 'center', gap: 5, padding: 3 },
  copyText: { fontSize: 11, fontWeight: '700' },
  code: {
    fontFamily: 'monospace',
    fontSize: 12.5,
    lineHeight: 19,
    padding: 12,
    textAlign: 'left',
    writingDirection: 'ltr',
  },
});
