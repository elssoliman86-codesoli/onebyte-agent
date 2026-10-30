import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { ScreenTopBar } from '@/components/PhoneDrawer';
import { AppScreen, Surface } from '@/components/Ui';
import { alertCompat } from '@/src/web-alert';
import {
  deleteHunterTool,
  loadHunterRuns,
  loadHunterTools,
  saveHunterTool,
  approveHunterPythonTool,
  smokeTestHunterPythonTool,
  type HunterRunRecord,
  type HunterTool,
} from '@/src/hunter-tools';

export default function HunterToolsScreen() {
  const colors = useColors();
  const [tools, setTools] = useState<HunterTool[]>([]);
  const [runs, setRuns] = useState<HunterRunRecord[]>([]);
  const [selected, setSelected] = useState<HunterTool | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [source, setSource] = useState('def run(target: str) -> dict:\n    """Return structured findings for an authorized target."""\n    return {"target": target, "findings": []}');
  const [busy, setBusy] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);

  async function refresh() {
    const [nextTools, nextRuns] = await Promise.all([loadHunterTools(), loadHunterRuns()]);
    setTools(nextTools);
    setRuns(nextRuns);
  }
  useEffect(() => { void refresh(); }, []);

  function edit(tool: HunterTool) {
    setSelected(tool);
    setName(tool.name);
    setDescription(tool.description);
    setSource(tool.source);
  }

  async function save() {
    try {
      setBusy(true);
      await saveHunterTool({
        id: selected?.id,
        name,
        description,
        source,
        outputDescription: 'JSON structured result',
        tags: ['custom', 'hunting'],
      });
      setSelected(null);
      setName('');
      setDescription('');
      setSource('');
      await refresh();
      alertCompat('تم حفظ الأداة', 'حُفظ الكود في مكتبة الأدوات كإصدار Draft. الأدوات المولدة تلقائيًا لا تُعتمد إلا بعد اجتياز بوابة المصدر المحدود واختبار Python؛ الأدوات التي لا تجتازها تظل Draft للمراجعة اليدوية.');
    } catch (error) {
      alertCompat('تعذّر حفظ الأداة', error instanceof Error ? error.message : 'خطأ غير معروف');
    } finally { setBusy(false); }
  }

  async function remove(tool: HunterTool) {
    try { await deleteHunterTool(tool.id); await refresh(); }
    catch (error) { alertCompat('تعذّر حذف الأداة', error instanceof Error ? error.message : 'خطأ غير معروف'); }
  }

  const verifiedCount = useMemo(() => tools.filter((tool) => tool.status === 'verified').length, [tools]);

  return (
    <AppScreen
      title="Hunter Tool Registry"
      eyebrow="Persistent security tooling"
      subtitle="مكتبة الأدوات الدائمة. الكود محفوظ داخل بيانات التطبيق، وملفات التشغيل المؤقتة منفصلة عنه."
      topBar={<ScreenTopBar active="hunter" />}
    >
      <Surface style={s.card}>
        <View style={s.row}>
          <Feather name="database" size={19} color={colors.primary} />
          <Text style={[s.title, { color: colors.foreground, flex: 1 }]}>مكتبة الأدوات</Text>
          <Text style={[s.muted, { color: colors.mutedForeground }]}>{verifiedCount} معتمدة · {tools.length} إجمالي</Text>
        </View>
        {tools.map((tool) => (
          <View key={tool.id} style={[s.tool, { borderColor: colors.border }]}>
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={[s.toolName, { color: colors.foreground }]}>{tool.name}</Text>
              <Text style={[s.muted, { color: colors.mutedForeground }]}>{tool.description}</Text>
              <Text style={[s.meta, { color: colors.mutedForeground }]}>{tool.kind.toUpperCase()} · v{tool.version} · {tool.useCount} استخدام · {tool.status}</Text>
              {tool.kind === 'python' && tool.status !== 'verified' ? (
                <View style={s.row}>
                  <Pressable disabled={testingId === tool.id} onPress={() => {
                    setTestingId(tool.id);
                    void smokeTestHunterPythonTool(tool.id).then((output) => alertCompat('نجح اختبار التشغيل الأولي', output.slice(0, 1200) || 'تم تنفيذ run(args) وإرجاع نتيجة منظمة.'))
                      .catch((error) => alertCompat('فشل اختبار الأداة', error instanceof Error ? error.message : 'خطأ غير معروف'))
                      .finally(() => { setTestingId(null); void refresh(); });
                  }} style={[s.smallButton, { borderColor: colors.border }]}>
                    <Text style={{ color: colors.primary, fontSize: 10 }}>{testingId === tool.id ? 'جارٍ الاختبار…' : 'اختبار التشغيل'}</Text>
                  </Pressable>
                  {tool.status === 'smoke-tested' ? (
                    <Pressable onPress={() => void approveHunterPythonTool(tool.id).then(refresh).catch((error) => alertCompat('تعذّر الاعتماد', error instanceof Error ? error.message : 'خطأ غير معروف'))} style={[s.smallButton, { borderColor: colors.success }]}>
                      <Text style={{ color: colors.success, fontSize: 10 }}>اعتماد الإصدار</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
            </View>
            <Pressable onPress={() => edit(tool)} accessibilityLabel={`تعديل ${tool.name}`} style={s.iconButton}>
              <Feather name="edit-2" size={16} color={colors.primary} />
            </Pressable>
            {!tool.id.startsWith('hunter.') ? (
              <Pressable onPress={() => void remove(tool)} accessibilityLabel={`حذف ${tool.name}`} style={s.iconButton}>
                <Feather name="trash-2" size={16} color={colors.destructive} />
              </Pressable>
            ) : null}
          </View>
        ))}
        <Text style={[s.note, { color: colors.mutedForeground }]}>
          Python يعمل على الجهاز داخل WebAssembly Worker مستقل. أول تشغيل يحتاج تنزيل Runtime الرسمي من jsDelivr؛ بعد تحميله يعمل التنفيذ محليًا. الاعتماد التلقائي مقصور على كود Python خالص بلا imports أو وصول للنظام أو الشبكة، مع اختبار تشغيل فعلي. الأكواد التي لا تجتاز البوابة تظل Draft للمراجعة.
        </Text>
      </Surface>

      <Surface style={s.card}>
        <View style={s.row}>
          <Feather name="code" size={18} color={colors.primary} />
          <Text style={[s.title, { color: colors.foreground, flex: 1 }]}>{selected ? 'تعديل أداة' : 'إنشاء أداة Python'}</Text>
          {selected ? <Pressable onPress={() => setSelected(null)}><Feather name="x" size={18} color={colors.mutedForeground}/></Pressable> : null}
        </View>
        <TextInput value={name} onChangeText={setName} placeholder="اسم الأداة" placeholderTextColor={colors.mutedForeground} style={[s.input, { color: colors.foreground, borderColor: colors.border }]} />
        <TextInput value={description} onChangeText={setDescription} placeholder="وظيفة الأداة والمدخلات والمخرجات" placeholderTextColor={colors.mutedForeground} style={[s.input, { color: colors.foreground, borderColor: colors.border }]} />
        <TextInput value={source} onChangeText={setSource} multiline autoCapitalize="none" autoCorrect={false} spellCheck={false} textAlignVertical="top" placeholder="Python source..." placeholderTextColor={colors.mutedForeground} style={[s.code, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]} />
        <Pressable disabled={busy} onPress={() => void save()} style={[s.primary, { backgroundColor: colors.primary, opacity: busy ? 0.6 : 1 }]}>
          <Feather name="save" size={15} color={colors.primaryForeground}/>
          <Text style={{ color: colors.primaryForeground, fontWeight: '700' }}>{busy ? 'جارٍ الحفظ…' : 'حفظ كإصدار Draft'}</Text>
        </Pressable>
      </Surface>

      <Surface style={s.card}>
        <View style={s.row}>
          <Feather name="activity" size={18} color={colors.primary}/>
          <Text style={[s.title, { color: colors.foreground }]}>سجل عمليات Hunting</Text>
        </View>
        {runs.length ? runs.slice(0, 12).map((run) => (
          <View key={run.id} style={[s.tool, { borderColor: colors.border }]}>
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={[s.toolName, { color: colors.foreground }]}>{run.target}</Text>
              <Text style={[s.muted, { color: colors.mutedForeground }]}>{run.status} · {run.discoveredUrls.length} URLs · {run.networkRequests} network records</Text>
              <Text style={[s.meta, { color: colors.mutedForeground }]}>{run.startedAt}</Text>
            </View>
          </View>
        )) : <Text style={[s.muted, { color: colors.mutedForeground }]}>لا توجد عمليات محفوظة بعد.</Text>}
      </Surface>
    </AppScreen>
  );
}

const s = StyleSheet.create({
  card: { gap: 11, padding: 13 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 15, fontWeight: '800' },
  tool: { flexDirection: 'row', alignItems: 'center', gap: 8, borderTopWidth: 1, paddingTop: 10 },
  toolName: { fontSize: 13, fontWeight: '700' },
  muted: { fontSize: 11, lineHeight: 17 },
  meta: { fontSize: 10 },
  iconButton: { padding: 7 },
  input: { minHeight: 42, borderWidth: 1, borderRadius: 9, paddingHorizontal: 10, fontSize: 12 },
  code: { minHeight: 190, borderWidth: 1, borderRadius: 9, padding: 10, fontFamily: 'monospace', fontSize: 11, lineHeight: 17 },
  smallButton: { minHeight: 28, borderWidth: 1, borderRadius: 7, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center' },
  primary: { minHeight: 42, borderRadius: 9, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 7 },
  note: { fontSize: 10, lineHeight: 16 },
});
