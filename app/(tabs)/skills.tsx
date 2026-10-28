import React, { useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useAssistant, type AssistantSkill } from '@/src/assistant';
import { alertCompat } from '@/src/web-alert';
import { ScreenTopBar } from '@/components/PhoneDrawer';
import {
  ActionButton,
  AppScreen,
  EmptyState,
  FormField,
  SectionTitle,
  StatusPill,
  Surface,
} from '@/components/Ui';

const emptySkill = { name: '', description: '', instructions: '' };

interface GhFile {
  name: string;
  path: string;
  size: number;
}

/** Parse a GitHub URL (repo, dir, blob file or raw file) into a fetchable target. */
function parseGitHubUrl(
  raw: string,
): { owner: string; repo: string; kind: 'file' | 'dir'; branch: string | null; path: string } | null {
  const url = raw
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '');
  let m = /^github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/blob\/([^/\s]+)\/(.+)$/i.exec(url);
  if (m) return { owner: m[1], repo: m[2], kind: 'file', branch: m[3], path: m[4] };
  m = /^github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/tree\/([^/\s]+)\/(.+)$/i.exec(url);
  if (m) return { owner: m[1], repo: m[2], kind: 'dir', branch: m[3], path: m[4].replace(/\/+$/, '') };
  m = /^github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/tree\/([^/\s]+)$/i.exec(url);
  if (m) return { owner: m[1], repo: m[2], kind: 'dir', branch: m[3], path: '' };
  m = /^raw\.githubusercontent\.com\/([^/\s]+)\/([^/\s]+)\/([^/\s]+)\/(.+)$/i.exec(url);
  if (m) return { owner: m[1], repo: m[2], kind: 'file', branch: m[3], path: m[4] };
  m = /^github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i.exec(url);
  if (m) return { owner: m[1], repo: m[2], kind: 'dir', branch: null, path: '' };
  return null;
}

/** Shared skill-document parser: front-matter (title/description) + body. */
function parseSkillDocument(text: string, fallbackTitle: string) {
  let title = fallbackTitle;
  let description = '';
  let instructions = text.trim();
  const fm = /^---\n([\s\S]*?)\n---\s*\n([\s\S]*)$/.exec(instructions);
  if (fm) {
    const t = /^title:\s*(.+)$/m.exec(fm[1]);
    const d = /^description:\s*(.+)$/m.exec(fm[1]);
    if (t) title = t[1].trim().replace(/^["']|["']$/g, '');
    if (d) description = d[1].trim().replace(/^["']|["']$/g, '');
    instructions = fm[2].trim();
  }
  return { title: title.slice(0, 60), description: description.slice(0, 120), instructions };
}

export default function SkillsScreen() {
  const colors = useColors();
  const { skills, createSkill, updateSkill, setSkillActive } = useAssistant();
  const [visible, setVisible] = useState(false);
  const [selected, setSelected] = useState<AssistantSkill | null>(null);
  const [form, setForm] = useState(emptySkill);
  // GitHub import state
  const [ghVisible, setGhVisible] = useState(false);
  const [ghUrl, setGhUrl] = useState('');
  const [ghLoading, setGhLoading] = useState(false);
  const [ghError, setGhError] = useState('');
  const [ghFiles, setGhFiles] = useState<GhFile[]>([]);
  const [ghDone, setGhDone] = useState<string[]>([]);
  const [ghSource, setGhSource] = useState('');
  const activeSkills = useMemo(() => skills.filter((skill) => skill.active), [skills]);
  const archivedSkills = useMemo(
    () => skills.filter((skill) => !skill.active),
    [skills],
  );

  function openNew() {
    setSelected(null);
    setForm(emptySkill);
    setVisible(true);
  }

  /** Import a .md/.txt file as a new skill (name from filename, front-matter title wins). */
  async function importMarkdown() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['text/markdown', 'text/plain', 'application/octet-stream'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled || !result.assets?.length) return;
      const file = result.assets[0];
      if (!file.name || !/\.(md|markdown|txt)$/i.test(file.name)) {
        alertCompat('صيغة غير مدعومة', 'اختاري ملف بصيغة .md أو .txt');
        return;
      }
      if ((file.size ?? 0) > 200_000) {
        alertCompat('الملف كبير', 'الحد الأقصى 200KB لكل مهارة.');
        return;
      }
      const response = await fetch(file.uri);
      const text = await response.text();
      if ((file.size ?? 0) > 200_000 || text.length > 200_000) {
        alertCompat('الملف كبير', 'الحد الأقصى 200KB لكل مهارة.');
        return;
      }
      const parsed = parseSkillDocument(text, file.name.replace(/\.(md|markdown|txt)$/i, ''));
      if (!parsed.instructions) {
        alertCompat('الملف فاضي', 'محتوى الملف لا يحتوي تعليمات.');
        return;
      }
      await createSkill({
        name: parsed.title,
        description: parsed.description,
        instructions: parsed.instructions,
      });
      alertCompat('تم الاستيراد', `أُضيفت المهارة "${parsed.title}".`);
    } catch (error) {
      alertCompat('تعذّر الاستيراد', error instanceof Error ? error.message : 'حاولي مرة أخرى.');
    }
  }

  /** Import one fetched markdown document as a new skill. */
  async function importGhText(fileName: string, text: string, source: string) {
    if (text.length > 200_000) {
      throw new Error('الملف أكبر من 200KB — اختاري ملفًا أصغر.');
    }
    // SKILL.md / README.md carry no identity — the parent folder names the skill.
    let fallbackTitle = fileName.replace(/\.(md|markdown|txt)$/i, '');
    if (/^(skill|readme|index)$/i.test(fallbackTitle) && fileName.includes('/')) {
      const parent = fileName.split('/').slice(-2, -1)[0];
      if (parent) fallbackTitle = parent;
    }
    const parsed = parseSkillDocument(text, fallbackTitle);
    if (!parsed.instructions) {
      throw new Error('محتوى الملف لا يحتوي تعليمات.');
    }
    await createSkill({
      name: parsed.title,
      description:
        parsed.description || `مستوردة من GitHub · ${source}`.slice(0, 120),
      instructions: parsed.instructions,
    });
    setGhDone((cur) => [...cur, parsed.title]);
  }

  /** Fetch a GitHub file (direct) or list markdown files in a repo/directory. */
  async function fetchGh() {
    const target = parseGitHubUrl(ghUrl);
    if (!target) {
      setGhError('الرابط غير صحيح — استخدم رابط مستودع GitHub أو رابط ملف .md داخله.');
      return;
    }
    setGhLoading(true);
    setGhError('');
    setGhFiles([]);
    setGhDone([]);
    try {
      if (target.kind === 'file') {
        const branch = target.branch && target.branch !== 'HEAD' ? target.branch : 'HEAD';
        const res = await fetch(
          `https://raw.githubusercontent.com/${target.owner}/${target.repo}/${branch}/${target.path}`,
        );
        if (res.status === 404) {
          throw new Error('الملف غير موجود (404) — راجعي الرابط والفرع والمسار.');
        }
        if (res.status === 403) {
          throw new Error('تجاوزتِ حد GitHub المؤقت — حاولي بعد قليل.');
        }
        if (!res.ok) throw new Error(`فشل جلب الملف (HTTP ${res.status}).`);
        const text = await res.text();
        const fileName = target.path;
        await importGhText(fileName, text, `${target.owner}/${target.repo}`);
        setGhSource(`${target.owner}/${target.repo}/${target.path}`);
        return;
      }
      // Repo / directory: resolve the default branch, then list markdown files recursively.
      const repoRes = await fetch(`https://api.github.com/repos/${target.owner}/${target.repo}`);
      if (repoRes.status === 404) {
        throw new Error('المستودع غير موجود أو خاص (404). المستودعات الخاصة تحتاج مصادقة وغير مدعومة.');
      }
      if (repoRes.status === 403) {
        throw new Error('تجاوزتِ حد GitHub المؤقت (60 طلب/ساعة) — حاولي بعد قليل.');
      }
      if (!repoRes.ok) throw new Error(`فشل جلب المستودع (HTTP ${repoRes.status}).`);
      const repoJson = (await repoRes.json()) as { default_branch?: string };
      const branch = target.branch ?? repoJson.default_branch ?? 'main';
      const treeRes = await fetch(
        `https://api.github.com/repos/${target.owner}/${target.repo}/git/trees/${branch}?recursive=1`,
      );
      if (treeRes.status === 403) {
        throw new Error('تجاوزتِ حد GitHub المؤقت (60 طلب/ساعة) — حاولي بعد قليل.');
      }
      if (!treeRes.ok) throw new Error(`فشل جلب شجرة المستودع (HTTP ${treeRes.status}).`);
      const treeJson = (await treeRes.json()) as {
        tree?: { path: string; type: string; size?: number }[];
        truncated?: boolean;
      };
      const all = (treeJson.tree ?? []).filter(
        (e) => e.type === 'blob' && /\.(md|markdown|txt)$/i.test(e.path),
      );
      if (!all.length) {
        throw new Error('لا ملفات .md/.txt في هذا المستودع — استخدمي رابط ملف مباشر أو أضيفي المهارة يدويًا.');
      }
      if (treeJson.truncated) {
        setGhError('المستودع ضخم جدًا — عُرضت أول النتائج فقط. استخدمي رابط ملف مباشر للباقي.');
      }
      const ranked = all
        .map((e) => ({
          name: e.path.split('/').pop() ?? e.path,
          path: e.path,
          size: e.size ?? 0,
          depth: e.path.split('/').length,
          priority: /skill\.md$/i.test(e.path) ? 0 : /readme\.md$/i.test(e.path) ? 1 : 2,
        }))
        .sort(
          (a, b) => a.priority - b.priority || a.depth - b.depth || a.path.localeCompare(b.path),
        )
        .slice(0, 40);
      setGhFiles(ranked);
      setGhSource(`${target.owner}/${target.repo} · ${branch}`);
    } catch (caught) {
      setGhError(caught instanceof Error ? caught.message : 'فشل الجلب — راجعي الرابط والاتصال.');
    } finally {
      setGhLoading(false);
    }
  }

  /** Import a chosen repo file: fetch its raw content and create the skill. */
  async function importGhFile(file: GhFile) {
    const target = parseGitHubUrl(ghUrl);
    if (!target) return;
    setGhLoading(true);
    setGhError('');
    try {
      const branch = target.branch ?? 'HEAD';
      const res = await fetch(
        `https://raw.githubusercontent.com/${target.owner}/${target.repo}/${branch}/${file.path}`,
      );
      if (res.status === 404) {
        throw new Error('الملف غير موجود في هذا الفرع (404).');
      }
      if (!res.ok) throw new Error(`فشل جلب الملف (HTTP ${res.status}).`);
      const text = await res.text();
      await importGhText(file.path, text, `${target.owner}/${target.repo}/${file.path}`);
    } catch (caught) {
      setGhError(caught instanceof Error ? caught.message : 'فشل الاستيراد — حاولي مرة أخرى.');
    } finally {
      setGhLoading(false);
    }
  }

  function openEdit(skill: AssistantSkill) {
    setSelected(skill);
    setForm({
      name: skill.name,
      description: skill.description,
      instructions: skill.instructions,
    });
    setVisible(true);
  }

  async function save() {
    if (!form.name.trim() || !form.instructions.trim()) {
      alertCompat('أكملي البيانات', 'اكتبي اسم المهارة وطريقة تنفيذها.');
      return;
    }
    try {
      if (selected) {
        await updateSkill(selected.id, form);
      } else {
        await createSkill(form);
      }
      setVisible(false);
    } catch (error) {
      alertCompat(
        'لم يتم حفظ المهارة',
        error instanceof Error ? error.message : 'حاولي مرة أخرى.',
      );
    }
  }

  function renderSkill(skill: AssistantSkill) {
    return (
      <Surface key={skill.id} style={styles.skillCard}>
        <View style={styles.skillHeading}>
          <View style={[styles.skillIcon, { backgroundColor: colors.accent }]}>
            <Feather name="zap" size={17} color={colors.primary} />
          </View>
          <View style={styles.skillNameBlock}>
            <Text style={[styles.skillName, { color: colors.foreground }]}>
              {skill.name}
            </Text>
            <Text style={[styles.skillDescription, { color: colors.mutedForeground }]}>
              {skill.description || 'من غير وصف إضافي'}
            </Text>
          </View>
          <StatusPill
            label={skill.active ? 'نشطة' : 'مؤرشفة'}
            tone={skill.active ? 'success' : 'neutral'}
          />
        </View>
        {skill.core ? (
          <View style={styles.coreBadgeRow}>
            <View style={[styles.coreBadge, { borderColor: colors.primary }]}>
              <Feather name="shield" size={10} color={colors.primary} />
              <Text style={[styles.coreBadgeText, { color: colors.primary }]}>
                أساسية — مدمجة في التطبيق وتُستخدم تلقائيًا حسب سؤالك
              </Text>
            </View>
          </View>
        ) : null}
        <Text
          numberOfLines={3}
          style={[styles.instructions, { color: colors.mutedForeground }]}
        >
          {skill.instructions}
        </Text>
        <View style={[styles.cardFooter, { borderTopColor: colors.border }]}>
          <Text style={[styles.versionText, { color: colors.mutedForeground }]}>
            {skill.versions.length} {skill.versions.length === 1 ? 'نسخة محفوظة' : 'نسخ محفوظة'}
          </Text>
          <View style={styles.cardActions}>
            <Pressable
              accessibilityRole="button"
              onPress={() => openEdit(skill)}
              style={styles.smallAction}
            >
              <Feather name="edit-2" size={14} color={colors.primary} />
              <Text style={[styles.smallActionText, { color: colors.primary }]}>تعديل</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                void setSkillActive(skill.id, !skill.active).catch(() =>
                  alertCompat('تعذّر حفظ التغيير', 'حاولي مرة أخرى.'),
                )
              }
              style={styles.smallAction}
            >
              <Feather
                name={skill.active ? 'archive' : 'rotate-ccw'}
                size={14}
                color={colors.mutedForeground}
              />
              <Text style={[styles.smallActionText, { color: colors.mutedForeground }]}>
                {skill.active ? 'أرشفة' : 'استعادة'}
              </Text>
            </Pressable>
          </View>
        </View>
      </Surface>
    );
  }

  return (
    <>
      <AppScreen
        title="مهاراتي"
        eyebrow="تعليمات قابلة للتطوير"
        subtitle="أضيفي أسلوب شغلك وتعليماتك. المهارات النشطة تدخل في سياق الشات."
        action={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="إضافة مهارة"
            onPress={openNew}
            style={[styles.addButton, { backgroundColor: colors.primary }]}
          >
            <Feather name="plus" size={19} color={colors.primaryForeground} />
          </Pressable>
        }
      >
        <ScreenTopBar active="skills" />
        <Surface style={styles.infoCard}>
          <Feather name="layers" size={18} color={colors.primary} />
          <Text style={[styles.infoText, { color: colors.foreground }]}>
            أرشفة المهارة توقف استخدامها في الشات لكنها تحتفظ بنسخها. تقدري ترجعيها أو تطوريها في أي وقت.
          </Text>
        </Surface>

        <View style={styles.section}>
          <SectionTitle title={`نشطة (${activeSkills.length})`} />
          {activeSkills.length ? (
            activeSkills.map(renderSkill)
          ) : (
            <EmptyState
              icon="zap"
              title="مفيش مهارات لسه"
              message="أضيفي خطوات عملك أو الطريقة اللي تحبي المساعد يكتب بيها."
              action={
                <ActionButton
                  label="إضافة أول مهارة"
                  icon="plus"
                  onPress={openNew}
                />
              }
            />
          )}
          <ActionButton
            label="استيراد ملف .md / .txt (يستخلص الاسم والوصف تلقائيًا)"
            icon="upload"
            variant="secondary"
            onPress={() => void importMarkdown()}
          />
          <ActionButton
            label="إضافة مهارة من مستودع GitHub"
            icon="github"
            variant="secondary"
            onPress={() => {
              setGhVisible(true);
              setGhError('');
              setGhFiles([]);
              setGhDone([]);
              setGhSource('');
            }}
          />
        </View>

        {archivedSkills.length ? (
          <View style={styles.section}>
            <SectionTitle title={`أرشيف المهارات (${archivedSkills.length})`} />
            {archivedSkills.map(renderSkill)}
          </View>
        ) : null}
      </AppScreen>

      <Modal
        visible={visible}
        transparent
        animationType="slide"
        onRequestClose={() => setVisible(false)}
      >
        <View style={styles.backdrop}>
          <View style={[styles.sheet, { backgroundColor: colors.background }]}>
            <View style={styles.sheetHeader}>
              <Text style={[styles.sheetTitle, { color: colors.foreground }]}>
                {selected ? 'تعديل المهارة' : 'مهارة جديدة'}
              </Text>
              <Pressable onPress={() => setVisible(false)} accessibilityLabel="إغلاق">
                <Feather name="x" size={22} color={colors.foreground} />
              </Pressable>
            </View>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.form}
            >
              <FormField
                label="اسم المهارة"
                placeholder="مثال: كتابة وصف المنتجات"
                value={form.name}
                onChangeText={(name) => setForm({ ...form, name })}
                style={styles.rtlInput}
                maxLength={80}
              />
              <FormField
                label="وصف مختصر"
                placeholder="إمتى يستخدمها المساعد؟"
                value={form.description}
                onChangeText={(description) => setForm({ ...form, description })}
                style={styles.rtlInput}
                maxLength={180}
              />
              <FormField
                label="التعليمات"
                hint="اكتبي خطوات واضحة وأمثلة إن أمكن. هذه تعليمات للموديل وليست كودًا يعمل تلقائيًا."
                placeholder="1. افهمي الجمهور…&#10;2. اكتبي النتيجة…"
                value={form.instructions}
                onChangeText={(instructions) => setForm({ ...form, instructions })}
                multiline
                style={[styles.rtlInput, styles.multilineInput]}
                maxLength={8000}
              />
              {selected?.versions.length ? (
                <View style={styles.versionHistory}>
                  <Text style={[styles.historyHeading, { color: colors.foreground }]}>
                    النسخ السابقة المحفوظة
                  </Text>
                  {[...selected.versions].reverse().map((version) => (
                    <Pressable
                      key={version.version}
                      accessibilityRole="button"
                      onPress={() =>
                        setForm({
                          name: version.name,
                          description: version.description,
                          instructions: version.instructions,
                        })
                      }
                      style={[
                        styles.versionRow,
                        { borderColor: colors.border, backgroundColor: colors.card },
                      ]}
                    >
                      <View style={styles.versionCopy}>
                        <Text style={[styles.versionTitle, { color: colors.foreground }]}>
                          نسخة {version.version} ·{' '}
                          {new Date(version.savedAt).toLocaleDateString('ar-EG')}
                        </Text>
                        <Text
                          numberOfLines={2}
                          style={[styles.versionDescription, { color: colors.mutedForeground }]}
                        >
                          {version.name} — {version.instructions}
                        </Text>
                      </View>
                      <Feather name="rotate-ccw" size={15} color={colors.primary} />
                    </Pressable>
                  ))}
                  <Text style={[styles.versionHint, { color: colors.mutedForeground }]}>
                    اختاري نسخة لملء النموذج بها، ثم احفظيها كنسخة جديدة.
                  </Text>
                </View>
              ) : null}
              <ActionButton
                label={selected ? 'حفظ نسخة جديدة' : 'حفظ المهارة'}
                icon="check"
                onPress={() => void save()}
              />
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* GitHub import sheet: paste a repo URL to list its markdown skills,
          or paste a direct file link to import it immediately. */}
      <Modal
        visible={ghVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setGhVisible(false)}
      >
        <View style={styles.backdrop}>
          <View style={[styles.sheet, { backgroundColor: colors.background }]}>
            <View style={styles.sheetHeader}>
              <Text style={[styles.sheetTitle, { color: colors.foreground }]}>
                إضافة مهارة من GitHub
              </Text>
              <Pressable onPress={() => setGhVisible(false)} accessibilityLabel="إغلاق">
                <Feather name="x" size={22} color={colors.foreground} />
              </Pressable>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.form}>
              <FormField
                label="رابط المستودع أو الملف"
                hint="المستودعات العامة فقط. أمثلة: github.com/user/repo · github.com/user/repo/blob/main/SKILL.md · raw.githubusercontent.com/..."
                placeholder="github.com/user/repo"
                value={ghUrl}
                onChangeText={setGhUrl}
                autoCapitalize="none"
                autoCorrect={false}
                style={[styles.ghInput]}
                maxLength={500}
              />
              <ActionButton
                label={ghLoading ? 'جارٍ الجلب من GitHub…' : ghFiles.length ? 'جلب رابط آخر' : 'جلب'}
                icon="github"
                variant="secondary"
                onPress={() => void fetchGh()}
                disabled={ghLoading}
              />
              {ghError ? (
                <Text style={[styles.ghError, { color: colors.destructive }]}>{ghError}</Text>
              ) : null}
              {ghSource && ghFiles.length ? (
                <Text style={[styles.ghSource, { color: colors.mutedForeground }]} numberOfLines={1}>
                  {ghSource} — اختاري ملفًا لاستيراده كتعليمات مهارة:
                </Text>
              ) : null}
              {ghFiles.map((file) => {
                const done = ghDone.includes(
                  file.name.replace(/\.(md|markdown|txt)$/i, '').slice(0, 60),
                );
                return (
                  <Pressable
                    key={file.path}
                    accessibilityRole="button"
                    accessibilityLabel={`استيراد ${file.name}`}
                    disabled={ghLoading || done}
                    onPress={() => void importGhFile(file)}
                    style={[styles.ghRow, { borderColor: colors.border, backgroundColor: colors.card }]}
                  >
                    <Feather
                      name={done ? 'check-circle' : 'file-text'}
                      size={16}
                      color={done ? colors.success : colors.primary}
                    />
                    <View style={styles.ghRowCopy}>
                      <Text style={[styles.ghRowName, { color: colors.foreground }]} numberOfLines={1}>
                        {file.name}
                      </Text>
                      <Text style={[styles.ghRowPath, { color: colors.mutedForeground }]} numberOfLines={1}>
                        {file.path}
                        {file.size ? ` · ${Math.round(file.size / 1024)}KB` : ''}
                      </Text>
                    </View>
                    <Text style={[styles.ghRowAction, { color: done ? colors.success : colors.primary }]}>
                      {done ? 'استُوردت' : 'استيراد'}
                    </Text>
                  </Pressable>
                );
              })}
              {ghDone.length ? (
                <Text style={[styles.ghSource, { color: colors.success }]}>
                  استُوردت {ghDone.length} {ghDone.length === 1 ? 'مهارة' : 'مهارات'} — صدّري النافذة للمراجعة أو استمري في الاختيار.
                </Text>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  addButton: { width: 42, height: 42, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  infoCard: { flexDirection: 'row-reverse', alignItems: 'flex-start', gap: 10 },
  infoText: { flex: 1, fontSize: 12, lineHeight: 19, textAlign: 'right' },
  section: { gap: 11 },
  skillCard: { gap: 12 },
  coreBadgeRow: { marginTop: -2 },
  coreBadge: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  coreBadgeText: { fontSize: 10, fontWeight: '700', textAlign: 'right' },
  skillHeading: { flexDirection: 'row-reverse', alignItems: 'center', gap: 9 },
  skillIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  skillNameBlock: { flex: 1, alignItems: 'flex-end', gap: 3 },
  skillName: { fontSize: 14, fontWeight: '700', textAlign: 'right' },
  skillDescription: { fontSize: 11, textAlign: 'right' },
  instructions: { fontSize: 12, lineHeight: 18, textAlign: 'right' },
  cardFooter: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 1, paddingTop: 10 },
  versionText: { fontSize: 10 },
  cardActions: { flexDirection: 'row-reverse', gap: 14 },
  smallAction: { flexDirection: 'row-reverse', alignItems: 'center', gap: 5, paddingVertical: 4 },
  smallActionText: { fontSize: 11, fontWeight: '700' },
  backdrop: { flex: 1, backgroundColor: 'rgba(4, 13, 10, 0.5)', justifyContent: 'flex-end' },
  sheet: { maxHeight: '90%', borderTopLeftRadius: 25, borderTopRightRadius: 25, paddingHorizontal: 20, paddingTop: 18, paddingBottom: 28 },
  sheetHeader: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 },
  sheetTitle: { fontSize: 19, fontWeight: '700' },
  form: { gap: 15, paddingBottom: 12 },
  versionHistory: { gap: 8, paddingTop: 4 },
  historyHeading: { fontSize: 13, fontWeight: '700', textAlign: 'right' },
  versionRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 12, padding: 10 },
  versionCopy: { flex: 1, alignItems: 'flex-end', gap: 3 },
  versionTitle: { fontSize: 11, fontWeight: '700', textAlign: 'right' },
  versionDescription: { fontSize: 10, lineHeight: 15, textAlign: 'right' },
  versionHint: { fontSize: 10, lineHeight: 15, textAlign: 'right' },
  rtlInput: { textAlign: 'right', writingDirection: 'rtl' },
  multilineInput: { minHeight: 140 },
  ghInput: { textAlign: 'left', writingDirection: 'ltr' },
  ghError: { fontSize: 12, lineHeight: 18, textAlign: 'right' },
  ghSource: { fontSize: 11, textAlign: 'right' },
  ghRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 9,
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
  },
  ghRowCopy: { flex: 1, gap: 2, alignItems: 'flex-end' },
  ghRowName: { fontSize: 13, fontWeight: '700', textAlign: 'right' },
  ghRowPath: { fontSize: 10, textAlign: 'right' },
  ghRowAction: { fontSize: 11, fontWeight: '800' },
});
