import React, { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';

const EXT_MAP: Record<string, string> = {
  python: 'py', javascript: 'js', js: 'js', typescript: 'ts', ts: 'ts',
  tsx: 'tsx', jsx: 'jsx', json: 'json', html: 'html', css: 'css',
  sql: 'sql', java: 'java', kotlin: 'kt', swift: 'swift', c: 'c',
  cpp: 'cpp', csharp: 'cs', php: 'php', ruby: 'rb', go: 'go', rust: 'rs',
  bash: 'sh', shell: 'sh', sh: 'sh', yaml: 'yml', xml: 'xml',
  markdown: 'md', md: 'md', mermaid: 'mmd', dart: 'dart',
};

/**
 * A rendered fenced code block inside a chat message: language label, themed
 * dark editor surface (matching the app palette), a copy button, and a
 * download button that saves the snippet as a real file on the device.
 */
export function CodeBlock({
  code,
  language,
  onPreview,
}: {
  code: string;
  language?: string;
  /** Set for HTML blocks — shows the live-preview button. */
  onPreview?: (html: string) => void;
}) {
  const colors = useColors();
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);

  async function copy() {
    await Clipboard.setStringAsync(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  async function download() {
    try {
      const ext = EXT_MAP[(language ?? '').toLowerCase()] ?? 'txt';
      const filename = `onebyte-code-${Date.now()}.${ext}`;
      if (Platform.OS === 'web' && typeof document !== 'undefined') {
        const blob = new Blob([code], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      } else {
        const path = (FileSystem.cacheDirectory ?? '') + filename;
        await FileSystem.writeAsStringAsync(path, code, {
          encoding: FileSystem.EncodingType.UTF8,
        });
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(path, {
            mimeType: 'text/plain',
            dialogTitle: 'حفظ الملف على الجهاز',
          });
        }
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 1600);
    } catch {
      setSaved(false);
    }
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <Text style={[styles.lang, { color: colors.mutedForeground }]}>
          {language || 'code'}
        </Text>
        <View style={styles.headerActions}>
          {onPreview ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="معاينة حية"
              onPress={() => onPreview(code)}
              style={styles.copyBtn}
            >
              <Feather name="play-circle" size={13} color={colors.success} />
              <Text style={[styles.copyText, { color: colors.success }]}>معاينة</Text>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="تحميل الكود كملف"
            onPress={() => void download()}
            style={styles.copyBtn}
          >
            <Feather
              name={saved ? 'check' : 'download'}
              size={13}
              color={saved ? colors.success : colors.primary}
            />
            <Text style={[styles.copyText, { color: saved ? colors.success : colors.primary }]}>
              {saved ? 'تم' : 'تحميل'}
            </Text>
          </Pressable>
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
  headerActions: { flexDirection: 'row-reverse', alignItems: 'center', gap: 12 },
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
