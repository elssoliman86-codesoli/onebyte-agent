import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenTopBar } from '@/components/PhoneDrawer';
import { useColors } from '@/hooks/useColors';
import {
  deleteGithubToken, getRepoTree, listRepos, loadGithubToken, MAX_GITHUB_TEXT_FILE_BYTES,
  readFileSnapshot, saveGithubToken, verifyGithubToken, writeFile, type GhRepo, type GhTreeItem,
} from '@/src/github';

const EDITABLE_EXTENSIONS = new Set([
  'md', 'mdx', 'txt', 'json', 'jsonc', 'yaml', 'yml', 'toml', 'ini', 'js', 'jsx',
  'mjs', 'cjs', 'ts', 'tsx', 'html', 'htm', 'css', 'scss', 'py', 'sh', 'bash',
  'ps1', 'bat', 'cmd', 'xml', 'svg', 'kt', 'java', 'gradle', 'properties', 'sql',
  'go', 'rs', 'c', 'h', 'cpp', 'hpp', 'cs', 'php', 'rb', 'swift', 'dart', 'vue',
  'svelte', 'graphql', 'gitignore', 'dockerignore', 'editorconfig',
]);

function isEditableFile(file: GhTreeItem): boolean {
  if (file.type !== 'blob' || (file.size ?? 0) > MAX_GITHUB_TEXT_FILE_BYTES) return false;
  const name = file.path.split('/').pop()?.toLowerCase() ?? '';
  if (name === '.env' || (name.startsWith('.env.') && !name.endsWith('.example')) ||
      name.endsWith('.pem') || name.endsWith('.key') || name.endsWith('.p12') || name.endsWith('.pfx')) return false;
  if (['dockerfile', 'makefile', 'license', 'procfile', '.env.example'].includes(name)) return true;
  const extension = name.includes('.') ? name.split('.').pop() ?? '' : '';
  return EDITABLE_EXTENSIONS.has(extension);
}

type Tone = 'info' | 'success' | 'error';

export default function GithubProjectsScreen() {
  const colors = useColors();
  const [token, setToken] = useState('');
  const [tokenDraft, setTokenDraft] = useState('');
  const [account, setAccount] = useState('');
  const [editingToken, setEditingToken] = useState(false);
  const [repos, setRepos] = useState<GhRepo[]>([]);
  const [repoQuery, setRepoQuery] = useState('');
  const [selectedRepo, setSelectedRepo] = useState<GhRepo | null>(null);
  const [files, setFiles] = useState<GhTreeItem[]>([]);
  const [treeTruncated, setTreeTruncated] = useState(false);
  const [fileQuery, setFileQuery] = useState('');
  const [selectedPath, setSelectedPath] = useState('');
  const [fileSha, setFileSha] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [draftContent, setDraftContent] = useState('');
  const [commitMessage, setCommitMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('اربط GitHub لعرض مستودعاتك وتحرير ملفاتها.');
  const [tone, setTone] = useState<Tone>('info');
  const [commitUrl, setCommitUrl] = useState('');
  const [ready, setReady] = useState(false);

  const dirty = Boolean(selectedPath) && draftContent !== originalContent;
  const shownRepos = useMemo(
    () => repos.filter((repo) => repo.full_name.toLowerCase().includes(repoQuery.trim().toLowerCase())),
    [repos, repoQuery],
  );
  const shownFiles = useMemo(
    () => files.filter(isEditableFile)
      .filter((file) => file.path.toLowerCase().includes(fileQuery.trim().toLowerCase()))
      .slice(0, 500),
    [files, fileQuery],
  );

  const say = useCallback((text: string, nextTone: Tone = 'info') => {
    setStatus(text);
    setTone(nextTone);
  }, []);

  const connect = useCallback(async (candidate: string, save: boolean) => {
    const clean = candidate.trim();
    if (!clean) { say('أدخل توكن GitHub أولًا.', 'error'); return; }
    setBusy(true);
    say('جاري التحقق من التوكن وتحميل المستودعات…');
    try {
      const profile = await verifyGithubToken(clean);
      if (save) await saveGithubToken(clean);
      setToken(clean);
      setAccount(profile.login);
      setEditingToken(false);
      const loaded = await listRepos(clean);
      setRepos(loaded);
      say('اتصلنا بحساب @' + profile.login + ' — تم تحميل ' + loaded.length + ' مستودعًا.', 'success');
    } catch (error) {
      say(error instanceof Error ? error.message : 'تعذّر الاتصال بـGitHub.', 'error');
    } finally {
      setBusy(false);
      setReady(true);
    }
  }, [say]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const saved = await loadGithubToken();
        if (!alive) return;
        if (saved) {
          setToken(saved);
          await connect(saved, false);
        } else {
          setReady(true);
        }
      } catch {
        if (alive) { setReady(true); say('تعذّرت قراءة التوكن المحفوظ. أدخله من جديد.', 'error'); }
      }
    })();
    return () => { alive = false; };
  }, [connect, say]);

  const openRepo = useCallback(async (repo: GhRepo) => {
    if (dirty) { say('فيه تعديلات غير محفوظة. احفظها أو اضغط «تراجع» قبل تبديل المستودع.', 'error'); return; }
    if (!token) { say('اتصل بـGitHub أولًا.', 'error'); return; }
    setBusy(true);
    setSelectedRepo(repo);
    setSelectedPath('');
    setFileSha('');
    setFiles([]);
    setFileQuery('');
    setCommitUrl('');
    say('جاري تحميل ملفات ' + repo.full_name + '…');
    try {
      const tree = await getRepoTree(token, repo.full_name, repo.default_branch || 'main');
      setFiles(tree.items);
      setTreeTruncated(tree.truncated);
      say('تم تحميل ' + tree.items.length + ' ملفًا من ' + tree.branch + '.', 'success');
    } catch (error) {
      say(error instanceof Error ? error.message : 'تعذّر تحميل ملفات المستودع.', 'error');
    } finally { setBusy(false); }
  }, [dirty, say, token]);

  const openFile = useCallback(async (file: GhTreeItem, force = false) => {
    if (!selectedRepo || !token) return;
    if (dirty && !force) { say('احفظ التعديلات الحالية أو اضغط «تراجع» قبل فتح ملف آخر.', 'error'); return; }
    setBusy(true);
    say('جاري فتح ' + file.path + '…');
    try {
      const snapshot = await readFileSnapshot(token, selectedRepo.full_name, file.path, selectedRepo.default_branch || 'main');
      setSelectedPath(file.path);
      setFileSha(snapshot.sha);
      setOriginalContent(snapshot.content);
      setDraftContent(snapshot.content);
      setCommitMessage('Update ' + file.path + ' via OneByte Agent');
      setCommitUrl('');
      say('تم فتح الملف من الفرع ' + selectedRepo.default_branch + '.', 'success');
    } catch (error) {
      say(error instanceof Error ? error.message : 'تعذّر فتح الملف.', 'error');
    } finally { setBusy(false); }
  }, [dirty, say, selectedRepo, token]);

  const commitFile = useCallback(async () => {
    if (!selectedRepo || !selectedPath || !fileSha || !token) { say('افتح ملفًا من المستودع قبل الحفظ.', 'error'); return; }
    if (!dirty) { say('مفيش تغييرات جديدة للحفظ.'); return; }
    setBusy(true);
    setCommitUrl('');
    say('جاري مراجعة الملف وإنشاء commit…');
    try {
      const result = await writeFile(
        token, selectedRepo.full_name, selectedPath, draftContent, commitMessage,
        selectedRepo.default_branch || 'main', fileSha,
      );
      setOriginalContent(draftContent);
      if (result.commitUrl) setCommitUrl(result.commitUrl);
      try {
        const snapshot = await readFileSnapshot(token, selectedRepo.full_name, selectedPath, selectedRepo.default_branch || 'main');
        setFileSha(snapshot.sha);
        setOriginalContent(snapshot.content);
        setDraftContent(snapshot.content);
      } catch {
        // The commit has succeeded; an old SHA will be rejected if the user attempts another save.
      }
      say('تم إنشاء commit في الفرع ' + (selectedRepo.default_branch || 'main') + '.', 'success');
    } catch (error) {
      say(error instanceof Error ? error.message : 'تعذّر حفظ التغييرات.', 'error');
    } finally { setBusy(false); }
  }, [commitMessage, draftContent, dirty, fileSha, say, selectedPath, selectedRepo, token]);

  async function disconnect() {
    setBusy(true);
    try {
      await deleteGithubToken();
      setToken('');
      setTokenDraft('');
      setAccount('');
      setRepos([]);
      setFiles([]);
      setSelectedRepo(null);
      setSelectedPath('');
      setFileSha('');
      setOriginalContent('');
      setDraftContent('');
      setCommitUrl('');
      setEditingToken(false);
      say('تم فصل GitHub ومسح التوكن المحفوظ بواسطة OneByte Agent.', 'success');
    } catch (error) {
      say(error instanceof Error ? error.message : 'تعذّر فصل GitHub.', 'error');
    } finally { setBusy(false); }
  }

  const fg = colors.foreground;
  const muted = colors.mutedForeground;
  const accent = colors.primary;

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]}>
      <ScreenTopBar active="github" />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.heading}>
          <View style={[styles.logo, { borderColor: colors.border, backgroundColor: colors.accentSubtle }]}>
            <Feather name="github" size={25} color={accent} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[styles.title, { color: fg }]}>GitHub Projects</Text>
            <Text style={[styles.subtitle, { color: muted }]}>افتح مستودعاتك، عدّل الملفات، ثم راجع رسالة الـcommit قبل الحفظ.</Text>
          </View>
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.rowBetween}>
            <Text style={[styles.cardTitle, { color: fg }]}>اتصال GitHub</Text>
            {token ? <Text style={[styles.connected, { color: accent }]}>● متصل · @{account || 'GitHub'}</Text> : null}
          </View>
          {!token || editingToken ? (
            <>
              <Text style={[styles.help, { color: muted }]}>
                استخدم Fine-grained Personal Access Token مع Metadata: read-only وContents: read and write، وقيّد الوصول للمستودعات التي تختارها.
              </Text>
              <TextInput
                value={tokenDraft}
                onChangeText={setTokenDraft}
                placeholder="github_pat_…"
                placeholderTextColor={muted}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                style={[styles.input, { color: fg, backgroundColor: colors.background, borderColor: colors.border }]}
              />
              <View style={styles.buttonRow}>
                <Action label={busy ? 'جاري الاتصال…' : 'اتصال وتحميل المستودعات'} icon="link" primary disabled={busy || !tokenDraft.trim()} onPress={() => void connect(tokenDraft, true)} />
                {token && editingToken ? <Action label="إلغاء" icon="x" disabled={busy} onPress={() => setEditingToken(false)} /> : null}
              </View>
              <Text style={[styles.help, { color: muted }]}>
                {Platform.OS === 'web'
                  ? 'في المتصفح، التوكن محفوظ في sessionStorage لهذا التبويب فقط، وليس في التخزين الدائم.'
                  : 'على Android، التوكن محفوظ في مخزن النظام الآمن. لا تشاركه ولا تضعه في الشات.'}
              </Text>
            </>
          ) : (
            <View style={styles.buttonRow}>
              <Action label="تحديث المستودعات" icon="refresh-cw" disabled={busy} onPress={() => void connect(token, false)} />
              <Action label="تغيير التوكن" icon="key" disabled={busy} onPress={() => { setTokenDraft(''); setEditingToken(true); }} />
              <Action label="فصل GitHub" icon="log-out" danger disabled={busy} onPress={() => void disconnect()} />
            </View>
          )}
        </View>

        {token ? (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.rowBetween}>
              <Text style={[styles.cardTitle, { color: fg }]}>مستودعاتك</Text>
              <Text style={[styles.help, { color: muted }]}>{shownRepos.length} / {repos.length}</Text>
            </View>
            <TextInput value={repoQuery} onChangeText={setRepoQuery} placeholder="ابحث باسم المستودع…" placeholderTextColor={muted} style={[styles.input, { color: fg, backgroundColor: colors.background, borderColor: colors.border }]} />
            <View style={styles.listBox}>
              {shownRepos.length ? shownRepos.map((repo) => (
                <Pressable key={repo.full_name} disabled={busy} onPress={() => void openRepo(repo)}
                  style={[styles.repoRow, { borderBottomColor: colors.border }, selectedRepo?.full_name === repo.full_name ? { backgroundColor: colors.accentSubtle } : null]}>
                  <Feather name={repo.private ? 'lock' : 'book-open'} size={16} color={selectedRepo?.full_name === repo.full_name ? accent : muted} />
                  <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                    <Text style={[styles.repoName, { color: fg }]} numberOfLines={1}>{repo.full_name}</Text>
                    <Text style={[styles.help, { color: muted }]} numberOfLines={1}>{repo.description || 'بدون وصف'} · {repo.default_branch || 'default branch'}</Text>
                  </View>
                  {selectedRepo?.full_name === repo.full_name ? <Feather name="check-circle" size={16} color={accent} /> : <Feather name="chevron-left" size={16} color={muted} />}
                </Pressable>
              )) : <Text style={[styles.empty, { color: muted }]}>{repos.length ? 'لا توجد نتائج مطابقة.' : 'لا توجد مستودعات محمّلة؛ اضغط تحديث المستودعات.'}</Text>}
            </View>
          </View>
        ) : null}

        {selectedRepo && token ? (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.rowBetween}>
              <View style={styles.row}>
                <Feather name="git-branch" size={16} color={accent} />
                <Text style={[styles.cardTitle, { color: fg }]}>{selectedRepo.full_name}</Text>
              </View>
              <Text style={[styles.help, { color: muted }]}>{selectedRepo.default_branch}</Text>
            </View>
            <TextInput value={fileQuery} onChangeText={setFileQuery} placeholder="ابحث في ملفات المشروع…" placeholderTextColor={muted} style={[styles.input, { color: fg, backgroundColor: colors.background, borderColor: colors.border }]} />
            <View style={styles.listBox}>
              {shownFiles.length ? shownFiles.map((file) => (
                <Pressable key={file.path} disabled={busy} onPress={() => void openFile(file)}
                  style={[styles.fileRow, { borderBottomColor: colors.border }, selectedPath === file.path ? { backgroundColor: colors.accentSubtle } : null]}>
                  <Feather name="code" size={14} color={selectedPath === file.path ? accent : muted} />
                  <Text style={[styles.fileName, { color: fg }]} numberOfLines={1}>{file.path}</Text>
                  <Text style={[styles.help, { color: muted }]}>{formatBytes(file.size ?? 0)}</Text>
                </Pressable>
              )) : <Text style={[styles.empty, { color: muted }]}>لا توجد ملفات نصية قابلة للتحرير ضمن الحجم المدعوم.</Text>}
            </View>
            {treeTruncated ? <Text style={[styles.help, { color: muted }]}>المستودع كبير؛ GitHub أعاد جزءًا فقط من قائمة الملفات.</Text> : null}
          </View>
        ) : null}

        {selectedRepo && selectedPath ? (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.rowBetween}>
              <Text style={[styles.cardTitle, { color: fg }]}>{selectedPath}</Text>
              <Text style={[styles.help, { color: dirty ? '#F59E0B' : accent }]}>{dirty ? '● تعديلات غير محفوظة' : '● متزامن'}</Text>
            </View>
            <TextInput
              value={draftContent}
              onChangeText={setDraftContent}
              multiline
              spellCheck={false}
              autoCapitalize="none"
              autoCorrect={false}
              textAlignVertical="top"
              style={[styles.editor, { color: fg, backgroundColor: colors.background, borderColor: colors.border }]}
            />
            <TextInput value={commitMessage} onChangeText={setCommitMessage} placeholder="رسالة الـcommit" placeholderTextColor={muted} style={[styles.input, { color: fg, backgroundColor: colors.background, borderColor: colors.border }]} />
            <Text style={[styles.help, { color: muted }]}>الحفظ ينشئ commit مباشرًا على الفرع {selectedRepo.default_branch || 'main'}. راجع التغييرات والرسالة قبل الضغط.</Text>
            <View style={styles.buttonRow}>
              <Action label={busy ? 'جاري الحفظ…' : 'حفظ كـ Commit'} icon="git-commit" primary disabled={busy || !dirty} onPress={() => void commitFile()} />
              <Action label="تراجع" icon="rotate-ccw" disabled={busy || !dirty} onPress={() => { setDraftContent(originalContent); say('تم التراجع عن التغييرات المحلية.'); }} />
              <Action label="إعادة تحميل" icon="refresh-cw" disabled={busy || dirty} onPress={() => { const file=files.find((f)=>f.path===selectedPath); if(file) void openFile(file,true); }} />
              <Action label="إغلاق الملف" icon="x" disabled={busy || dirty} onPress={() => { setSelectedPath(''); setFileSha(''); setDraftContent(''); setOriginalContent(''); }} />
            </View>
            {commitUrl ? <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(commitUrl)} style={styles.commitLink}><Feather name="external-link" size={15} color={accent} /><Text style={[styles.commitText, { color: accent }]}>فتح الـcommit على GitHub</Text></Pressable> : null}
          </View>
        ) : null}

        {busy ? <View style={styles.row}><ActivityIndicator color={accent} /><Text style={[styles.help, { color: muted }]}>جاري تنفيذ الطلب…</Text></View> : null}
        {status ? (
          <View style={[styles.status, { borderColor: tone === 'success' ? colors.primary : tone === 'error' ? colors.destructive : colors.border }]}>
            <Feather name={tone === 'success' ? 'check-circle' : tone === 'error' ? 'alert-circle' : 'info'} size={16} color={tone === 'success' ? accent : tone === 'error' ? colors.destructive : muted} />
            <Text style={[styles.statusText, { color: tone === 'error' ? colors.destructive : fg }]}>{status}</Text>
          </View>
        ) : null}
        {!ready && !busy ? <Text style={[styles.help, { color: muted }]}>جاري قراءة اتصال GitHub المحفوظ…</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function formatBytes(bytes: number): string {
  return bytes < 1024 ? bytes + ' B' : (bytes / 1024).toFixed(1) + ' KB';
}

function Action({
  label, icon, onPress, disabled = false, primary = false, danger = false,
}: {
  label: string;
  icon: React.ComponentProps<typeof Feather>['name'];
  onPress: () => void;
  disabled?: boolean;
  primary?: boolean;
  danger?: boolean;
}) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.action,
        {
          borderColor: danger ? colors.destructive : primary ? colors.primary : colors.border,
          backgroundColor: primary ? colors.primary : colors.card,
          opacity: disabled ? 0.5 : 1,
        },
      ]}
    >
      <Feather name={icon} size={14} color={primary ? colors.primaryForeground : danger ? colors.destructive : colors.foreground} />
      <Text style={[styles.actionText, { color: primary ? colors.primaryForeground : danger ? colors.destructive : colors.foreground }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0 },
  content: { padding: 18, gap: 14, paddingBottom: 48, flexGrow: 1, maxWidth: 1400, width: '100%', alignSelf: 'center' },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 4 },
  logo: { width: 54, height: 54, borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 24, lineHeight: 30, fontWeight: '800' },
  subtitle: { fontSize: 13, lineHeight: 19 },
  card: { padding: 15, borderRadius: 16, borderWidth: 1, gap: 11 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' },
  cardTitle: { fontSize: 14, fontWeight: '700', flexShrink: 1 },
  connected: { fontSize: 11, fontWeight: '700' },
  help: { fontSize: 12, lineHeight: 19 },
  input: { minHeight: 42, borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 9, fontSize: 13, textAlign: 'left' },
  buttonRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  action: { minHeight: 39, borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 9, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 7 },
  actionText: { fontSize: 12, fontWeight: '700' },
  listBox: { maxHeight: 310, borderWidth: 1, borderColor: 'rgba(127,127,127,.18)', borderRadius: 10, overflow: 'hidden' },
  repoRow: { minHeight: 50, paddingHorizontal: 12, paddingVertical: 9, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  repoName: { fontSize: 13, fontWeight: '700' },
  fileRow: { minHeight: 37, paddingHorizontal: 10, paddingVertical: 7, flexDirection: 'row', alignItems: 'center', gap: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  fileName: { flex: 1, minWidth: 0, fontSize: 12 },
  empty: { padding: 14, fontSize: 12, textAlign: 'center' },
  editor: { minHeight: 360, maxHeight: 620, borderWidth: 1, borderRadius: 12, padding: 13, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 12, lineHeight: 18, textAlign: 'left' },
  status: { borderWidth: 1, borderRadius: 11, padding: 12, flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  statusText: { fontSize: 12, lineHeight: 18, flex: 1 },
  commitLink: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 5 },
  commitText: { fontSize: 12, fontWeight: '700' },
});
