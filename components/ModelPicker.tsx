import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import {
  fetchModels,
  formatContext,
  formatPrice,
  type ModelInfo,
} from '@/src/model-catalog';
import { probeModel } from '@/src/model-provider';

export function ModelPicker({
  visible,
  baseUrl,
  getApiKey,
  onClose,
  onPick,
}: {
  visible: boolean;
  baseUrl: string;
  getApiKey: () => Promise<string>;
  onClose: () => void;
  onPick: (model: ModelInfo) => void;
}) {
  const colors = useColors();
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [freeOnly, setFreeOnly] = useState(false);
  // probe results: model id -> HTTP status (200 = available)
  const [probeResults, setProbeResults] = useState<Record<string, number>>({});
  const [probing, setProbing] = useState(false);
  const [probeProgress, setProbeProgress] = useState(0);
  const [only200, setOnly200] = useState(false);

  useEffect(() => {
    if (!visible) return;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    (async () => {
      try {
        const key = await getApiKey();
        const list = await fetchModels(baseUrl, key, controller.signal);
        setModels(list);
      } catch (caught) {
        if (controller.signal.aborted) return;
        setModels([]);
        setError(caught instanceof Error ? caught.message : 'تعذّر جلب الموديلات.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, baseUrl]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return models.filter(
      (m) =>
        (!freeOnly || m.free) &&
        (!only200 || probeResults[m.id] === 200) &&
        (!q || m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q)),
    );
  }, [models, query, freeOnly, only200, probeResults]);

  const freeCount = useMemo(() => models.filter((m) => m.free).length, [models]);

  /** Probe the visible models (max 24) so the user can filter by what actually returns 200. */
  async function probeVisible() {
    if (probing || !models.length) return;
    const targets = shown.slice(0, 24);
    if (!targets.length) return;
    setProbing(true);
    setProbeProgress(0);
    setProbeResults({});
    try {
      const key = await getApiKey();
      let done = 0;
      const workers = Array.from({ length: 4 }, async () => {
        while (targets.length) {
          const m = targets.shift();
          if (!m) break;
          const result = await probeModel({
            settings: { providerName: 'probe', baseUrl, model: m.id },
            apiKey: key,
          });
          setProbeResults((cur) => ({ ...cur, [m.id]: result.status ?? -1 }));
          done += 1;
          setProbeProgress(done);
        }
      });
      await Promise.all(workers);
    } catch {
      // probe failures leave status as absent — user sees raw list
    } finally {
      setProbing(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel="إغلاق" onPress={onClose}>
            <Feather name="x" size={22} color={colors.foreground} />
          </Pressable>
          <Text style={[styles.title, { color: colors.foreground }]}>اختيار الموديل</Text>
        </View>

        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="ابحث باسم الموديل…"
          placeholderTextColor={colors.mutedForeground}
          autoCapitalize="none"
          autoCorrect={false}
          style={[
            styles.search,
            { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card },
          ]}
        />
        <View style={styles.filterRow}>
          <Switch value={freeOnly} onValueChange={setFreeOnly} />
          <Text style={[styles.filterText, { color: colors.foreground }]}>
            المجاني فقط {models.length ? `(${freeCount} من ${models.length})` : ''}
          </Text>
        </View>
        <View style={styles.filterRow}>
          {probing ? (
            <>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={[styles.filterText, { color: colors.primary }]}>
                جارٍ فحص المتاح… {probeProgress}/{Math.min(24, models.length)}
              </Text>
            </>
          ) : (
            <>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="فحص الموديلات المتاحة"
                onPress={() => void probeVisible()}
                style={[styles.probeBtn, { borderColor: colors.primary }]}
              >
                <Feather name="activity" size={13} color={colors.primary} />
                <Text style={[styles.probeText, { color: colors.primary }]}>
                  فحص المتاح فعليًا (200 ✓)
                </Text>
              </Pressable>
              {Object.keys(probeResults).length ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="فلترة المتاح فقط"
                  onPress={() => setOnly200(!only200)}
                  style={[styles.probeBtn, { borderColor: only200 ? colors.success : colors.border }]}
                >
                  <Feather name="filter" size={13} color={only200 ? colors.success : colors.foreground} />
                  <Text style={[styles.probeText, { color: only200 ? colors.success : colors.foreground }]}>
                    {only200 ? `المتاح فقط (${Object.values(probeResults).filter((s) => s === 200).length})` : 'المتاح فقط'}
                  </Text>
                </Pressable>
              ) : null}
            </>
          )}
        </View>

        {loading ? (
          <ActivityIndicator style={styles.loader} color={colors.primary} />
        ) : error ? (
          <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text>
        ) : (
          <FlatList
            data={shown}
            keyExtractor={(m) => m.id}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              <Text style={[styles.empty, { color: colors.mutedForeground }]}>لا نتائج.</Text>
            }
            renderItem={({ item }) => (
              <Pressable
                onPress={() => onPick(item)}
                style={[styles.row, { borderBottomColor: colors.border }]}
              >
                <View style={styles.rowTop}>
                  <Text
                    style={[
                      styles.badge,
                      {
                        color: item.free ? colors.success : colors.mutedForeground,
                        borderColor: item.free ? colors.success : colors.border,
                      },
                    ]}
                  >
                    {item.free ? 'مجاني' : item.promptPrice === null ? 'غير معلن' : 'مدفوع'}
                  </Text>
                  <Text numberOfLines={1} style={[styles.name, { color: colors.foreground }]}>
                    {item.name}
                  </Text>
                </View>
                {item.name !== item.id ? (
                  <Text numberOfLines={1} style={[styles.meta, styles.ltr, { color: colors.mutedForeground }]}>
                    {item.id}
                  </Text>
                ) : null}
                <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                  {formatPrice(item)} · {formatContext(item.contextLength)}
                  {item.supportsTools === false ? ' · بدون أدوات' : ''}
                  {probeResults[item.id] === 200
                    ? ' · 200 ✓'
                    : probeResults[item.id] && probeResults[item.id] > 0
                      ? ` · ${probeResults[item.id]} ✗`
                      : ''}
                </Text>
              </Pressable>
            )}
          />
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingTop: 52, paddingHorizontal: 16 },
  header: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  title: { fontSize: 20, fontWeight: '700' },
  search: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, height: 44, fontSize: 14, textAlign: 'right' },
  filterRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10, marginVertical: 8, flexWrap: 'wrap' },
  filterText: { fontSize: 13 },
  probeBtn: { flexDirection: 'row-reverse', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
  probeText: { fontSize: 12, fontWeight: '700' },
  loader: { marginTop: 40 },
  error: { textAlign: 'center', marginTop: 40, fontSize: 13, lineHeight: 20 },
  empty: { textAlign: 'center', marginTop: 40, fontSize: 13 },
  row: { paddingVertical: 12, borderBottomWidth: 1, gap: 4, alignItems: 'flex-end' },
  rowTop: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8, maxWidth: '100%' },
  name: { fontSize: 14, fontWeight: '700', flexShrink: 1 },
  badge: { fontSize: 10, fontWeight: '700', borderWidth: 1, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2 },
  meta: { fontSize: 11, textAlign: 'right' },
  ltr: { writingDirection: 'ltr' },
});
