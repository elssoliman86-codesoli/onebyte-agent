import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import Svg, { Circle, Defs, Path, RadialGradient, Stop } from 'react-native-svg';
import * as ImagePicker from 'expo-image-picker';
import {
  useAssistant,
  type ChatMessage,
  type ChatSession,
  type ToolStep,
} from '@/src/assistant';
import { storage } from '@/src/storage';
import { getStoredModelApiKey } from '@/src/assistant';
import { runAgent, type ApprovalDecision } from '@/src/agent';
import {
  describeCall,
  executeTool,
  needsApproval,
  toolsForRequest,
  type ToolSpec,
} from '@/src/tools';
import {
  buildAssistantSystemPrompt,
  toProviderMessages,
} from '@/src/model-provider';
import { estimateTokens, planContext, summariseBacklog, workingBudget } from '@/src/context';
import * as Device from '@/src/device';
import { scheduleTaskReminder } from '@/src/task-reminders';
import { formatContext } from '@/src/model-catalog';
import { ModelPicker } from '@/components/ModelPicker';
import { CodeBlock } from '@/components/CodeBlock';
import { MermaidBlock } from '@/components/MermaidBlock';
import { HtmlPreview } from '@/components/HtmlPreview';
import {
  collectTimeline,
  publishRunState,
  setComposerSink,
  STEP_META_ROW as STEP_META,
  timeAgo,
  TOOL_LABELS,
} from './shared';
import {
  desktopColors,
  desktopRadius,
  desktopSpacing,
  desktopTypography,
  orbGradient,
  withAlpha,
} from './DesktopTokens';

/* ─────────────────────────── ids / time ─────────────────────────── */

let idCounter = 0;
function makeId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now()}-${idCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  return `${hh}:${mm}`;
}

/* ─────────────────────────── message body (fences + light markdown) ─────────────────────────── */

interface Segment {
  kind: 'text' | 'code';
  content: string;
  language?: string;
}

function parseSegments(content: string): Segment[] {
  const segments: Segment[] = [];
  const fence = /```([\w+-]*)\n?([\s\S]*?)(?:```|$)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = fence.exec(content)) !== null) {
    if (match.index > cursor) {
      segments.push({ kind: 'text', content: content.slice(cursor, match.index) });
    }
    segments.push({ kind: 'code', content: match[2] ?? '', language: match[1] || undefined });
    cursor = match.index + match[0].length;
  }
  if (cursor < content.length) {
    segments.push({ kind: 'text', content: content.slice(cursor) });
  }
  return segments;
}

function InlineText({ text }: { text: string }) {
  // Bold (**…**) + inline code (`…`) only — intentionally light.
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`\n]+`)/g).filter(Boolean);
  return (
    <Text style={styles.mdText}>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return (
            <Text key={i} style={styles.mdBold}>
              {part.slice(2, -2)}
            </Text>
          );
        }
        if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
          return (
            <Text key={i} style={styles.mdInlineCode}>
              {part.slice(1, -1)}
            </Text>
          );
        }
        return <Text key={i}>{part}</Text>;
      })}
    </Text>
  );
}

function TextBlock({ content }: { content: string }) {
  const lines = content.split('\n');
  const nodes: React.ReactNode[] = [];
  let list: string[] = [];
  let listOrdered = false;

  const flushList = () => {
    if (!list.length) return;
    nodes.push(
      <View key={`l-${nodes.length}`} style={styles.mdList}>
        {list.map((item, i) => (
          <View key={i} style={styles.mdListItem}>
            <Text style={styles.mdListMarker}>{listOrdered ? `${i + 1}.` : '•'}</Text>
            <InlineText text={item} />
          </View>
        ))}
      </View>,
    );
    list = [];
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) {
      flushList();
      continue;
    }
    const heading = line.match(/^#{1,4}\s+(.*)$/);
    const bullet = line.match(/^\s*(?:[-•*])\s+(.*)$/);
    const numbered = line.match(/^\s*(\d+)[.)]\s+(.*)$/);
    if (heading) {
      flushList();
      nodes.push(
        <Text key={`h-${nodes.length}`} style={styles.mdHeading}>
          {heading[1]}
        </Text>,
      );
      continue;
    }
    if (bullet) {
      if (listOrdered) flushList();
      listOrdered = false;
      list.push(bullet[1]);
      continue;
    }
    if (numbered) {
      if (!listOrdered) flushList();
      listOrdered = true;
      list.push(numbered[2]);
      continue;
    }
    flushList();
    nodes.push(<InlineText key={`t-${nodes.length}`} text={line} />);
  }
  flushList();
  return <View style={{ gap: 4 }}>{nodes}</View>;
}

/* ─────────────────────────── tool steps ─────────────────────────── */

function StepRow({ step }: { step: ToolStep }) {
  const [open, setOpen] = useState(false);
  const meta = STEP_META[step.status];
  const isRunning = step.status === 'running';
  return (
    <View style={styles.stepRow}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`تفاصيل ${TOOL_LABELS[step.tool] ?? step.tool}`}
        onPress={() => setOpen((v) => !v)}
        style={styles.stepMain}
      >
        {isRunning ? (
          <ActivityIndicator size={11} color={meta.color} />
        ) : (
          <Feather name={meta.icon} size={12} color={meta.color} />
        )}
        <Text style={styles.stepTool}>{TOOL_LABELS[step.tool] ?? step.tool}</Text>
        <Text style={styles.stepStatus}>{meta.label}</Text>
        <Feather name={open ? 'chevron-up' : 'chevron-down'} size={12} color={desktopColors.textMuted} />
      </Pressable>
      {open ? (
        <View style={styles.stepDetails}>
          {Object.keys(step.args ?? {}).length > 0 ? (
            <Text style={styles.stepArgs} selectable>
              {describeCall(step.tool, step.args)}
            </Text>
          ) : null}
          {step.result ? (
            <Text style={styles.stepResult} selectable numberOfLines={12}>
              {step.result}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/* ─────────────────────────── message bubble ─────────────────────────── */

function DesktopBubble({
  message,
  onPreview,
}: {
  message: ChatMessage;
  onPreview: (html: string) => void;
}) {
  const isUser = message.role === 'user';
  const segments = useMemo(() => parseSegments(message.content), [message.content]);
  return (
    <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAssistant]}>
      <View style={styles.bubbleHead}>
        <Text style={[styles.bubbleRole, isUser && styles.bubbleRoleUser]}>
          {isUser ? 'أنت' : 'OneByte'}
        </Text>
        <Text style={styles.bubbleTime}>{formatTime(message.createdAt)}</Text>
        {message.skill ? <Text style={styles.skillChip}>{message.skill}</Text> : null}
      </View>
      {message.imageUri ? (
        <Image source={{ uri: message.imageUri }} style={styles.bubbleImage} resizeMode="contain" />
      ) : null}
      {message.steps && message.steps.length > 0 ? (
        <View style={[styles.bubbleSteps, { gap: 2 }]}>
          {message.steps.map((step) => (
            <StepRow key={step.id} step={step} />
          ))}
        </View>
      ) : null}
      <View style={{ gap: 6 }}>
        {segments.map((segment, i) =>
          segment.kind === 'code' ? (
            segment.language === 'mermaid' ? (
              <MermaidBlock key={i} source={segment.content} />
            ) : (
              <CodeBlock
                key={i}
                code={segment.content}
                language={segment.language}
                onPreview={segment.language === 'html' ? onPreview : undefined}
              />
            )
          ) : (
            <TextBlock key={i} content={segment.content} />
          ),
        )}
      </View>
      {message.thinking ? (
        <View style={styles.thinkingWrap}>
          <Text style={styles.thinkingLabel}>التفكير</Text>
          <Text style={styles.thinkingText} selectable numberOfLines={8}>
            {message.thinking}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/* ─────────────────────────── approval dialog ─────────────────────────── */

interface ApprovalRequest {
  spec: ToolSpec;
  args: Record<string, unknown>;
  resolve: (decision: ApprovalDecision) => void;
}

function DesktopApprovalDialog({ request, onDecide }: { request: ApprovalRequest | null; onDecide: (decision: ApprovalDecision) => void }) {
  if (!request) return null;
  const { spec, args } = request;
  return (
    <View style={styles.approvalBackdrop}>
      <View style={styles.approvalPanel}>
        <View style={styles.approvalHead}>
          <Feather name="shield" size={15} color={desktopColors.warning} />
          <Text style={styles.approvalTitle}>موافقة على إجراء</Text>
        </View>
        <Text style={styles.approvalTool}>{spec.label}</Text>
        <ScrollView style={styles.approvalBody} showsVerticalScrollIndicator>
          <Text style={styles.approvalArgs} selectable>
            {describeCall(spec.name, args)}
          </Text>
        </ScrollView>
        <View style={styles.approvalActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="رفض الإجراء"
            onPress={() => onDecide('deny')}
            style={[styles.approvalBtn, styles.approvalDeny]}
          >
            <Text style={styles.approvalBtnText}>رفض</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="موافقة حتى نهاية المهمة"
            onPress={() => onDecide('turn')}
            style={[styles.approvalBtn, styles.approvalTurn]}
          >
            <Text style={styles.approvalBtnText}>حتى نهاية المهمة</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="موافقة مرة واحدة"
            onPress={() => onDecide('once')}
            style={[styles.approvalBtn, styles.approvalOnce]}
          >
            <Text style={styles.approvalBtnText}>مرة واحدة</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="موافقة دائمة لهذه الأداة"
            onPress={() => onDecide('always')}
            style={[styles.approvalBtn, styles.approvalAlways]}
          >
            <Text style={styles.approvalBtnText}>دائمًا</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

/* ─────────────────────────── hero (empty-session home) ─────────────────────────── */

/** Decorative marbled emerald orb (SVG, deterministic across platforms). */
function HeroOrb({ size = 180 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 190 190">
      <Defs>
        <RadialGradient id="obGlow" cx="50%" cy="50%" r="50%">
          <Stop offset="0%" stopColor={orbGradient.mid} stopOpacity="0.28" />
          <Stop offset="60%" stopColor={orbGradient.mid} stopOpacity="0.09" />
          <Stop offset="100%" stopColor={orbGradient.mid} stopOpacity="0" />
        </RadialGradient>
        <RadialGradient id="obCore" cx="42%" cy="36%" r="72%">
          <Stop offset="0%" stopColor={orbGradient.core} stopOpacity="0.95" />
          <Stop offset="42%" stopColor={orbGradient.mid} stopOpacity="0.85" />
          <Stop offset="100%" stopColor={orbGradient.deep} stopOpacity="0.96" />
        </RadialGradient>
      </Defs>
      <Circle cx="95" cy="95" r="93" fill="url(#obGlow)" />
      <Circle cx="95" cy="95" r="62" fill="url(#obCore)" />
      <Circle cx="95" cy="95" r="62" fill="none" stroke={orbGradient.rim} strokeWidth="1" />
      <Path
        d="M45 78 C 70 40, 130 42, 148 82"
        stroke={orbGradient.swirl}
        strokeWidth="2.5"
        fill="none"
        strokeLinecap="round"
      />
      <Path
        d="M40 108 C 78 146, 128 140, 152 100"
        stroke={orbGradient.rim}
        strokeWidth="3"
        fill="none"
        strokeLinecap="round"
      />
      <Path
        d="M62 60 C 90 52, 118 58, 134 76"
        stroke="rgba(209,250,229,0.30)"
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
      />
    </Svg>
  );
}

type QuickActionKey = 'code' | 'task' | 'image' | 'skill' | 'memory';

const QUICK_ACTIONS: { key: QuickActionKey; icon: React.ComponentProps<typeof Feather>['name']; title: string; subtitle: string }[] = [
  { key: 'code', icon: 'code', title: 'اكتب كودًا', subtitle: 'بناء وتصحيح' },
  { key: 'task', icon: 'play', title: 'شغّل مهمة', subtitle: 'تنفيذ بوكيل' },
  { key: 'image', icon: 'image', title: 'حلل صورة', subtitle: 'استخراج معلومات' },
  { key: 'skill', icon: 'box', title: 'استخدم مهارة', subtitle: 'استكشاف القدرات' },
  { key: 'memory', icon: 'database', title: 'ابحث في الذاكرة', subtitle: 'سياق محفوظ' },
];

function greetingForNow(): string {
  const h = new Date().getHours();
  if (h < 12) return 'صباح الخير';
  if (h < 18) return 'طاب يومك';
  return 'مساء الخير';
}

function HeroHome({
  connected,
  onQuickAction,
  activity,
  onOpenPicker,
}: {
  connected: boolean;
  onQuickAction: (key: QuickActionKey) => void;
  activity: { step: ToolStep; at: string }[];
  onOpenPicker: () => void;
}) {
  const assistant = useAssistant();
  const provider = assistant.provider;
  const hasModel = Boolean(provider.model.trim());
  const ctx = provider.contextLength ? ` · ${formatContext(provider.contextLength)}` : ' · السياق غير معلن';

  return (
    <ScrollView
      style={styles.heroScroll}
      contentContainerStyle={styles.heroContent}
      showsVerticalScrollIndicator={false}
    >
      <HeroOrb size={180} />
      <Text style={styles.heroGreeting}>{greetingForNow()} 👋</Text>
      <Text style={styles.heroTitle}>جاهز لبناء شيء رائع؟</Text>
      <Text style={styles.heroSubtitle}>
        أنا مساعد OneByte — أستطيع البرمجة والتحليل والتنفيذ الآلي. ماذا تريد أن نفعل اليوم؟
      </Text>

      <View style={styles.quickRow}>
        {QUICK_ACTIONS.map((action) => (
          <Pressable
            key={action.key}
            accessibilityRole="button"
            accessibilityLabel={action.title}
            onPress={() => onQuickAction(action.key)}
            style={(state) => {
              const s = state as { hovered?: boolean; focused?: boolean };
              return [styles.quickCard, (s.hovered || s.focused) && styles.quickCardHover];
            }}
          >
            <View style={styles.quickIcon}>
              <Feather name={action.icon} size={14} color={desktopColors.accentHover} />
            </View>
            <Text style={styles.quickTitle}>{action.title}</Text>
            <Text style={styles.quickSub}>{action.subtitle}</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.modelCard}>
        <View style={styles.modelCardIcon}>
          <Feather name="zap" size={15} color={desktopColors.accentHover} />
        </View>
        <View style={styles.modelCardCopy}>
          <Text style={styles.modelCardLabel}>الموديل الحالي</Text>
          <Text style={styles.modelCardName} numberOfLines={1}>
            {hasModel ? provider.model : 'لم يتم اختيار موديل'}
          </Text>
          <Text style={styles.modelCardSub} numberOfLines={1}>
            {`${provider.providerName || 'مزود'}${ctx}`}
          </Text>
        </View>
        <View style={styles.connection}>
          <View
            style={[
              styles.statusDot,
              { backgroundColor: connected ? desktopColors.success : desktopColors.warning },
            ]}
          />
          <Text style={styles.connectionText}>{connected ? 'متصل' : 'غير مضبوط'}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="تغيير الموديل"
          onPress={onOpenPicker}
          style={styles.modelCardBtn}
        >
          <Text style={styles.modelCardBtnText}>تغيير</Text>
          <Feather name="chevron-down" size={12} color={desktopColors.text} />
        </Pressable>
      </View>

      <View style={styles.activityCard}>
        <View style={styles.activityHead}>
          <View style={styles.activityHeadIcon}>
            <Feather name="activity" size={13} color={desktopColors.accentHover} />
          </View>
          <Text style={styles.activityTitle}>النشاط الأخير</Text>
        </View>
        {activity.length === 0 ? (
          <Text style={styles.activityEmpty}>لا نشاط بعد — نفّذ أول مهمة من صندوق الكتابة.</Text>
        ) : (
          activity.map(({ step, at }) => {
            const meta = STEP_META[step.status];
            return (
              <View key={`${step.id}-${at}`} style={styles.activityRow}>
                <View style={styles.activityRowIcon}>
                  <Feather name={step.tool === 'web_search' ? 'globe' : step.tool === 'web_fetch' ? 'link' : step.tool === 'save_memory' ? 'database' : step.tool === 'create_task' ? 'calendar' : 'zap'} size={12} color={desktopColors.textMuted} />
                </View>
                <View style={styles.activityRowCopy}>
                  <Text style={styles.activityRowTitle} numberOfLines={1}>
                    {TOOL_LABELS[step.tool] ?? step.tool}
                  </Text>
                  <Text style={styles.activityRowMeta}>
                    {`أداة · ${timeAgo(at)}`}
                  </Text>
                </View>
                <View style={[styles.activityChip, { borderColor: withAlpha(meta.color, 0.5), backgroundColor: withAlpha(meta.color, 0.12) }]}>
                  <Text style={[styles.activityChipText, { color: meta.color }]}>{meta.label}</Text>
                </View>
              </View>
            );
          })
        )}
      </View>
    </ScrollView>
  );
}

/* ─────────────────────────── main chat screen ─────────────────────────── */

export function DesktopChat() {
  const assistant = useAssistant();
  const {
    activeSession,
    provider,
    skills,
    memories,
    sessions,
    agent,
    appearance,
    apiKeyConfigured,
    createSession,
    appendMessage,
    patchSession,
    saveProvider,
    createMemory,
    createTask,
    setTaskActive,
    saveAgentSettings,
    loading,
    pendingPrompt,
    consumePendingPrompt,
  } = assistant;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [running, setRunning] = useState(false);
  const [pendingText, setPendingText] = useState('');
  const [pendingThinking, setPendingThinking] = useState('');
  const [steps, setSteps] = useState<ToolStep[]>([]);
  const [error, setError] = useState('');
  const [approval, setApproval] = useState<ApprovalRequest | null>(null);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [attaching, setAttaching] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const approvalRef = useRef<ApprovalRequest | null>(null);
  const runSessionRef = useRef<string | null>(null);
  const composerInputRef = useRef<TextInput>(null);

  // Sync local mirror when the active session changes (same contract as mobile ChatScreen).
  useEffect(() => {
    setMessages(activeSession?.messages ?? []);
    setError('');
  }, [activeSession?.id, activeSession?.messages.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (pendingPrompt) {
      setDraft(pendingPrompt);
      consumePendingPrompt();
      requestAnimationFrame(() => composerInputRef.current?.focus());
    }
  }, [pendingPrompt, consumePendingPrompt]);

  const configured = Boolean(provider.baseUrl.trim()) && (Boolean(provider.keyless) || apiKeyConfigured);
  const canSend = configured && !running && draft.trim().length > 0 && !loading;

  /* ---- approval flow (desktop) ---- */

  const requestApproval = useCallback(
    (spec: ToolSpec, args: Record<string, unknown>): Promise<ApprovalDecision> => {
      const autoKey =
        spec.name === 'open_app' && typeof args.package === 'string'
          ? `open_app:${args.package}`
          : spec.name;
      if (agent.autoApprovedTools.includes(autoKey)) return Promise.resolve('once');
      return new Promise<ApprovalDecision>((resolve) => {
        const request: ApprovalRequest = {
          spec,
          args,
          resolve: (decision) => {
            approvalRef.current = null;
            setApproval(null);
            resolve(decision);
          },
        };
        approvalRef.current = request;
        setApproval(request);
      });
    },
    [agent.autoApprovedTools],
  );

  const decideApproval = useCallback(
    (decision: ApprovalDecision) => {
      const current = approvalRef.current;
      if (!current) return;
      if (decision === 'always') {
        const autoKey =
          current.spec.name === 'open_app' && typeof current.args.package === 'string'
            ? `open_app:${current.args.package}`
            : current.spec.name;
        if (!agent.autoApprovedTools.includes(autoKey)) {
          void saveAgentSettings({
            autoApprovedTools: [...agent.autoApprovedTools, autoKey],
          });
        }
      }
      current.resolve(decision);
    },
    [agent.autoApprovedTools, saveAgentSettings],
  );

  /* ---- the agent turn (same engine as the phone app) ---- */

  const runTurn = useCallback(
    async (session: ChatSession, text: string, imageUri?: string) => {
      const controller = new AbortController();
      abortRef.current = controller;
      runSessionRef.current = session.id;
      setRunning(true);
      setPendingText('');
      setPendingThinking('');
      setSteps([]);
      setError('');
      publishRunState(true);

      try {
        const apiKey = provider.keyless ? '' : await getStoredModelApiKey();
        // Desktop (web) runtime: local + memory + net tools only.
        // Android-only device tools are never advertised on Windows.
        const specs = toolsForRequest(false);
        const promptOptions = {
          deviceControl: false,
          deviceAvailable: Device.isAvailable(),
          responseStyle: agent.responseStyle,
          replyLanguage: appearance?.language,
          mode: (activeSession?.mode as import('@/src/modes').StudioMode | undefined) ?? undefined,
        } as const;
        let system = buildAssistantSystemPrompt(skills, memories, promptOptions);
        const budget = workingBudget(provider, agent.maxWorkingTokens);
        const userMessage: import('@/src/assistant').ChatMessage = {
          id: `temp-${Date.now()}`,
          role: 'user',
          content: text,
          createdAt: new Date().toISOString(),
          imageUri,
        };
        const plan = planContext(session, [userMessage], estimateTokens(system), budget);

        let summary = session.summary ?? '';
        if (plan.toSummarise.length) {
          summary = await summariseBacklog({
            settings: provider,
            apiKey,
            previousSummary: summary,
            messages: plan.toSummarise,
            chunkTokens: Math.floor(budget * 0.5),
            signal: controller.signal,
          });
          system = buildAssistantSystemPrompt(skills, memories, {
            ...promptOptions,
            summary,
          });
        }
        if (plan.processedCount > 0) {
          await patchSession(session.id, {
            summary,
            summarizedCount: (session.summarizedCount ?? 0) + plan.processedCount,
            contextPreservedMessageIds: plan.preservedMessageIds,
          });
        }

        const stored = await storage.loadCheckpoint();
        const checkpoint = stored && stored.sessionId === session.id ? stored : null;

        const result = await runAgent({
          settings: provider,
          apiKey,
          messages: [{ role: 'system', content: system }, ...toProviderMessages(plan.recent)],
          specs,
          maxSteps: agent.maxSteps,
          execute: (name, args) =>
            executeTool(name, args, {
              skills,
              memories,
              sessions,
              createMemory,
              createTask: async (input) => {
                const taskId = await createTask(input);
                const reminder = await scheduleTaskReminder({
                  id: taskId,
                  title: input.title,
                  time: input.time,
                });
                await setTaskActive(taskId, reminder.scheduled, reminder.notificationId);
                return reminder.message;
              },
            }),
          requestApproval,
          onText: (full) => setPendingText(full),
          onThinking: (chunk) => setPendingThinking((t) => t + chunk),
          onStep: (s) => setSteps(s),
          signal: controller.signal,
          checkpoint,
          sessionId: session.id,
          originalUserMessage: text,
        });

        const finalMessage: ChatMessage = {
          id: makeId('msg'),
          role: 'assistant',
          content: result.text || '—',
          createdAt: new Date().toISOString(),
          steps: result.steps.length ? result.steps : undefined,
          thinking: result.thinking || undefined,
        };
        await appendMessage(session.id, finalMessage);
      } catch (caught) {
        const aborted = controller.signal.aborted;
        const partial = pendingTextRef.current.trim();
        const message = caught instanceof Error ? caught.message : String(caught);
        if (aborted) {
          await appendMessage(session.id, {
            id: makeId('msg'),
            role: 'assistant',
            content: partial ? `${partial}\n\n■ أوقفتِ المهمة.` : '■ أوقفتِ المهمة.',
            createdAt: new Date().toISOString(),
            steps: stepsRef.current.length ? stepsRef.current : undefined,
          });
        } else {
          setError(message);
          await appendMessage(session.id, {
            id: makeId('msg'),
            role: 'assistant',
            content: `⚠️ ${message}`,
            createdAt: new Date().toISOString(),
            steps: stepsRef.current.length ? stepsRef.current : undefined,
          });
        }
      } finally {
        if (runSessionRef.current === session.id) {
          setRunning(false);
          setPendingText('');
          setPendingThinking('');
          setSteps([]);
          publishRunState(false);
        }
        abortRef.current = null;
        runSessionRef.current = null;
      }
    },
    [
      agent.maxSteps,
      appendMessage,
      createMemory,
      createTask,
      memories,
      patchSession,
      provider,
      requestApproval,
      skills,
      sessions,
    ],
  );

  // Refs mirroring streaming state so the catch block never reads a stale closure.
  const pendingTextRef = useRef('');
  const stepsRef = useRef<ToolStep[]>([]);
  useEffect(() => {
    pendingTextRef.current = pendingText;
  }, [pendingText]);
  useEffect(() => {
    stepsRef.current = steps;
  }, [steps]);

  /* ---- hero quick actions & shared composer channel ---- */

  useEffect(() => {
    setComposerSink((p) => {
      setDraft((cur) => (cur ? `${cur} ${p.text}` : p.text));
      if (p.focus) composerInputRef.current?.focus();
    });
    return () => setComposerSink(null);
  }, []);

  const heroActivity = useMemo(
    () => collectTimeline(activeSession?.messages ?? [], 4),
    [activeSession?.messages],
  );

  /* ---- send ---- */

  const send = useCallback(() => {
    const text = draft.trim();
    if (!canSend) return;
    const imageUri = pendingImageRef.current ?? undefined;
    const userMessage: ChatMessage = {
      id: makeId('msg'),
      role: 'user',
      content: text,
      createdAt: new Date().toISOString(),
      imageUri,
    };
    setDraft('');
    setPendingImage(null);
    void (async () => {
      // First message on a fresh install: create the session instead of
      // silently swallowing the composer text.
      let target = activeSession;
      if (!target) {
        const newId = await createSession();
        target = {
          id: newId,
          title: 'محادثة جديدة',
          messages: [],
          createdAt: userMessage.createdAt,
          updatedAt: userMessage.createdAt,
        };
      }
      await appendMessage(target.id, userMessage);
      await runTurn(target, text, imageUri);
    })();
  }, [activeSession, appendMessage, canSend, createSession, draft, runTurn]);

  const pendingImageRef = useRef<string | null>(null);
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  useEffect(() => {
    pendingImageRef.current = pendingImage;
  }, [pendingImage]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  /* ---- image attach (web-supported) ---- */

  const attachImage = useCallback(async () => {
    if (attaching || running) return;
    setAttaching(true);
    try {
      const permission = await ImagePicker.getMediaLibraryPermissionsAsync();
      let granted = permission.granted;
      if (!granted && permission.canAskAgain) {
        granted = (await ImagePicker.requestMediaLibraryPermissionsAsync()).granted;
      }
      if (!granted) {
        setError('لم يتم السماح بالوصول إلى الصور.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        base64: true,
        quality: 0.7,
      });
      if (!result.canceled) {
        const asset = result.assets[0];
        if (asset.base64) {
          const mime = asset.mimeType ?? 'image/jpeg';
          setPendingImage(`data:${mime};base64,${asset.base64}`);
        } else {
          setError('تعذّر قراءة الصورة في نسخة سطح المكتب.');
        }
      }
    } catch {
      setError('تعذّر اختيار الصورة.');
    } finally {
      setAttaching(false);
    }
  }, [attaching, running]);

  const onQuickAction = useCallback(
    (key: QuickActionKey) => {
      if (key === 'code') {
        setDraft('اكتب لي كودًا جاهز التنفيذ من أجل: ');
        composerInputRef.current?.focus();
      } else if (key === 'task') {
        setDraft('نفّذ المهمة التالية: ');
        composerInputRef.current?.focus();
      } else if (key === 'image') {
        void attachImage();
      } else if (key === 'skill') {
        router.push('/(tabs)/skills');
      } else if (key === 'memory') {
        router.push('/(tabs)/memory');
      }
    },
    [attachImage],
  );

  /* ---- composer keyboard: Enter sends, Shift+Enter newlines (web) ---- */

  const onComposerKey = useCallback(
    (e: { nativeEvent: { key: string }; preventDefault: () => void }) => {
      if (Platform.OS !== 'web') return;
      if (e.nativeEvent.key === 'Enter') {
        const shift = (e.nativeEvent as unknown as { shiftKey?: boolean }).shiftKey;
        if (!shift) {
          e.preventDefault();
          send();
        }
      }
    },
    [send],
  );

  /* ---- render ---- */

  const reversed = useMemo(() => [...messages].reverse(), [messages]);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'web' ? undefined : 'padding'}
      style={styles.chatRoot}
    >
      {/* configuration banner */}
      {!configured ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="الذهاب إلى الإعدادات"
          onPress={() => router.push('/(tabs)/settings')}
          style={styles.configBanner}
        >
          <Feather name="alert-circle" size={14} color={desktopColors.warning} />
          <Text style={styles.configBannerText}>
            اربط مزودًا أو مفتاح API من الإعدادات لتفعيل الشات.
          </Text>
          <Feather name="chevron-left" size={14} color={desktopColors.textMuted} />
        </Pressable>
      ) : null}

      {/* messages */}
      {messages.length === 0 && !running ? (
        <HeroHome
          connected={configured}
          onQuickAction={onQuickAction}
          activity={heroActivity}
          onOpenPicker={() => setPickerVisible(true)}
        />
      ) : (
        <FlatList
          data={reversed}
          inverted
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => <DesktopBubble message={item} onPreview={(html) => setPreviewHtml(html)} />}
          ListHeaderComponent={
            running ? (
              <View style={styles.pendingBubble}>
                {steps.map((step) => (
                  <StepRow key={step.id} step={step} />
                ))}
                {pendingThinking ? (
                  <Text style={styles.pendingThinking} numberOfLines={3}>
                    {pendingThinking}
                  </Text>
                ) : null}
                {pendingText ? (
                  <View style={{ gap: 6 }}>
                    {parseSegments(pendingText).map((segment, i) =>
                      segment.kind === 'code' ? (
                        <CodeBlock key={i} code={segment.content} language={segment.language} />
                      ) : (
                        <TextBlock key={i} content={segment.content} />
                      ),
                    )}
                  </View>
                ) : (
                  <View style={styles.pendingRow}>
                    <ActivityIndicator size={11} color={desktopColors.accentHover} />
                    <Text style={styles.pendingLabel}>يعمل…</Text>
                  </View>
                )}
              </View>
            ) : null
          }
        />
      )}

      {/* error strip */}
      {error ? (
        <View style={styles.errorStrip}>
          <Feather name="alert-triangle" size={13} color={desktopColors.error} />
          <Text style={styles.errorText} numberOfLines={3}>
            {error}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="إخفاء الخطأ"
            onPress={() => setError('')}
            style={styles.errorClose}
          >
            <Feather name="x" size={13} color={desktopColors.textMuted} />
          </Pressable>
        </View>
      ) : null}

      {/* image preview chip */}
      {pendingImage ? (
        <View style={styles.attachRow}>
          <View style={styles.attachChip}>
            <Feather name="image" size={13} color={desktopColors.accentHover} />
            <Text style={styles.attachText}>صورة مرفقة</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="إزالة الصورة"
              onPress={() => setPendingImage(null)}
              style={styles.attachRemove}
            >
              <Feather name="x" size={12} color={desktopColors.textMuted} />
            </Pressable>
          </View>
        </View>
      ) : null}

      {/* composer */}
      <View style={styles.composer}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="إرفاق صورة"
          onPress={() => void attachImage()}
          style={styles.composerIcon}
          disabled={running || attaching}
        >
          {attaching ? (
            <ActivityIndicator size={13} color={desktopColors.accentHover} />
          ) : (
            <Feather name="image" size={16} color={running ? desktopColors.textMuted : desktopColors.accentHover} />
          )}
        </Pressable>
        <View style={styles.inputSurface}>
          <TextInput
            ref={composerInputRef}
            value={draft}
            onChangeText={setDraft}
            onKeyPress={onComposerKey}
            placeholder={configured ? 'اكتب طلبك… (Enter للإرسال، Shift+Enter لسطر جديد)' : 'أكمل الإعداد أولًا…'}
            placeholderTextColor={desktopColors.textMuted}
            multiline
            editable={!running && !loading}
            style={styles.composerInput}
            accessibilityLabel="صندوق الكتابة"
          />
        </View>
        {running ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="إيقاف التوليد"
            onPress={stop}
            style={[styles.sendBtn, styles.stopBtn]}
          >
            <Feather name="stop-circle" size={15} color="#FFFFFF" />
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="إرسال"
            onPress={send}
            disabled={!canSend}
            style={[styles.sendBtn, !canSend && styles.sendBtnDisabled]}
          >
            <Feather name="arrow-up-circle" size={16} color="#FFFFFF" />
          </Pressable>
        )}
      </View>

      {/* model picker (existing component) */}
      <Modal visible={pickerVisible} transparent animationType="fade" onRequestClose={() => setPickerVisible(false)}>
        <View style={styles.pickerLayer}>
          <View style={styles.pickerPanel}>
            <ModelPicker
              visible={pickerVisible}
              baseUrl={provider.baseUrl}
              currentModel={provider.model}
              getApiKey={async () => {
                if (provider.keyless) return '';
                try {
                  return await getStoredModelApiKey();
                } catch {
                  return (await storage.readApiKey()) ?? '';
                }
              }}
              onClose={() => setPickerVisible(false)}
              onPick={(model) => {
                void saveProvider({
                  ...provider,
                  model: model.id,
                  contextLength: model.contextLength,
                  promptPrice: model.promptPrice,
                  completionPrice: model.completionPrice,
                  free: model.free,
                });
                setPickerVisible(false);
              }}
            />
          </View>
        </View>
      </Modal>

      <HtmlPreview visible={previewHtml !== null} html={previewHtml ?? ''} onClose={() => setPreviewHtml(null)} />
      <DesktopApprovalDialog request={approval} onDecide={decideApproval} />
    </KeyboardAvoidingView>
  );
}

export default DesktopChat;

/* ─────────────────────────── styles ─────────────────────────── */

const styles = StyleSheet.create({
  chatRoot: {
    flex: 1,
    backgroundColor: desktopColors.background,
  },
  configBanner: {
    flexShrink: 0,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: desktopSpacing.sm,
    margin: desktopSpacing.md,
    marginBottom: 0,
    padding: desktopSpacing.md,
    borderRadius: desktopRadius.md,
    borderWidth: 1,
    borderColor: withAlpha(desktopColors.warning, 0.5),
    backgroundColor: withAlpha(desktopColors.warning, 0.09),
  },
  configBannerText: { ...desktopTypography.small, color: desktopColors.text },

  listContent: {
    padding: desktopSpacing.xl,
    gap: desktopSpacing.md,
  },

  /* bubbles */
  bubble: {
    borderRadius: desktopRadius.lg,
    borderWidth: 1,
    padding: desktopSpacing.lg,
    gap: desktopSpacing.sm,
  },
  bubbleUser: {
    backgroundColor: withAlpha(desktopColors.accent, 0.13),
    borderColor: withAlpha(desktopColors.accent, 0.42),
    marginLeft: 90,
  },
  bubbleAssistant: {
    backgroundColor: desktopColors.surface,
    borderColor: desktopColors.border,
    marginRight: 40,
  },
  bubbleHead: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: desktopSpacing.sm,
  },
  bubbleRole: { ...desktopTypography.tiny, color: desktopColors.accentHover, fontWeight: '700' },
  bubbleRoleUser: { color: desktopColors.text },
  bubbleTime: { ...desktopTypography.tiny, color: desktopColors.textMuted },
  skillChip: {
    ...desktopTypography.tiny,
    color: desktopColors.success,
    backgroundColor: withAlpha(desktopColors.success, 0.12),
    borderRadius: desktopRadius.full,
    paddingHorizontal: 8,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  bubbleImage: {
    width: '100%',
    height: 220,
    borderRadius: desktopRadius.md,
    backgroundColor: desktopColors.surfaceSecondary,
  },
  bubbleSteps: {
    borderRadius: desktopRadius.md,
    borderWidth: 1,
    borderColor: withAlpha(desktopColors.border, 0.8),
    backgroundColor: withAlpha(desktopColors.background, 0.5),
    padding: desktopSpacing.sm,
  },
  thinkingWrap: {
    borderTopWidth: 1,
    borderTopColor: withAlpha(desktopColors.border, 0.6),
    paddingTop: desktopSpacing.sm,
    gap: 2,
  },
  thinkingLabel: { ...desktopTypography.tiny, color: desktopColors.textMuted },
  thinkingText: { ...desktopTypography.small, color: desktopColors.textMuted, lineHeight: 17 },

  /* markdown */
  mdText: { ...desktopTypography.body, color: desktopColors.text },
  mdBold: { fontWeight: '700', color: desktopColors.text },
  mdInlineCode: {
    fontFamily: 'monospace',
    fontSize: 12.5,
    color: desktopColors.accentHover,
    backgroundColor: withAlpha(desktopColors.accent, 0.1),
  },
  mdHeading: { ...desktopTypography.h2, color: desktopColors.text },
  mdList: { gap: 3 },
  mdListItem: { flexDirection: 'row-reverse', gap: desktopSpacing.sm, alignItems: 'flex-start' },
  mdListMarker: { ...desktopTypography.body, color: desktopColors.accentHover, minWidth: 16, textAlign: 'left' },

  /* steps */
  stepRow: { gap: 3 },
  stepMain: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: desktopSpacing.sm,
    paddingVertical: 2,
  },
  stepTool: { ...desktopTypography.small, color: desktopColors.text, fontWeight: '600' },
  stepStatus: { ...desktopTypography.tiny, color: desktopColors.textMuted },
  stepDetails: {
    padding: desktopSpacing.sm,
    borderRadius: desktopRadius.sm,
    backgroundColor: withAlpha(desktopColors.background, 0.6),
    gap: 3,
  },
  stepArgs: { fontFamily: 'monospace', fontSize: 11, color: desktopColors.textMuted, textAlign: 'left' },
  stepResult: { fontFamily: 'monospace', fontSize: 11, color: desktopColors.text, textAlign: 'left' },

  /* pending */
  pendingBubble: {
    borderRadius: desktopRadius.lg,
    borderWidth: 1,
    borderColor: withAlpha(desktopColors.accent, 0.35),
    backgroundColor: desktopColors.surface,
    padding: desktopSpacing.lg,
    gap: desktopSpacing.sm,
    marginHorizontal: 40,
  },
  pendingRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: desktopSpacing.sm },
  pendingLabel: { ...desktopTypography.small, color: desktopColors.textMuted },
  pendingThinking: {
    ...desktopTypography.small,
    color: desktopColors.textMuted,
    fontFamily: 'monospace',
    textAlign: 'left',
  },

  /* hero (empty-session home, per approved mockup) */
  heroScroll: { flex: 1 },
  heroContent: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: desktopSpacing.xl,
    gap: desktopSpacing.sm,
  },
  heroGreeting: { ...desktopTypography.h2, color: desktopColors.accentHover, marginTop: desktopSpacing.md },
  heroTitle: { ...desktopTypography.h1, color: desktopColors.text },
  heroSubtitle: {
    ...desktopTypography.body,
    color: desktopColors.textMuted,
    textAlign: 'center',
    maxWidth: 480,
    lineHeight: 22,
  },
  quickRow: {
    flexDirection: 'row-reverse',
    gap: desktopSpacing.sm,
    marginTop: desktopSpacing.md,
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  quickCard: {
    width: 118,
    alignItems: 'center',
    gap: 4,
    padding: desktopSpacing.md,
    borderRadius: desktopRadius.lg,
    borderWidth: 1,
    borderColor: desktopColors.border,
    backgroundColor: desktopColors.surfaceSecondary,
  },
  quickCardHover: { borderColor: desktopColors.borderStrong, backgroundColor: desktopColors.surfaceRaised },
  quickIcon: {
    width: 30,
    height: 30,
    borderRadius: desktopRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: desktopColors.accentSoft,
    marginBottom: 2,
  },
  quickTitle: { ...desktopTypography.small, color: desktopColors.text, fontWeight: '700' },
  quickSub: { ...desktopTypography.tiny, color: desktopColors.textMuted },

  /* current model card */
  modelCard: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: desktopSpacing.md,
    width: '92%',
    maxWidth: 620,
    marginTop: desktopSpacing.md,
    padding: desktopSpacing.md,
    borderRadius: desktopRadius.lg,
    borderWidth: 1,
    borderColor: desktopColors.borderStrong,
    backgroundColor: desktopColors.surface,
  },
  modelCardIcon: {
    width: 34,
    height: 34,
    borderRadius: desktopRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: desktopColors.accentSoft,
  },
  modelCardCopy: { flexShrink: 1, gap: 1 },
  modelCardLabel: { ...desktopTypography.tiny, color: desktopColors.textMuted },
  modelCardName: { ...desktopTypography.h3, color: desktopColors.text },
  modelCardSub: { ...desktopTypography.tiny, color: desktopColors.textMuted },
  modelCardBtn: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: desktopRadius.md,
    borderWidth: 1,
    borderColor: desktopColors.borderStrong,
    backgroundColor: desktopColors.surfaceSecondary,
  },
  modelCardBtnText: { ...desktopTypography.small, color: desktopColors.text, fontWeight: '700' },
  connection: { flexDirection: 'row-reverse', alignItems: 'center', gap: 6 },
  connectionText: { ...desktopTypography.tiny, color: desktopColors.textMuted },
  statusDot: { width: 8, height: 8, borderRadius: 4 },

  /* recent activity card */
  activityCard: {
    width: '92%',
    maxWidth: 620,
    marginTop: desktopSpacing.md,
    padding: desktopSpacing.md,
    borderRadius: desktopRadius.lg,
    borderWidth: 1,
    borderColor: desktopColors.border,
    backgroundColor: desktopColors.surface,
    gap: 6,
  },
  activityHead: { flexDirection: 'row-reverse', alignItems: 'center', gap: desktopSpacing.sm },
  activityHeadIcon: {
    width: 26,
    height: 26,
    borderRadius: desktopRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: desktopColors.accentSoft,
  },
  activityTitle: { ...desktopTypography.h3, color: desktopColors.text },
  activityEmpty: {
    ...desktopTypography.small,
    color: desktopColors.textMuted,
    textAlign: 'center',
    paddingVertical: desktopSpacing.md,
  },
  activityRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: desktopSpacing.sm, paddingVertical: 4 },
  activityRowIcon: {
    width: 26,
    height: 26,
    borderRadius: desktopRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: desktopColors.surfaceSecondary,
    borderWidth: 1,
    borderColor: desktopColors.border,
  },
  activityRowCopy: { flexShrink: 1, gap: 1 },
  activityRowTitle: { ...desktopTypography.small, color: desktopColors.text, fontWeight: '600' },
  activityRowMeta: { ...desktopTypography.tiny, color: desktopColors.textMuted },
  activityChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: desktopRadius.full,
    borderWidth: 1,
    overflow: 'hidden',
  },
  activityChipText: { ...desktopTypography.tiny, fontWeight: '700' },

  /* error strip */
  errorStrip: {
    flexShrink: 0,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: desktopSpacing.sm,
    marginHorizontal: desktopSpacing.lg,
    marginBottom: desktopSpacing.sm,
    padding: desktopSpacing.md,
    borderRadius: desktopRadius.md,
    borderWidth: 1,
    borderColor: withAlpha(desktopColors.error, 0.55),
    backgroundColor: withAlpha(desktopColors.error, 0.1),
  },
  errorText: { ...desktopTypography.small, color: desktopColors.text, flexShrink: 1 },
  errorClose: { padding: 3 },

  /* attach chip */
  attachRow: {
    flexShrink: 0,
    flexDirection: 'row-reverse',
    paddingHorizontal: desktopSpacing.lg,
    paddingBottom: desktopSpacing.sm,
  },
  attachChip: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: desktopSpacing.sm,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: desktopRadius.sm,
    borderWidth: 1,
    borderColor: desktopColors.border,
    backgroundColor: desktopColors.surface,
  },
  attachText: { ...desktopTypography.tiny, color: desktopColors.text },
  attachRemove: { padding: 2 },

  /* composer */
  composer: {
    flexShrink: 0,
    flexDirection: 'row-reverse',
    alignItems: 'flex-end',
    gap: desktopSpacing.sm,
    paddingHorizontal: desktopSpacing.lg,
    paddingBottom: desktopSpacing.lg,
    paddingTop: desktopSpacing.sm,
    borderTopWidth: 1,
    borderTopColor: desktopColors.border,
    backgroundColor: desktopColors.surface,
  },
  composerIcon: {
    width: 40,
    height: 40,
    borderRadius: desktopRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: desktopColors.border,
    backgroundColor: desktopColors.surfaceSecondary,
  },
  inputSurface: {
    flex: 1,
    minHeight: 40,
    maxHeight: 140,
    borderRadius: desktopRadius.lg,
    borderWidth: 1,
    borderColor: desktopColors.border,
    backgroundColor: desktopColors.surfaceSecondary,
    paddingHorizontal: desktopSpacing.md,
    paddingVertical: 8,
  },
  composerInput: {
    ...desktopTypography.body,
    color: desktopColors.text,
    textAlign: 'right',
    textAlignVertical: 'top',
    padding: 0,
  },
  sendBtn: {
    width: 42,
    height: 42,
    borderRadius: desktopRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: desktopColors.accent,
  },
  sendBtnDisabled: { backgroundColor: withAlpha(desktopColors.accent, 0.35) },
  stopBtn: { backgroundColor: desktopColors.error },

  /* model picker layer */
  pickerLayer: {
    flex: 1,
    backgroundColor: 'rgba(2,4,8,0.62)',
    alignItems: 'center',
    paddingTop: 80,
  },
  pickerPanel: {
    width: 640,
    maxWidth: '94%',
    height: 560,
    borderRadius: desktopRadius.xl,
    borderWidth: 1,
    borderColor: desktopColors.border,
    backgroundColor: desktopColors.surface,
    overflow: 'hidden',
  },

  /* approval */
  approvalBackdrop: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(2,4,8,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 80,
  },
  approvalPanel: {
    width: 460,
    maxWidth: '92%',
    maxHeight: '76%',
    borderRadius: desktopRadius.xl,
    borderWidth: 1,
    borderColor: withAlpha(desktopColors.warning, 0.6),
    backgroundColor: desktopColors.surface,
    padding: desktopSpacing.lg,
    gap: desktopSpacing.md,
  },
  approvalHead: { flexDirection: 'row-reverse', alignItems: 'center', gap: desktopSpacing.sm },
  approvalTitle: { ...desktopTypography.h2, color: desktopColors.text },
  approvalTool: { ...desktopTypography.h3, color: desktopColors.accentHover },
  approvalBody: { maxHeight: 180, borderRadius: desktopRadius.md, backgroundColor: desktopColors.surfaceSecondary },
  approvalArgs: {
    fontFamily: 'monospace',
    fontSize: 11.5,
    color: desktopColors.text,
    textAlign: 'left',
    padding: desktopSpacing.md,
  },
  approvalActions: { flexDirection: 'row', gap: desktopSpacing.sm, flexWrap: 'wrap' },
  approvalBtn: {
    paddingVertical: 8,
    paddingHorizontal: 13,
    borderRadius: desktopRadius.md,
    borderWidth: 1,
  },
  approvalBtnText: { ...desktopTypography.small, color: '#FFFFFF', fontWeight: '700' },
  approvalDeny: { backgroundColor: withAlpha(desktopColors.error, 0.16), borderColor: desktopColors.error },
  approvalTurn: { backgroundColor: withAlpha(desktopColors.accent, 0.16), borderColor: desktopColors.accent },
  approvalOnce: { backgroundColor: desktopColors.accent, borderColor: desktopColors.accent },
  approvalAlways: { backgroundColor: withAlpha(desktopColors.success, 0.16), borderColor: desktopColors.success },
});
