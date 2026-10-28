import React, { useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import { useColors } from '@/hooks/useColors';
import { alertCompat } from '@/src/web-alert';
import { useAssistant } from '@/src/assistant';
import { HtmlPreview } from '@/components/HtmlPreview';
import { ScreenTopBar } from '@/components/PhoneDrawer';
import { loadConnections } from '@/src/marketing';
import {
  deleteFile,
  diffLines,
  diffToText,
  fileHistory,
  guessLanguage,
  loadWorkspaceFiles,
  saveWorkspaceFiles,
  upsertFile,
  type WorkspaceFile,
  type WorkspaceVersion,
} from '@/src/project-workspace';
import {
  getRepoTree,
  readFile,
  type GhTreeItem,
} from '@/src/github';
import {
  ActionButton,
  AppScreen,
  EmptyState,
  FormField,
  SectionTitle,
  StatusPill,
  Surface,
} from '@/components/Ui';

/**
 * Developer Lab — an independent project workspace (file tree, editor,
 * version history, live diff) plus sub-agent help through a tagged
 * developer chat. Heavy builds/runs are out of scope for the phone.
 */
export default function DeveloperLabScreen() {
  const colors = useColors();
  const { setPendingPrompt, createSession, patchSession } = useAssistant();
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [openFile, setOpenFile] = useState<WorkspaceFile | null>(null);
  const [editing, setEditing] = useState('');
  const [newPath, setNewPath] = useState('');
  const [repoInput, setRepoInput] = useState('');
  const [busy, setBusy] = useState('');
  const [history, setHistory] = useState<WorkspaceVersion[]>([]);
  const [showDiff, setShowDiff] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      setFiles(await loadWorkspaceFiles());
    })();
  }, []);

  async function refresh() {
    setFiles(await loadWorkspaceFiles());
  }

  async function createFile() {
    const path = newPath.trim();
    if (!path) {
      alertCompat('اسم الملف ناقص', 'مثال: src/app.tsx أو index.html');
      return;
    }
    setBusy('create');
    await upsertFile(path, '');
    setNewPath('');
    await refresh();
    const created = (await loadWorkspaceFiles()).find((f) => f.path === path) ?? null;
    openInEditor(created);
    setBusy('');
  }

  async function importCodeFiles() {
    setBusy('import');
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          'text/*', 'text/markdown', 'text/plain', 'text/csv',
          'application/json', 'application/xml', 'application/javascript',
        ],
        copyToCacheDirectory: true,
        multiple: true,
      });
      if (result.canceled || !result.assets?.length) {
        setBusy('');
        return;
      }
      for (const file of result.assets) {
        if ((file.size ?? 0) > 400_000) continue;
        const content = await (await fetch(file.uri)).text();
        await upsertFile(file.name, content);
      }
      await refresh();
    } finally {
      setBusy('');
    }
  }

  async function importFromGithub() {
    const fullName = repoInput.trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\/+$/, '');
    if (!fullName || !fullName.includes('/')) {
      alertCompat('رابط مستودع ناقص', 'مثال: owner/repo');
      return;
    }
    const token = (await loadConnections()).githubToken ?? '';
    if (!token) {
      alertCompat('محتاج توكن GitHub', 'اتصل بحسابك من شاشة استوديو التسويق (توكن شخصي مجاني) أو استورد ملفات نصية محلية.');
      return;
    }
    setBusy('gh');
    try {
      const { items, branch } = await getRepoTree(token, fullName);
      const textFiles = items
        .filter((i: GhTreeItem) => (i.size ?? 0) <= 200_000 && /\.(js|jsx|ts|tsx|py|html|css|json|md|txt|yml|yaml|xml|sh|sql|java|kt|rb|go|rs|c|cpp|cs|php|dart)$/i.test(i.path))
        .slice(0, 30);
      let count = 0;
      for (const item of textFiles) {
        try {
          const content = await readFile(token, fullName, item.path, branch);
          await upsertFile(item.path, content);
          count += 1;
        } catch {
          // skip unreadable files honestly
        }
      }
      await refresh();
      alertCompat('تم الاستيراد', `اتستورد ${count} ملف نصي من ${fullName} (${branch}).`);
    } catch (error) {
      alertCompat('فشل الاستيراد', error instanceof Error ? error.message : 'خطأ غير معروف.');
    } finally {
      setBusy('');
    }
  }

  async function openInEditor(file: WorkspaceFile | null) {
    setOpenFile(file);
    setEditing(file?.content ?? '');
    setShowDiff(false);
    if (file) setHistory(await fileHistory(file.id));
    else setHistory([]);
  }

  async function saveEdits(contentOverride?: string) {
    if (!openFile) return;
    setBusy('save');
    const content = contentOverride ?? editing;
    await upsertFile(openFile.path, content);
    await refresh();
    const updated = (await loadWorkspaceFiles()).find((f) => f.id === openFile.id) ?? null;
    setOpenFile(updated);
    if (updated) {
      setEditing(updated.content);
      setHistory(await fileHistory(updated.id));
    }
    setBusy('');
  }

  async function restoreVersion(version: WorkspaceVersion) {
    if (!openFile) return;
    setEditing(version.content);
    await saveEdits(version.content);
  }

  function askAgent(prompt: string) {
    if (!openFile) return;
    void (async () => {
      const sessionId = await createSession();
      await patchSession(sessionId, { mode: 'developer' });
      setPendingPrompt(prompt);
      setOpenFile(null);
      router.push('/(tabs)');
    })();
  }

  const isHtmlFile = (openFile?.language ?? '') === 'html' || /^\s*<!DOCTYPE html/i.test(openFile?.content ?? '');

  return (
    <>
      <AppScreen
        title="مختبر المطوّر"
        eyebrow="مساحة عمل مستقلة عن الشات"
        subtitle="شجرة ملفات، تعديل بحفظ الإصدارات، فرق سطري، ومراجعة لايف من الوكيل."
      >
        <ScreenTopBar active="developer" />

        {!openFile ? (
          <>
            <View style={styles.section}>
              <SectionTitle title="إضافة ملفات" />
              <Surface style={styles.card}>
                <View style={styles.rowInput}>
                  <TextInput
                    value={newPath}
                    onChangeText={setNewPath}
                    placeholder="src/app.tsx"
                    placeholderTextColor={colors.mutedForeground}
                    style={[styles.input, { color: colors.foreground, borderColor: colors.border }]}
                  />
                  <ActionButton label="إنشاء" icon="file-plus" onPress={() => void createFile()} disabled={busy === 'create'} />
                </View>
                <View style={styles.rowBtns}>
                  <ActionButton label="استورد ملفات كود" icon="upload" variant="secondary" onPress={() => void importCodeFiles()} disabled={busy === 'import'} />
                </View>
              </Surface>
            </View>

            <View style={styles.section}>
              <SectionTitle title="استيراد من GitHub" />
              <Surface style={styles.card}>
                <FormField
                  label="owner/repo (مستودعك أو عام)"
                  value={repoInput}
                  onChangeText={setRepoInput}
                  placeholder="facebook/react"
                />
                <ActionButton
                  label="استورد الملفات النصية (حتى 30 ملف)"
                  icon="github"
                  onPress={() => void importFromGithub()}
                  disabled={busy === 'gh'}
                />
              </Surface>
            </View>

            <View style={styles.section}>
              <SectionTitle title={`الملفات (${files.length})`} />
              {files.length ? (
                files.map((file) => (
                  <Pressable
                    key={file.id}
                    accessibilityRole="button"
                    onPress={() => void openInEditor(file)}
                    style={[styles.fileRow, { borderColor: colors.border }]}
                  >
                    <Feather name="file-text" size={15} color={colors.primary} />
                    <Text style={[styles.filePath, { color: colors.foreground }]} numberOfLines={1}>
                      {file.path}
                    </Text>
                    <StatusPill label={file.language} tone="neutral" />
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`حذف ${file.path}`}
                      hitSlop={6}
                      onPress={() =>
                        alertCompat('حذف الملف؟', `${file.path} + إصداراته هيتمسحوا.`, [
                          { text: 'إلغاء', style: 'cancel' },
                          {
                            text: 'حذف',
                            style: 'destructive',
                            onPress: () => void deleteFile(file.id).then(refresh),
                          },
                        ])
                      }
                    >
                      <Feather name="trash-2" size={14} color={colors.destructive} />
                    </Pressable>
                  </Pressable>
                ))
              ) : (
                <EmptyState
                  icon="code"
                  title="المساحة فاضية"
                  message="ابدأ بإنشاء ملف، أو استورد ملفات كود، أو اسحب ملفات من مستودع GitHub متصّل."
                />
              )}
            </View>
          </>
        ) : (
          <>
            <Surface style={styles.card}>
              <View style={styles.fileHead}>
                <Pressable accessibilityRole="button" onPress={() => void openInEditor(null)} hitSlop={6}>
                  <Feather name="arrow-left" size={18} color={colors.primary} />
                </Pressable>
                <Text style={[styles.filePath, { color: colors.foreground, flex: 1 }]} numberOfLines={1}>
                  {openFile.path}
                </Text>
                <StatusPill label={openFile.language} tone="neutral" />
              </View>
              <TextInput
                value={editing}
                onChangeText={setEditing}
                multiline
                style={[styles.editor, { color: colors.foreground, borderColor: colors.border }]}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <View style={styles.rowBtns}>
                <ActionButton label="حفظ نسخة" icon="save" onPress={() => void saveEdits()} disabled={busy === 'save'} />
                {isHtmlFile ? (
                  <ActionButton
                    label="معاينة"
                    icon="play-circle"
                    variant="secondary"
                    onPress={() => setPreviewHtml(editing)}
                  />
                ) : null}
              </View>
            </Surface>

            <View style={styles.section}>
              <SectionTitle title="مساعدة الوكيل (Sub-agents)" />
              <Surface style={styles.card}>
                <View style={styles.rowBtns}>
                  <ActionButton
                    label="راجع الملف"
                    icon="check-circle"
                    variant="secondary"
                    onPress={() =>
                      askAgent(
                        `راجع ملف ${openFile.path} من مساحة العمل (المحتوى أدناه) واعطني: أخطاء يجب إصلاحها، تحسينات مقترحة، وملاحظات — مع الموضع الدقيق لكل بند.\n\n\`\`\`${openFile.language}\n${editing.slice(0, 8000)}\n\`\`\``,
                      )
                    }
                  />
                  <ActionButton
                    label="اكتب اختبارات"
                    icon="play"
                    variant="secondary"
                    onPress={() =>
                      askAgent(
                        `اكتب اختبارًا سريعًا لملف ${openFile.path} — أمر تشغيل واحد أو كود اختبار مختصر يثبت صحة العمل.\n\n\`\`\`${openFile.language}\n${editing.slice(0, 6000)}\n\`\`\``,
                      )
                    }
                  />
                </View>
              </Surface>
            </View>

            {history.length > 1 ? (
              <View style={styles.section}>
                <SectionTitle
                  title={`الإصدارات (${history.length})`}
                  trailing={
                    <Pressable accessibilityRole="button" onPress={() => setShowDiff((v) => !v)}>
                      <Text style={{ color: colors.primary, fontSize: 12, fontWeight: '700' }}>
                        {showDiff ? 'إخفاء الفرق' : 'عرض الفرق'}
                      </Text>
                    </Pressable>
                  }
                />
                {showDiff ? (
                  <Surface style={styles.card}>
                    <Text style={[styles.diffText, { color: colors.foreground }]} selectable>
                      {diffToText(
                        diffLines(history[history.length - 2].content, history[history.length - 1].content),
                      )}
                    </Text>
                  </Surface>
                ) : null}
                {history
                  .slice()
                  .reverse()
                  .map((version) => (
                    <Surface key={version.version} style={styles.card}>
                      <View style={styles.postHead}>
                        <Text style={[styles.filePath, { color: colors.foreground, flex: 1 }]} numberOfLines={1}>
                          إصدار {version.version} · {version.note}
                        </Text>
                        <ActionButton
                          label="استعادة"
                          icon="rotate-ccw"
                          variant="quiet"
                          onPress={() => void restoreVersion(version)}
                        />
                      </View>
                      <Text style={[styles.bodyText, { color: colors.mutedForeground }]}>
                        {new Date(version.savedAt).toLocaleString('ar-EG')}
                      </Text>
                    </Surface>
                  ))}
              </View>
            ) : null}
          </>
        )}
      </AppScreen>

      <HtmlPreview visible={previewHtml !== null} html={previewHtml ?? ''} onClose={() => setPreviewHtml(null)} />
    </>
  );
}

const styles = StyleSheet.create({
  card: { gap: 10, padding: 14, borderRadius: 16 },
  section: { marginTop: 18, gap: 10 },
  rowInput: { flexDirection: 'row-reverse', gap: 8, alignItems: 'center' },
  input: { flex: 1, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  rowBtns: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8 },
  fileRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  filePath: { fontSize: 13, fontWeight: '700', textAlign: 'left' },
  fileHead: { flexDirection: 'row-reverse', alignItems: 'center', gap: 9 },
  editor: {
    borderWidth: 1,
    borderRadius: 12,
    minHeight: 260,
    padding: 12,
    fontFamily: 'monospace',
    fontSize: 12.5,
    textAlign: 'left',
    writingDirection: 'ltr',
  },
  diffText: { fontFamily: 'monospace', fontSize: 12, lineHeight: 19, textAlign: 'left', writingDirection: 'ltr' },
  bodyText: { fontSize: 12, textAlign: 'right' },
  postHead: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8 },
});
