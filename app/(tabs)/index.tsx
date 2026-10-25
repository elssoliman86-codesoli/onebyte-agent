import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import {
  useAssistant,
  getStoredModelApiKey,
  type ChatMessage,
  type ToolStep,
} from '@/src/assistant';
import {
  buildAssistantSystemPrompt,
  toProviderMessages,
} from '@/src/model-provider';
import { runAgent, type ApprovalDecision } from '@/src/agent';
import { executeTool, toolsForRequest, TOOL_SPECS, type ToolSpec } from '@/src/tools';
import {
  estimateTokens,
  planContext,
  summariseBacklog,
  workingBudget,
} from '@/src/context';
import { formatContext } from '@/src/model-catalog';
import * as Device from '@/src/device';
import { ApprovalSheet, type PendingApproval } from '@/components/ApprovalSheet';
import { CodeBlock } from '@/components/CodeBlock';
import { MermaidBlock } from '@/components/MermaidBlock';

let localMessageCounter = 0;
function messageId() {
  localMessageCounter += 1;
  return `message-${Date.now()}-${localMessageCounter}-${Math.random()
    .toString(36)
    .slice(2, 7)}`;
}

const STEP_ICON: Record<ToolStep['status'], React.ComponentProps<typeof Feather>['name']> = {
  running: 'loader',
  done: 'check-circle',
  error: 'alert-triangle',
  denied: 'slash',
};

function StepList({ steps }: { steps: ToolStep[] }) {
  const colors = useColors();
  return (
    <View style={styles.steps}>
      {steps.map((step) => {
        const label = TOOL_SPECS.find((t) => t.name === step.tool)?.label ?? step.tool;
        const tone =
          step.status === 'done'
            ? colors.success
            : step.status === 'running'
              ? colors.primary
              : step.status === 'denied'
                ? colors.warning
                : colors.destructive;
        return (
          <View key={step.id} style={styles.stepRow}>
            <Text numberOfLines={1} style={[styles.stepText, { color: colors.mutedForeground }]}>
              {label}
            </Text>
            <Feather name={STEP_ICON[step.status]} size={13} color={tone} />
          </View>
        );
      })}
    </View>
  );
}

type MessageSegment =
  | { kind: 'text'; text: string }
  | { kind: 'code'; language?: string; code: string }
  | { kind: 'mermaid'; source: string };

/** Split a message into prose, fenced code blocks and mermaid diagrams. */
function parseSegments(content: string): MessageSegment[] {
  const segments: MessageSegment[] = [];
  const fence = /```([\w+-]*)\n?([\s\S]*?)(?:```|$)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = fence.exec(content)) !== null) {
    if (m.index > last) {
      const text = content.slice(last, m.index).trim();
      if (text) segments.push({ kind: 'text', text });
    }
    const lang = (m[1] || '').toLowerCase();
    const body = (m[2] || '').replace(/\n$/, '');
    if (lang === 'mermaid' || /^\s*(graph|flowchart)\b/.test(body)) {
      segments.push({ kind: 'mermaid', source: body });
    } else if (body.trim()) {
      segments.push({ kind: 'code', language: m[1] || undefined, code: body });
    }
    last = fence.lastIndex;
  }
  const tail = content.slice(last).trim();
  if (tail) segments.push({ kind: 'text', text: tail });
  return segments;
}

function MessageBody({ content, user }: { content: string; user?: boolean }) {
  const segments = parseSegments(content);
  return (
    <>
      {segments.map((seg, i) =>
        seg.kind === 'text' ? (
          <MarkdownText key={i} text={seg.text} user={user} />
        ) : seg.kind === 'code' ? (
          <CodeBlock key={i} code={seg.code} language={seg.language} />
        ) : (
          <MermaidBlock key={i} source={seg.source} />
        ),
      )}
    </>
  );
}

/** Inline markdown: **bold** and `code` spans inside prose. */
function MarkdownText({ text, user }: { text: string; user?: boolean }) {
  const colors = useColors();
  const baseColor = user ? colors.primaryForeground : colors.foreground;
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
  return (
    <Text style={[styles.messageText, { color: baseColor }]}>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return (
            <Text key={i} style={{ fontWeight: '700', color: user ? baseColor : colors.primary }}>
              {part.slice(2, -2)}
            </Text>
          );
        }
        if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
          return (
            <Text
              key={i}
              style={{
                fontFamily: 'monospace',
                fontSize: 12.5,
                backgroundColor: 'rgba(128,128,128,0.16)',
                color: baseColor,
              }}
            >
              {part.slice(1, -1)}
            </Text>
          );
        }
        return <Text key={i}>{part}</Text>;
      })}
    </Text>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const colors = useColors();
  const user = message.role === 'user';
  return (
    <View style={[styles.messageRow, user && styles.userMessageRow]}>
      {!user ? (
        <View style={[styles.avatar, { backgroundColor: colors.accent }]}>
          <Feather name="star" size={14} color={colors.primary} />
        </View>
      ) : null}
      <View
        style={[
          styles.bubble,
          {
            backgroundColor: user ? colors.primary : colors.card,
            borderColor: user ? colors.primary : colors.border,
          },
        ]}
      >
        {message.steps?.length ? <StepList steps={message.steps} /> : null}
        <MessageBody content={message.content} user={user} />
        {!user ? (
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              void Share.share({
                title: 'مسودة من OneByte Agent',
                message: message.content,
              })
            }
            style={[styles.shareDraft, { borderTopColor: colors.border }]}
          >
            <Feather name="share-2" size={13} color={colors.primary} />
            <Text style={[styles.shareDraftText, { color: colors.primary }]}>
              مشاركة المسودة
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export default function ChatScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const {
    activeSession,
    sessions,
    provider,
    skills,
    memories,
    agent,
    apiKeyConfigured,
    pendingPrompt,
    createMemory,
    patchSession,
    createSession,
    setActiveSession,
    deleteSession,
    appendMessage,
    consumePendingPrompt,
    storageError,
  } = useAssistant();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [error, setError] = useState('');
  const [historyVisible, setHistoryVisible] = useState(false);
  const [liveSteps, setLiveSteps] = useState<ToolStep[]>([]);
  const [pending, setPending] = useState<PendingApproval | null>(null);
  const [status, setStatus] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<TextInput>(null);
  // The session a run writes into and the session currently on screen, so streaming
  // updates stop landing in the wrong chat if the user switches away mid-run.
  const runSessionIdRef = useRef<string | null>(null);
  const visibleSessionIdRef = useRef<string | null>(activeSession?.id ?? null);

  useEffect(() => {
    visibleSessionIdRef.current = activeSession?.id ?? null;
  }, [activeSession?.id]);

  function requestApproval(
    spec: ToolSpec,
    args: Record<string, unknown>,
  ): Promise<ApprovalDecision> {
    return new Promise((resolve) => {
      setPending({
        spec,
        args,
        resolve: (decision) => {
          setPending(null);
          resolve(decision);
        },
      });
    });
  }

  function stopRun() {
    abortRef.current?.abort();
    pending?.resolve('deny');
  }

  useEffect(() => {
    setMessages(activeSession?.messages ?? []);
    setError('');
  }, [activeSession?.id]);

  useEffect(() => {
    if (pendingPrompt) {
      setDraft(pendingPrompt);
      consumePendingPrompt();
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [pendingPrompt, consumePendingPrompt]);

  async function startNewChat() {
    await createSession();
    setMessages([]);
    setDraft('');
    setError('');
    setHistoryVisible(false);
  }

  const SLASH_HELP =
    '**الأوامر المتاحة:**\n' +
    '- `/skill اسم` — تحميل مهارة محفوظة وإرسال طلبك مع تعليماتها\n' +
    '- `/new` — محادثة جديدة\n' +
    '- `/settings` أو `/tasks` أو `/skills` أو `/memory` — فتح الشاشة مباشرة\n' +
    '- `/mcp` — عرض الأدوات المتصلة وحالة التحكم\n' +
    '- `/help` — هذه القائمة';

  /**
   * Local slash commands handled without touching the model.
   * Returns {handled:true} when the command is fully processed, or
   * {handled:false, text} with a rewritten text (for /skill).
   */
  async function handleSlashCommand(raw: string): Promise<{ handled: boolean; text?: string }> {
    const [cmd, ...rest] = raw.slice(1).trim().split(/\s+/);
    const arg = rest.join(' ').trim();
    const c = (cmd ?? '').toLowerCase();

    const replyLocal = async (content: string) => {
      let sessionId = activeSession?.id;
      if (!sessionId) sessionId = await createSession();
      const stamp = new Date().toISOString();
      const userMsg: ChatMessage = { id: messageId(), role: 'user', content: raw, createdAt: stamp };
      const botMsg: ChatMessage = { id: messageId(), role: 'assistant', content, createdAt: stamp };
      setMessages((cur) => [...cur, userMsg, botMsg]);
      await appendMessage(sessionId, userMsg);
      await appendMessage(sessionId, botMsg);
    };

    if (c === 'help') {
      await replyLocal(SLASH_HELP);
      return { handled: true };
    }
    if (c === 'new') {
      await startNewChat();
      return { handled: true };
    }
    if (c === 'settings' || c === 'tasks' || c === 'skills' || c === 'memory') {
      router.push(`/(tabs)/${c}`);
      return { handled: true };
    }
    if (c === 'mcp') {
      const deviceOn = agent.deviceControlEnabled;
      const available = Device.isAvailable();
      const serviceOn = Device.isServiceEnabled();
      const controlState = deviceOn
        ? available
          ? serviceOn
            ? '✅ الخدمة مفعّلة'
            : '⚠️ مفعّل لكن خدمة إمكانية الوصول غير مشغلة — فعّلها من الإعدادات'
          : '⚠️ متاح فقط في نسخة Android المثبتة'
        : '⛔ المفتاح مقفول من الإعدادات';
      await replyLocal(
        '**الأدوات المتصلة (خوادم محلية مدمجة):**\n' +
          '- الذاكرة والمحادثات: `save_memory` · `search_history` · `read_skill` — ✅ جاهزة\n' +
          '- الويب: `web_search` · `web_fetch` — ✅ جاهزة (بموافقتك)\n' +
          '- التحكم في الهاتف: `get_screen` · `tap` · `type_text` · `scroll` · `press` · `open_app` — ' +
          controlState +
          '\n\n`/help` لكل الأوامر.',
      );
      return { handled: true };
    }
    if (c === 'skill') {
      if (!arg) {
        const activeNames = skills
          .filter((s) => s.active)
          .map((s) => s.name)
          .join(' · ');
        await replyLocal(
          skills.length
            ? `اكتب اسم المهارة بعد الأمر. المتاح: ${activeNames || '(لا مهارات نشطة)'}`
            : 'لا توجد مهارات محفوظة بعد — أضفها من شاشة المهارات.',
        );
        return { handled: true };
      }
      const skill = skills.find(
        (s) => s.active && s.name.trim().toLowerCase() === arg.toLowerCase(),
      );
      if (!skill) {
        await replyLocal('لا توجد مهارة نشطة باسم "' + arg + '".');
        return { handled: true };
      }
      return {
        handled: false,
        text:
          raw +
          '\n\n[تعليمات المهارة «' +
          skill.name +
          '» — اتبعها بدقة]\n' +
          skill.instructions,
      };
    }
    // Unknown command — treat as normal text so the model still answers.
    return { handled: false, text: raw };
  }

  async function sendMessage() {
    let text = draft.trim();
    if (!text || sending) return;
    if (text.startsWith('/')) {
      const outcome = await handleSlashCommand(text);
      if (outcome.handled) {
        setDraft('');
        return;
      }
      if (outcome.text) text = outcome.text;
    }
    if (!provider.model.trim() || !apiKeyConfigured) {
      Alert.alert(
        'جهّزي الموديل أولًا',
        'أضيفي رابط الخدمة واسم الموديل ومفتاح API من الإعدادات.',
        [
          { text: 'لاحقًا', style: 'cancel' },
          { text: 'فتح الإعدادات', onPress: () => router.push('/(tabs)/settings') },
        ],
      );
      return;
    }

    let sessionId = activeSession?.id;
    if (!sessionId) {
      sessionId = await createSession();
    }
    const userMessage: ChatMessage = {
      id: messageId(),
      role: 'user',
      content: text,
      createdAt: new Date().toISOString(),
    };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setDraft('');
    setError('');
    setSending(true);
    setStreamText('');
    Keyboard.dismiss();

    const controller = new AbortController();
    abortRef.current = controller;
    runSessionIdRef.current = sessionId;
    setLiveSteps([]);
    const responseId = messageId();
    let steps: ToolStep[] = [];
    let fullResponse = '';
    let assistantPersisted = false;

    const publish = () => {
      // The user may have switched to another chat while the run is in flight;
      // keep streaming output out of that chat's local message list.
      if (visibleSessionIdRef.current !== sessionId) return;
      setStreamText(fullResponse);
      setMessages((current) => {
        const responseMessage: ChatMessage = {
          id: responseId,
          role: 'assistant',
          content: fullResponse,
          createdAt: new Date().toISOString(),
          steps,
        };
        const existing = current.findIndex((item) => item.id === responseId);
        if (existing === -1) return [...current, responseMessage];
        const updated = [...current];
        updated[existing] = responseMessage;
        return updated;
      });
    };

    try {
      await appendMessage(sessionId, userMessage);
      const apiKey = await getStoredModelApiKey();

      const deviceOn = agent.deviceControlEnabled;
      const system = buildAssistantSystemPrompt(skills, memories, {
        deviceControl: deviceOn,
        deviceAvailable: Device.isAvailable(),
        summary: activeSession?.summary,
      });

      // Auto-compaction: the chat never "fills up". Old turns are folded into a summary.
      const budget = workingBudget(provider, agent.maxWorkingTokens);
      const plan = planContext(activeSession, [userMessage], estimateTokens(system), budget);
      const recent = plan.recent;
      let summary = activeSession?.summary ?? '';
      if (plan.toSummarise.length) {
        setStatus('أضغط الجزء القديم من المحادثة…');
        summary = await summariseBacklog({
          settings: provider,
          apiKey,
          previousSummary: summary,
          messages: plan.toSummarise,
          chunkTokens: Math.floor(budget * 0.5),
          signal: controller.signal,
        });
        await patchSession(sessionId, {
          summary,
          summarizedCount: (activeSession?.summarizedCount ?? 0) + plan.toSummarise.length,
        });
      }
      setStatus('');
      const systemWithSummary = plan.toSummarise.length
        ? buildAssistantSystemPrompt(skills, memories, {
            deviceControl: deviceOn,
            deviceAvailable: Device.isAvailable(),
            summary,
          })
        : system;

      const result = await runAgent({
        settings: provider,
        apiKey,
        messages: [
          { role: 'system', content: systemWithSummary },
          ...toProviderMessages(recent),
        ],
        specs: toolsForRequest(deviceOn),
        maxSteps: agent.maxSteps,
        execute: (name, args) =>
          executeTool(name, args, { skills, memories, sessions, createMemory }),
        requestApproval,
        onText: (text) => {
          fullResponse = text;
          publish();
        },
        onStep: (next) => {
          steps = next;
          setLiveSteps(next);
          publish();
        },
        signal: controller.signal,
      });
      fullResponse = result.text;
      steps = result.steps;
      if (result.toolsWereUnsupported) {
        setError('هذا الموديل لا يدعم الأدوات، لذلك رد كنص فقط. اختر موديلًا يدعم Tool calling للتحكم في الجهاز.');
      }
      if (!fullResponse.trim() && !steps.length) {
        throw new Error('الموديل أرجع ردًا فارغًا. راجع اسم الموديل وإعدادات المزود.');
      }
      if (!fullResponse.trim()) fullResponse = 'تم تنفيذ الخطوات المطلوبة.';
      publish();
      await appendMessage(sessionId, {
        id: responseId,
        role: 'assistant',
        content: fullResponse,
        createdAt: new Date().toISOString(),
        steps,
      });
      assistantPersisted = true;
    } catch (caught) {
      const stopped = controller.signal.aborted;
      if (!assistantPersisted && (fullResponse.trim() || steps.length)) {
        // Keep what was already produced so nothing the agent did is lost from history.
        // Skipped if the append above already ran, otherwise a storage failure would
        // leave two copies of the same response (commit updates memory before disk).
        await appendMessage(sessionId, {
          id: responseId,
          role: 'assistant',
          content: (fullResponse.trim() || 'توقفت المهمة.') + (stopped ? '\n\n(أوقفتَ المهمة)' : ''),
          createdAt: new Date().toISOString(),
          steps,
        }).catch(() => undefined);
      }
      if (!stopped) {
        setError(
          caught instanceof Error
            ? caught.message
            : 'تعذّر إرسال الرسالة. راجع اتصال الإنترنت وإعدادات الموديل.',
        );
      }
    } finally {
      abortRef.current = null;
      runSessionIdRef.current = null;
      setSending(false);
      setStreamText('');
      setLiveSteps([]);
      setStatus('');
      setPending(null);
    }
  }

  const reversed = [...messages].reverse();

  return (
    <SafeAreaView
      edges={['top']}
      style={[styles.safe, { backgroundColor: colors.background }]}
    >
      <KeyboardAvoidingView
        style={styles.keyboard}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        <View style={styles.header}>
          <View style={styles.headerCopy}>
            <Text style={[styles.eyebrow, { color: colors.primary }]}>
              ONEBYTE · مساعدك الشخصي
            </Text>
            <Text style={[styles.title, { color: colors.foreground }]}>
              {activeSession?.title ?? 'محادثة جديدة'}
            </Text>
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
              {provider.model
                ? `${provider.providerName} · ${provider.model} · ${
                    provider.free ? 'مجاني · ' : ''
                  }${formatContext(provider.contextLength)} · ضغط تلقائي`
                : 'الموديل غير مضبوط بعد'}
            </Text>
          </View>
          <View style={styles.headerActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="المحادثات السابقة"
              onPress={() => setHistoryVisible(true)}
              style={[styles.headerButton, { borderColor: colors.border }]}
            >
              <Feather name="clock" size={18} color={colors.foreground} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="محادثة جديدة"
              onPress={() => void startNewChat()}
              style={[styles.headerButton, { backgroundColor: colors.primary }]}
            >
              <Feather name="plus" size={19} color={colors.primaryForeground} />
            </Pressable>
          </View>
        </View>

        {storageError ? (
          <View style={[styles.notice, { backgroundColor: colors.destructive + '14' }]}>
            <Text style={[styles.noticeText, { color: colors.destructive }]}>
              {storageError}
            </Text>
          </View>
        ) : null}

        {!apiKeyConfigured || !provider.model ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/(tabs)/settings')}
            style={[
              styles.setupBanner,
              { backgroundColor: colors.accent, borderColor: colors.border },
            ]}
          >
            <View style={[styles.bannerIcon, { backgroundColor: colors.card }]}>
              <Feather name="cpu" size={17} color={colors.primary} />
            </View>
            <View style={styles.bannerCopy}>
              <Text style={[styles.bannerTitle, { color: colors.foreground }]}>
                اربطي الموديل الذي تفضلينه
              </Text>
              <Text style={[styles.bannerBody, { color: colors.mutedForeground }]}>
                المفتاح يبقى في خزنة هذا الجهاز.
              </Text>
            </View>
            <Feather name="arrow-left" size={17} color={colors.primary} />
          </Pressable>
        ) : null}

        {messages.length === 0 ? (
          <View style={styles.emptyWrap}>
            <View style={[styles.heroIcon, { backgroundColor: colors.accent }]}>
              <Feather name="star" size={26} color={colors.primary} />
            </View>
            <Text style={[styles.heroTitle, { color: colors.foreground }]}>
              أبدأ أساعدك في إيه؟
            </Text>
            <Text style={[styles.heroBody, { color: colors.mutedForeground }]}>
              اكتبي فكرتك بطريقتك. أقدر أساعدك تخططي، تكتبي، تتعلمي، وتنظمي شغلك.
            </Text>
            <View style={styles.suggestions}>
              {[
                'ساعدني أرتب مهامي النهارده',
                'اكتب مسودة إعلان لمنتجي',
                'علّمني مهارة جديدة خطوة بخطوة',
              ].map((suggestion) => (
                <Pressable
                  key={suggestion}
                  onPress={() => setDraft(suggestion)}
                  style={[styles.suggestion, { borderColor: colors.border }]}
                >
                  <Text style={[styles.suggestionText, { color: colors.foreground }]}>
                    {suggestion}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : (
          <FlatList
            style={styles.messages}
            data={reversed}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => <MessageBubble message={item} />}
            inverted
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={[
              styles.messageList,
              { paddingBottom: Math.max(insets.bottom, 8) + 82 },
            ]}
            ListHeaderComponent={
              sending && runSessionIdRef.current === activeSession?.id ? (
                <View style={styles.typingRow}>
                  <ActivityIndicator size="small" color={colors.primary} />
                  <Text style={[styles.typingText, { color: colors.mutedForeground }]}>
                    {status || (liveSteps.some((s) => s.status === 'running')
                      ? 'بنفّذ على الجهاز…'
                      : streamText
                        ? 'المساعد بيكتب…'
                        : 'بفكر…')}
                  </Text>
                </View>
              ) : null
            }
          />
        )}

        {error ? (
          <View
            style={[
              styles.errorBox,
              { borderColor: colors.destructive, backgroundColor: colors.card },
            ]}
          >
            <Feather name="alert-circle" size={16} color={colors.destructive} />
            <Text style={[styles.errorText, { color: colors.foreground }]}>{error}</Text>
          </View>
        ) : null}

        <View
          style={[
            styles.composerWrap,
            {
              backgroundColor: colors.background,
              borderTopColor: colors.border,
              paddingBottom: Math.max(insets.bottom, 8) + 68,
            },
          ]}
        >
          <View
            style={[
              styles.composer,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <TextInput
              ref={inputRef}
              value={draft}
              onChangeText={setDraft}
              placeholder="اكتبي رسالتك هنا..."
              placeholderTextColor={colors.mutedForeground}
              multiline
              maxLength={12000}
              blurOnSubmit={false}
              keyboardAppearance={Platform.OS === 'ios' ? 'light' : undefined}
              returnKeyType="default"
              style={[styles.input, { color: colors.foreground }]}
              textAlignVertical="center"
              accessibilityLabel="رسالتك للمساعد"
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={sending ? 'إيقاف المهمة' : 'إرسال الرسالة'}
              disabled={!sending && !draft.trim()}
              onPress={() => (sending ? stopRun() : void sendMessage())}
              style={[
                styles.sendButton,
                {
                  backgroundColor: sending ? colors.destructive : colors.primary,
                  opacity: !sending && !draft.trim() ? 0.5 : 1,
                },
              ]}
            >
              {sending ? (
                <Feather name="square" size={17} color={colors.destructiveForeground} />
              ) : (
                <Feather name="arrow-up" size={20} color={colors.primaryForeground} />
              )}
            </Pressable>
          </View>
          <Text style={[styles.privacyNote, { color: colors.mutedForeground }]}>
            المحادثة محفوظة على جهازك، والرسالة تُرسل مباشرةً لمزود الموديل عند الإرسال.
          </Text>
        </View>
      </KeyboardAvoidingView>

      <ApprovalSheet pending={pending} />

      <Modal
        visible={historyVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setHistoryVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.historySheet, { backgroundColor: colors.background }]}>
            <View style={styles.sheetHeader}>
              <Text style={[styles.sheetTitle, { color: colors.foreground }]}>
                محادثاتك
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="إغلاق"
                onPress={() => setHistoryVisible(false)}
              >
                <Feather name="x" size={22} color={colors.foreground} />
              </Pressable>
            </View>
            <Pressable
              onPress={() => void startNewChat()}
              style={[styles.newChatRow, { backgroundColor: colors.accent }]}
            >
              <Feather name="plus" size={17} color={colors.primary} />
              <Text style={[styles.newChatText, { color: colors.foreground }]}>
                ابدئي محادثة جديدة
              </Text>
            </Pressable>
            <FlatList
              data={sessions}
              keyExtractor={(session) => session.id}
              ListEmptyComponent={
                <Text style={[styles.emptyHistory, { color: colors.mutedForeground }]}>
                  لسه مفيش محادثات محفوظة.
                </Text>
              }
              renderItem={({ item }) => (
                <View style={[styles.historyRow, { borderBottomColor: colors.border }]}>
                  <Pressable
                    style={styles.historySelect}
                    onPress={() => {
                      void setActiveSession(item.id);
                      setHistoryVisible(false);
                    }}
                  >
                    <Text
                      numberOfLines={1}
                      style={[styles.historyTitle, { color: colors.foreground }]}
                    >
                      {item.title}
                    </Text>
                    <Text style={[styles.historyDate, { color: colors.mutedForeground }]}>
                      {new Date(item.updatedAt).toLocaleDateString('ar-EG')}
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="حذف المحادثة"
                    onPress={() =>
                      Alert.alert('حذف المحادثة؟', 'لا يمكن استعادتها بعد الحذف.', [
                        { text: 'إلغاء', style: 'cancel' },
                        {
                          text: 'حذف',
                          style: 'destructive',
                          onPress: () => void deleteSession(item.id),
                        },
                      ])
                    }
                    style={styles.deleteButton}
                  >
                    <Feather name="trash-2" size={16} color={colors.destructive} />
                  </Pressable>
                </View>
              )}
            />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  keyboard: { flex: 1 },
  header: {
    minHeight: 78,
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 12,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  headerCopy: { flex: 1, alignItems: 'flex-end' },
  eyebrow: { fontSize: 10, fontWeight: '700', letterSpacing: 1 },
  title: { fontSize: 20, fontWeight: '700', marginTop: 3, textAlign: 'right' },
  subtitle: { fontSize: 11, marginTop: 3, textAlign: 'right' },
  headerActions: { flexDirection: 'row', gap: 7 },
  headerButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 14,
  },
  setupBanner: {
    marginHorizontal: 16,
    marginBottom: 10,
    padding: 11,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 10,
  },
  bannerIcon: { width: 35, height: 35, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  bannerCopy: { flex: 1, alignItems: 'flex-end' },
  bannerTitle: { fontSize: 13, fontWeight: '700', textAlign: 'right' },
  bannerBody: { fontSize: 11, marginTop: 2, textAlign: 'right' },
  emptyWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingBottom: 20,
  },
  heroIcon: {
    width: 58,
    height: 58,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 17,
  },
  heroTitle: { fontSize: 23, fontWeight: '700', textAlign: 'center' },
  heroBody: { fontSize: 13, lineHeight: 21, textAlign: 'center', marginTop: 8, maxWidth: 330 },
  suggestions: { width: '100%', gap: 8, marginTop: 21 },
  suggestion: {
    minHeight: 42,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  suggestionText: { fontSize: 12, textAlign: 'right' },
  messages: { flex: 1 },
  messageList: { paddingHorizontal: 15, paddingTop: 12, gap: 13 },
  messageRow: { flexDirection: 'row-reverse', alignItems: 'flex-end', gap: 8, marginBottom: 12 },
  userMessageRow: { justifyContent: 'flex-start' },
  avatar: { width: 28, height: 28, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  bubble: {
    maxWidth: '85%',
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 13,
    borderRadius: 17,
  },
  messageText: { fontSize: 14, lineHeight: 22, textAlign: 'auto' },
  shareDraft: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'flex-start', gap: 6, borderTopWidth: 1, marginTop: 9, paddingTop: 8 },
  shareDraftText: { fontSize: 11, fontWeight: '700' },
  steps: { gap: 5, marginBottom: 8 },
  stepRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 6 },
  stepText: { fontSize: 11, flexShrink: 1, textAlign: 'right' },
  typingRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8, padding: 12 },
  typingText: { fontSize: 12 },
  errorBox: {
    flexDirection: 'row-reverse',
    alignItems: 'flex-start',
    gap: 8,
    borderWidth: 1,
    borderRadius: 13,
    padding: 11,
    marginHorizontal: 14,
    marginBottom: 8,
  },
  errorText: { flex: 1, fontSize: 12, lineHeight: 18, textAlign: 'right' },
  notice: { marginHorizontal: 14, marginBottom: 8, borderRadius: 12, padding: 10 },
  noticeText: { fontSize: 12, lineHeight: 18, textAlign: 'right' },
  composerWrap: { borderTopWidth: 1, paddingHorizontal: 13, paddingTop: 10 },
  composer: {
    flexDirection: 'row-reverse',
    alignItems: 'flex-end',
    gap: 8,
    borderWidth: 1,
    borderRadius: 20,
    paddingLeft: 7,
    paddingRight: 13,
    paddingVertical: 7,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    paddingVertical: 9,
    fontSize: 14,
    textAlign: 'right',
  },
  sendButton: { width: 38, height: 38, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  privacyNote: { fontSize: 9, lineHeight: 13, textAlign: 'center', marginTop: 7 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(4, 13, 10, 0.45)', justifyContent: 'flex-end' },
  historySheet: { maxHeight: '78%', minHeight: '44%', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 19, paddingTop: 18, paddingBottom: 24 },
  sheetHeader: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  sheetTitle: { fontSize: 20, fontWeight: '700' },
  newChatRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 9, padding: 13, borderRadius: 14, marginBottom: 8 },
  newChatText: { fontSize: 13, fontWeight: '700' },
  historyRow: { flexDirection: 'row-reverse', alignItems: 'center', borderBottomWidth: 1, paddingVertical: 12 },
  historySelect: { flex: 1, alignItems: 'flex-end', gap: 4 },
  historyTitle: { fontSize: 14, fontWeight: '600', maxWidth: '100%' },
  historyDate: { fontSize: 10 },
  deleteButton: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  emptyHistory: { textAlign: 'center', paddingVertical: 24, fontSize: 13 },
});
