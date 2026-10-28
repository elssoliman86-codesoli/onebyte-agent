import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { useAssistant } from '@/src/assistant';
import { useWorkspace } from '@/src/workspace';
import { formatContext } from '@/src/model-catalog';

interface SuggestCard {
  id: string;
  label: string;
  sub: string;
  icon: React.ComponentProps<typeof Feather>['name'];
  action: () => void;
}

interface BotCard {
  id: string;
  name: string;
  desc: string;
  onPress: () => void;
}

export function HomeScreen({
  onNewChat,
  onOpenSettings,
  onOpenSkills,
  onOpenTasks,
  onOpenMemory,
  onOpenProviderSelector,
  onSuggest,
  onUseSkill,
}: {
  onNewChat: () => void;
  onOpenSettings: () => void;
  onOpenSkills: () => void;
  onOpenTasks: () => void;
  onOpenMemory: () => void;
  onOpenProviderSelector: () => void;
  /** Prefill the composer with a starter prompt (real action, not navigation). */
  onSuggest: (text: string) => void;
  /** Select an active skill for private assistant context without showing its instructions. */
  onUseSkill: (name: string) => void;
}) {
  const colors = useColors();
  const {
    sessions,
    provider,
    skills,
    memories,
    tasks,
    apiKeyConfigured,
  } = useAssistant();
  const { approvals } = useWorkspace();
  const pendingApprovals = approvals.filter((a) => a.status === 'pending').length;

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'صباح الخير';
    if (hour < 17) return 'طاب يومك';
    return 'مساء الخير';
  };

  const isModelConfigured = Boolean(provider.model) && (apiKeyConfigured || provider.keyless);
  const connected = isModelConfigured;
  const providerName = provider.providerName || 'Custom';
  const modelName = provider.model || 'غير مضبوط';
  const contextLength = formatContext(provider.contextLength);
  const isFreePlan = provider.free ?? false;
  const planLabel = !provider.model
    ? 'لم يتم اختيار موديل'
    : isFreePlan
      ? 'الخطة المجانية'
      : 'خطة مدفوعة';

  const bots: BotCard[] = skills
    .filter((s) => s.active)
    .slice(0, 6)
    .map((skill) => ({
      id: skill.id,
      name: skill.name,
      desc: skill.description || 'مهارة نشطة',
      onPress: () => onUseSkill(skill.name),
    }));

  const suggests: SuggestCard[] = [
    {
      id: 'code',
      label: 'اكتب كودًا',
      sub: 'بناء وتصحيح',
      icon: 'code',
      action: () => onSuggest('اكتب لي كودًا للوجهة التالية: '),
    },
    {
      id: 'task',
      label: 'شغّل مهمة',
      sub: 'تنفيذ بوكيل',
      icon: 'play-circle',
      action: () => onSuggest('نفّذ المهمة التالية خطوة بخطوة: '),
    },
    {
      id: 'memory',
      label: 'ابحث في الذاكرة',
      sub: 'سياق محفوظ',
      icon: 'database',
      action: onOpenMemory,
    },
    {
      id: 'skills',
      label: 'استخدم مهارة',
      sub: 'استكشاف القدرات',
      icon: 'zap',
      action: onOpenSkills,
    },
  ];

  const quickActions = [
    { id: 'tasks', label: 'المهام', desc: 'المهام اليومية', icon: 'check-square' as const, action: onOpenTasks },
    { id: 'memory', label: 'الذاكرة', desc: 'إدارة الذكريات', icon: 'database' as const, action: onOpenMemory },
    { id: 'skills', label: 'المهارات', desc: 'إدارة المهارات', icon: 'zap' as const, action: onOpenSkills },
    { id: 'settings', label: 'الإعدادات', desc: 'ضبط التطبيق', icon: 'settings' as const, action: onOpenSettings },
  ];

  const stats = [
    { label: 'محادثات', value: sessions.length },
    { label: 'مهارات', value: skills.filter((s) => s.active).length },
    { label: 'ذكريات', value: memories.filter((m) => m.active).length },
    { label: 'مهام', value: tasks.filter((t) => t.active).length },
  ];

  return (
    <SafeAreaView edges={['left', 'right']} style={[styles.safe, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header: identity + greeting, bell carries the REAL pending-approvals count */}
        <View style={styles.header}>
          <View style={styles.headerSide}>
            <View style={[styles.avatar, { backgroundColor: colors.accentSubtle, borderColor: colors.borderHighlighted }]}>
              <Text style={[styles.avatarText, { color: colors.primary }]}>O</Text>
            </View>
            <View style={styles.headerCopy}>
              <Text style={[styles.headerTitle, { color: colors.foreground }]}>OneByte Agent</Text>
              <Text style={[styles.headerSubtitle, { color: colors.mutedForeground }]}>
                {getGreeting()} 👋
              </Text>
            </View>
          </View>
          <View style={styles.headerSide}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                pendingApprovals ? `الموافقات — ${pendingApprovals} معلّقة` : 'الموافقات'
              }
              onPress={() => router.push('/(tabs)/approvals')}
              style={[styles.headerButton, { borderColor: colors.border }]}
            >
              <Feather name="bell" size={19} color={colors.foreground} />
              {pendingApprovals > 0 ? (
                <View style={[styles.bellBadge, { backgroundColor: colors.destructive }]}>
                  <Text style={styles.bellBadgeText}>{pendingApprovals > 9 ? '9+' : pendingApprovals}</Text>
                </View>
              ) : null}
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="إعدادات الموديل"
              onPress={onOpenProviderSelector}
              style={[styles.headerButton, { borderColor: colors.border }]}
            >
              <Feather name="cpu" size={19} color={colors.primary} />
            </Pressable>
          </View>
        </View>

        {/* Plan status card — honest: reflects the real provider state, no fake commerce */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="إدارة الموديل"
          onPress={onOpenProviderSelector}
          style={[
            styles.planCard,
            {
              backgroundColor: colors.card,
              borderColor: colors.borderHighlighted,
            },
          ]}
        >
          <View style={[styles.planIcon, { backgroundColor: colors.accentSubtle }]}>
            <Feather name="award" size={20} color={colors.warning} />
          </View>
          <View style={styles.planCopy}>
            <View style={styles.planTitleRow}>
              <Text style={[styles.planTitle, { color: colors.foreground }]}>{planLabel}</Text>
              <View style={[styles.planDot, { backgroundColor: connected ? colors.success : colors.warning }]} />
              <Text style={[styles.planState, { color: connected ? colors.success : colors.warning }]}>
                {connected ? 'متصل' : 'غير مضبوط'}
              </Text>
            </View>
            <Text style={[styles.planSub, { color: colors.mutedForeground }]} numberOfLines={1}>
              {provider.model
                ? `${providerName} · ${modelName} · ${contextLength}`
                : 'اختاري موديلًا مجانيًا وابدئي فورًا'}
            </Text>
          </View>
          <View style={[styles.planCta, { backgroundColor: colors.primary }]}>
            <Text style={[styles.planCtaText, { color: colors.primaryForeground }]}>إدارة</Text>
          </View>
        </Pressable>

        {/* Suggest for you — starter prompts that prefill the composer (real actions) */}
        <View style={styles.sectionHead}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>اقتراحات لك</Text>
        </View>
        <View style={styles.suggestGrid}>
          {suggests.map((s) => (
            <Pressable
              key={s.id}
              accessibilityRole="button"
              accessibilityLabel={s.label}
              onPress={s.action}
              style={[styles.suggestCard, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <View style={[styles.suggestIcon, { backgroundColor: colors.accentSubtle }]}>
                <Feather name={s.icon} size={18} color={colors.primary} />
              </View>
              <Text style={[styles.suggestLabel, { color: colors.foreground }]} numberOfLines={1}>
                {s.label}
              </Text>
              <Text style={[styles.suggestSub, { color: colors.mutedForeground }]} numberOfLines={1}>
                {s.sub}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Popular bots = the user's REAL active skills; tap starts a chat with that skill */}
        <View style={styles.sectionHead}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>بوتاتك النشطة</Text>
          {bots.length ? (
            <Pressable accessibilityRole="button" onPress={onOpenSkills} style={styles.seeAll}>
              <Text style={[styles.seeAllText, { color: colors.primary }]}>عرض الكل</Text>
              <Feather name="chevron-left" size={14} color={colors.primary} />
            </Pressable>
          ) : null}
        </View>
        {bots.length ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.botsRow}
            style={styles.botsScroll}
          >
            {bots.map((bot) => (
              <Pressable
                key={bot.id}
                accessibilityRole="button"
                accessibilityLabel={`محادثة بمهارة ${bot.name}`}
                onPress={bot.onPress}
                style={[styles.botCard, { backgroundColor: colors.card, borderColor: colors.border }]}
              >
                <View style={[styles.botIcon, { backgroundColor: colors.accentSubtle }]}>
                  <Feather name="zap" size={16} color={colors.primary} />
                </View>
                <Text style={[styles.botName, { color: colors.foreground }]} numberOfLines={1}>
                  {bot.name}
                </Text>
                <Text style={[styles.botDesc, { color: colors.mutedForeground }]} numberOfLines={2}>
                  {bot.desc}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="أضف مهارتك الأولى"
            onPress={onOpenSkills}
            style={[styles.botEmpty, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <Feather name="zap" size={17} color={colors.primary} />
            <Text style={[styles.botEmptyText, { color: colors.mutedForeground }]}>
              لا مهارات نشطة بعد — أضف مهارتك الأولى لتظهر هنا كبوت جاهز.
            </Text>
            <Feather name="chevron-left" size={15} color={colors.mutedForeground} />
          </Pressable>
        )}

        {/* Quick actions */}
        <View style={styles.sectionHead}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>أدوات سريعة</Text>
        </View>
        <View style={styles.quickGrid}>
          {quickActions.map((action) => (
            <Pressable
              key={action.id}
              onPress={action.action}
              style={[styles.quickCard, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <View style={[styles.quickIcon, { backgroundColor: colors.accentSubtle }]}>
                <Feather name={action.icon} size={20} color={colors.primary} />
              </View>
              <View style={styles.quickCopy}>
                <Text style={[styles.quickLabel, { color: colors.foreground }]}>{action.label}</Text>
                <Text style={[styles.quickDesc, { color: colors.mutedForeground }]} numberOfLines={1}>
                  {action.desc}
                </Text>
              </View>
              <Feather name="chevron-left" size={15} color={colors.mutedForeground} />
            </Pressable>
          ))}
        </View>

        {/* Start New Chat pill — the mockup's primary CTA */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="ابدأ محادثة جديدة"
          onPress={onNewChat}
          style={[styles.startPill, { backgroundColor: colors.primary }]}
        >
          <Text style={[styles.startPillText, { color: colors.primaryForeground }]}>
            ابدأ محادثة جديدة
          </Text>
          <Feather name="arrow-left" size={17} color={colors.primaryForeground} />
        </Pressable>

        {/* Footer stats — real counts */}
        <View style={[styles.footerStats, { borderTopColor: colors.border }]}>
          {stats.map((stat) => (
            <View key={stat.label} style={styles.statItem}>
              <Text style={[styles.statValue, { color: colors.foreground }]}>{stat.value}</Text>
              <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{stat.label}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

export default HomeScreen;

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scrollContent: { flexGrow: 1, paddingBottom: 24 },
  header: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 14,
    gap: 12,
  },
  headerSide: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10 },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 19, fontWeight: '800' },
  headerCopy: { gap: 2 },
  headerTitle: { fontSize: 16, fontWeight: '700', textAlign: 'right' },
  headerSubtitle: { fontSize: 12 },
  headerButton: {
    width: 40,
    height: 40,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  bellBadge: {
    position: 'absolute',
    top: -3,
    left: -3,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  bellBadgeText: { fontSize: 9, fontWeight: '800', color: '#FFFFFF' },
  planCard: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 11,
    marginHorizontal: 16,
    marginBottom: 18,
    padding: 14,
    borderRadius: 18,
    borderWidth: 1,
  },
  planIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  planCopy: { flex: 1, gap: 3, alignItems: 'flex-end' },
  planTitleRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 7 },
  planTitle: { fontSize: 15, fontWeight: '800', textAlign: 'right' },
  planDot: { width: 7, height: 7, borderRadius: 4 },
  planState: { fontSize: 11, fontWeight: '700' },
  planSub: { fontSize: 11, textAlign: 'right' },
  planCta: {
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 999,
  },
  planCtaText: { fontSize: 12, fontWeight: '800' },
  sectionHead: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  sectionTitle: { fontSize: 16, fontWeight: '800', textAlign: 'right' },
  seeAll: { flexDirection: 'row-reverse', alignItems: 'center', gap: 2 },
  seeAllText: { fontSize: 12, fontWeight: '700' },
  suggestGrid: {
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
    gap: 9,
    marginHorizontal: 16,
    marginBottom: 18,
  },
  suggestCard: {
    width: '48.5%',
    flexGrow: 1,
    borderRadius: 16,
    borderWidth: 1,
    padding: 12,
    alignItems: 'flex-end',
    gap: 7,
  },
  suggestIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  suggestLabel: { fontSize: 13, fontWeight: '700', textAlign: 'right' },
  suggestSub: { fontSize: 10, textAlign: 'right' },
  botsScroll: { marginBottom: 18 },
  botsRow: { paddingHorizontal: 16, gap: 9, paddingRight: 16 },
  botCard: {
    width: 132,
    borderRadius: 16,
    borderWidth: 1,
    padding: 12,
    alignItems: 'flex-end',
    gap: 6,
  },
  botIcon: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  botName: { fontSize: 13, fontWeight: '700', textAlign: 'right', maxWidth: '100%' },
  botDesc: { fontSize: 10, lineHeight: 14, textAlign: 'right' },
  botEmpty: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 9,
    marginHorizontal: 16,
    marginBottom: 18,
    borderWidth: 1,
    borderRadius: 16,
    padding: 13,
  },
  botEmptyText: { flex: 1, fontSize: 11.5, lineHeight: 17, textAlign: 'right' },
  quickGrid: { gap: 9, marginHorizontal: 16, marginBottom: 18 },
  quickCard: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 11,
    borderRadius: 16,
    borderWidth: 1,
    padding: 12,
  },
  quickIcon: {
    width: 40,
    height: 40,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickCopy: { flex: 1, gap: 2, alignItems: 'flex-end' },
  quickLabel: { fontSize: 13, fontWeight: '700', textAlign: 'right' },
  quickDesc: { fontSize: 10.5, textAlign: 'right' },
  startPill: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 18,
    paddingVertical: 14,
    borderRadius: 999,
  },
  startPillText: { fontSize: 14.5, fontWeight: '800' },
  footerStats: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-around',
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderTopWidth: 1,
    marginHorizontal: 16,
  },
  statItem: { alignItems: 'center', gap: 3 },
  statValue: { fontSize: 20, fontWeight: '800' },
  statLabel: { fontSize: 10 },
});
