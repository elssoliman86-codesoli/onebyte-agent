import React, { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { WebView } from 'react-native-webview';
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
  editable = false,
}: {
  code: string;
  language?: string;
  /** Set for HTML blocks — shows the live-preview button + inline preview. */
  onPreview?: (html: string) => void;
  /** Shows the pencil editor in developer studio chats. */
  editable?: boolean;
}) {
  const colors = useColors();
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const [editedCode, setEditedCode] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [editorVisible, setEditorVisible] = useState(false);
  const displayedCode = editedCode ?? code;
  const isHtml = Boolean(onPreview);
  // Inline live preview: works right inside the block, debounced while the
  // model is still streaming the code so the frame doesn't reload per token.
  const [previewSrc, setPreviewSrc] = useState('');
  const [previewExpanded, setPreviewExpanded] = useState(false);
  const [previewVisible, setPreviewVisible] = useState(true);

  useEffect(() => {
    if (!onPreview) return;
    const timer = setTimeout(() => setPreviewSrc(displayedCode), 400);
    return () => clearTimeout(timer);
  }, [displayedCode, onPreview]);

  async function copy() {
    await Clipboard.setStringAsync(displayedCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  async function download() {
    try {
      const ext = EXT_MAP[(language ?? '').toLowerCase()] ?? 'txt';
      const filename = `onebyte-code-${Date.now()}.${ext}`;
      if (Platform.OS === 'web' && typeof document !== 'undefined') {
        const blob = new Blob([displayedCode], { type: 'text/plain;charset=utf-8' });
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
        await FileSystem.writeAsStringAsync(path, displayedCode, {
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
          {editable ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="تعديل الكود يدويًا"
              onPress={() => {
                setEditDraft(displayedCode);
                setEditorVisible(true);
              }}
              style={styles.copyBtn}
            >
              <Feather name="edit-2" size={13} color={colors.primary} />
              <Text style={[styles.copyText, { color: colors.primary }]}>تعديل</Text>
            </Pressable>
          ) : null}
          {onPreview && !previewVisible ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="إظهار المعاينة المضمنة"
              onPress={() => setPreviewVisible(true)}
              style={styles.copyBtn}
            >
              <Feather name="eye" size={13} color={colors.success} />
              <Text style={[styles.copyText, { color: colors.success }]}>معاينة</Text>
            </Pressable>
          ) : null}
          {onPreview ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="معاينة حية"
              onPress={() => onPreview(displayedCode)}
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
        {displayedCode}
      </Text>
      {onPreview && previewVisible && previewSrc ? (
        <>
          <View style={[styles.previewBox, { height: previewExpanded ? 520 : 240, borderColor: colors.border }]}>
            {Platform.OS === 'web' ? (
              // Sandbox without allow-same-origin: the snippet runs in an
              // opaque origin and cannot touch app storage or cookies.
              <iframe
                srcDoc={previewSrc}
                title="معاينة HTML"
                sandbox="allow-scripts allow-popups allow-modals"
                style={{ width: '100%', height: '100%', border: 'none', backgroundColor: '#FFFFFF' }}
              />
            ) : (
              <WebView
                source={{ html: previewSrc }}
                style={styles.previewFrame}
                originWhitelist={['*']}
                javaScriptEnabled
              />
            )}
          </View>
          <View style={[styles.previewActions, { borderTopColor: colors.border }]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="معاينة حية بملء الشاشة"
              onPress={() => onPreview(displayedCode)}
              style={styles.copyBtn}
            >
              <Feather name="maximize" size={13} color={colors.success} />
              <Text style={[styles.copyText, { color: colors.success }]}>ملء الشاشة</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={previewExpanded ? 'تصغير المعاينة' : 'توسيع المعاينة'}
              onPress={() => setPreviewExpanded((v) => !v)}
              style={styles.copyBtn}
            >
              <Feather
                name={previewExpanded ? 'minimize-2' : 'maximize-2'}
                size={13}
                color={colors.primary}
              />
              <Text style={[styles.copyText, { color: colors.primary }]}>
                {previewExpanded ? 'تصغير' : 'توسيع'}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="إخفاء المعاينة المضمنة"
              onPress={() => setPreviewVisible(false)}
              style={styles.copyBtn}
            >
              <Feather name="eye-off" size={13} color={colors.mutedForeground} />
              <Text style={[styles.copyText, { color: colors.mutedForeground }]}>إخفاء</Text>
            </Pressable>
          </View>
        </>
      ) : null}
      <Modal
        visible={editorVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setEditorVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.editorBackdrop}
        >
          <View style={[styles.editorCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.editorHeader}>
              <Text style={[styles.editorTitle, { color: colors.foreground }]}>
                {'تعديل الكود' + (language ? ' · ' + language : '')}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="إغلاق محرر الكود"
                onPress={() => setEditorVisible(false)}
                hitSlop={8}
              >
                <Feather name="x" size={20} color={colors.mutedForeground} />
              </Pressable>
            </View>
            <TextInput
              value={editDraft}
              onChangeText={setEditDraft}
              multiline
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              textAlignVertical="top"
              style={[styles.editorInput, { color: colors.foreground, borderColor: colors.border }]}
              accessibilityLabel="محتوى الكود قابل للتحرير"
            />
            <View style={styles.editorActions}>
              {onPreview ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    setEditorVisible(false);
                    onPreview(editDraft);
                  }}
                  style={[styles.editorButton, { borderColor: colors.border }]}
                >
                  <Feather name="eye" size={15} color={colors.success} />
                  <Text style={[styles.copyText, { color: colors.success }]}>معاينة</Text>
                </Pressable>
              ) : null}
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setEditedCode(editDraft);
                  setEditorVisible(false);
                }}
                style={[styles.editorButton, { backgroundColor: colors.primary, borderColor: colors.primary }]}
              >
                <Feather name="check" size={15} color={colors.primaryForeground} />
                <Text style={[styles.copyText, { color: colors.primaryForeground }]}>حفظ التعديل</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
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
  previewBox: {
    borderTopWidth: 1,
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
  },
  previewFrame: { flex: 1, backgroundColor: '#FFFFFF' },
  editorBackdrop: {
    flex: 1,
    justifyContent: 'center',
    padding: 18,
    backgroundColor: 'rgba(0,0,0,0.62)',
  },
  editorCard: {
    maxHeight: '92%',
    minHeight: 380,
    borderWidth: 1,
    borderRadius: 20,
    padding: 14,
    gap: 12,
  },
  editorHeader: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between' },
  editorTitle: { fontSize: 15, fontWeight: '700' },
  editorInput: {
    flex: 1,
    minHeight: 240,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    fontFamily: 'monospace',
    fontSize: 12,
    lineHeight: 19,
    textAlign: 'left',
    writingDirection: 'ltr',
  },
  editorActions: { flexDirection: 'row-reverse', justifyContent: 'flex-start', gap: 10 },
  editorButton: {
    minHeight: 38,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderRadius: 12,
  },
  previewActions: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: 'rgba(128,128,128,0.22)',
  },
});
