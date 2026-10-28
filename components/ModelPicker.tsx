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
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
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
  currentModel,
  onClose,
  onPick,
}: {
  visible: boolean;
  baseUrl: string;
  getApiKey: () => Promise<string>;
  /** The model currently in use — shown as "المستخدم الآن" so the user always sees it. */
  currentModel?: string;
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
          <Text style={[styles.title, { color: colors.foreground }]}>اختيار الموديل والأدوات</Text>
        </View>

        {currentModel ? (
          <View style={[styles.currentBar, { backgroundColor: `${colors.success}14`, borderColor: colors.border }]}>
            <Feather name="cpu" size={13} color={colors.success} />
            <Text style={[styles.currentBarText, { color: colors.success }]} numberOfLines={1}>
              الموديل المستخدم الآن: {currentModel}
            </Text>
          </View>
        ) : null}

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
            numColumns={2}
            columnWrapperStyle={styles.gridRow}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.gridContent}
            ListEmptyComponent={
              <Text style={[styles.empty, { color: colors.mutedForeground }]}>لا نتائج.</Text>
            }
            renderItem={({ item }) => {
              const isCurrent = Boolean(currentModel) && item.id === currentModel?.trim();
              const probe = probeResults[item.id];
              return (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => onPick(item)}
                  style={[
                    styles.card,
                    {
                      backgroundColor: colors.card,
                      borderColor: isCurrent ? colors.primary : colors.border,
                    },
                  ]}
                >
                  <View style={styles.cardTop}>
                    {item.free ? (
                      <View style={[styles.freeBadge, { backgroundColor: `${colors.success}18` }]}>
                        <Text style={[styles.badgeText, { color: colors.success }]}>مجاني</Text>
                      </View>
                    ) : (
                      <View style={[styles.crownBadge, { backgroundColor: `${colors.warning}18` }]}>
                        <MaterialCommunityIcons name="crown" size={12} color={colors.warning} />
                        <Text style={[styles.badgeText, { color: colors.warning }]}>
                          {item.promptPrice === null ? 'غير معلن' : 'مدفوع'}
                        </Text>
                      </View>
                    )}
                    {isCurrent ? <Feather name="check-circle" size={15} color={colors.success} /> : null}
                  </View>
                  <Text numberOfLines={2} style={[styles.cardName, { color: colors.foreground }]}>
                    {item.name}
                  </Text>
                  {item.name !== item.id ? (
                    <Text numberOfLines={1} style={[styles.cardId, styles.ltr, { color: colors.mutedForeground }]}>
                      {item.id}
                    </Text>
                  ) : null}
                  <Text style={[styles.cardMeta, { color: colors.mutedForeground }]} numberOfLines={2}>
                    {formatPrice(item)} · {formatContext(item.contextLength)}
                    {item.supportsTools === false ? ' · بدون أدوات' : ''}
                    {probe === 200 ? ' · 200 ✓' : probe && probe > 0 ? ` · ${probe} ✗` : ''}
                  </Text>
                  {isCurrent ? (
                    <Text style={[styles.currentTag, { color: colors.success }]}>مستخدم الآن</Text>
                  ) : null}
                </Pressable>
              );
            }}
          />
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingTop: 52, paddingHorizontal: 16 },
  header: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  title: { fontSize: 20, fontWeight: '700' },
  currentBar: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginBottom: 10,
  },
  currentBarText: { flex: 1, fontSize: 12, fontWeight: '800', textAlign: 'right' },
  search: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, height: 44, fontSize: 14, textAlign: 'right' },
  filterRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10, marginVertical: 8, flexWrap: 'wrap' },
  filterText: { fontSize: 13 },
  probeBtn: { flexDirection: 'row-reverse', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
  probeText: { fontSize: 12, fontWeight: '700' },
  loader: { marginTop: 40 },
  error: { textAlign: 'center', marginTop: 40, fontSize: 13, lineHeight: 20 },
  empty: { textAlign: 'center', marginTop: 40, fontSize: 13 },
  gridContent: { gap: 10, paddingBottom: 24 },
  gridRow: { gap: 10 },
  card: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 16,
    padding: 12,
    gap: 6,
    alignItems: 'flex-end',
    minHeight: 108,
  },
  cardTop: { flexDirection: 'row-reverse', alignItems: 'center', gap: 6, width: '100%' },
  freeBadge: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 4,
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  crownBadge: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 4,
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  badgeText: { fontSize: 10, fontWeight: '800' },
  cardName: { fontSize: 13.5, fontWeight: '700', textAlign: 'right', width: '100%' },
  cardId: { fontSize: 10.5, textAlign: 'right', width: '100%' },
  cardMeta: { fontSize: 10.5, lineHeight: 15, textAlign: 'right', width: '100%' },
  currentTag: { fontSize: 10.5, fontWeight: '800', textAlign: 'right' },
  ltr: { writingDirection: 'ltr' },
});
