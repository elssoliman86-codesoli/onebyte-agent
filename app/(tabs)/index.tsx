import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
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

/** Inline markdown: **bold**, `code`, +green/-red diff lines inside prose. */
function MarkdownText({ text, user }: { text: string; user?: boolean }) {
  const colors = useColors();
  const baseColor = user ? colors.primaryForeground : colors.foreground;
  return (
    <>
      {text.split('\n').map((line, li) => {
        const rendered = line
          .split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
          .filter(Boolean)
          .map((part, i) => {
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
          });
        // Diff coloring for +/- lines that appear outside fenced blocks.
        const isAdd = /^\+\s/.test(line) && !/^\+\+\+/.test(line);
        const isDel = /^-\s/.test(line) && !/^---/.test(line);
        if ((isAdd || isDel) && !user) {
          return (
            <Text
              key={li}
              style={[
                styles.messageText,
                styles.diffLine,
                { color: isAdd ? colors.success : colors.destructive },
              ]}
            >
              {line}
            </Text>
          );
        }
        return (
          <Text key={li} style={[styles.messageText, { color: baseColor }]}>
            {rendered}
          </Text>
        );
      })}
    </>
  );
}

function MessageBubble({
  message,
  onEditMessage,
}: {
  message: ChatMessage;
  onEditMessage?: (content: string) => void;
}) {
  const colors = useColors();
  const user = message.role === 'user';
  const [showThinking, setShowThinking] = useState(false);
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
        {message.thinking ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="عرض التفكير"
            onPress={() => setShowThinking(!showThinking)}
            style={[styles.thinkingToggle, { borderTopColor: colors.border }]}
          >
            <Feather name="cpu" size={12} color={colors.mutedForeground} />
            <Text style={[styles.thinkingToggleText, { color: colors.mutedForeground }]}>
              {showThinking ? 'إخفاء التفكير' : 'عرض التفكير'}
            </Text>
          </Pressable>
        ) : null}
        {showThinking && message.thinking ? (
          <View style={[styles.thinkingBox, { borderColor: colors.border }]}>
            <Text style={[styles.thinkingText, { color: colors.mutedForeground }]} selectable>
              {message.thinking}
            </Text>
          </View>
        ) : null}
        <MessageBody content={message.content} user={user} />
        {user && onEditMessage ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="تعديل وإعادة إرسال"
            onPress={() => onEditMessage(message.content)}
            style={[styles.userActions, { borderTopColor: 'rgba(255,255,255,0.25)' }]}
          >
            <Feather name="edit-2" size={12} color={colors.primaryForeground} />
            <Text style={[styles.userActionText, { color: colors.primaryForeground }]}>
              تعديل وإعادة إرسال
            </Text>
          </Pressable>
        ) : null}
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
    saveAgentSettings,
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
  const [showSlash, setShowSlash] = useState(false);
  const [showSkillMenu, setShowSkillMenu] = useState(false);
  const [thinkingPreview, setThinkingPreview] = useState('');
  const [queue, setQueue] = useState<string[]>([]);
  const [runPlan, setRunPlan] = useState<string | null>(null);
  const [planDone, setPlanDone] = useState<null | 'ok' | 'fail'>(null);
  const [contextInfo, setContextInfo] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<TextInput>(null);
  const queueRunningRef = useRef(false);
  // The session a run writes into and the session currently on screen, so streaming
  // updates stop landing in the wrong chat if the user switches away mid-run.
  const runSessionIdRef = useRef<string | null>(null);
  const visibleSessionIdRef = useRef<string | null>(activeSession?.id ?? null);

  useEffect(() => {
    visibleSessionIdRef.current = activeSession?.id ?? null;
  }, [activeSession?.id]);

  /** "دائمًا" key for a tool: open_app is remembered per package. */
  function approvalKey(spec: ToolSpec, args: Record<string, unknown>): string {
    if (spec.name === 'open_app' && typeof args.package === 'string' && args.package) {
      return `open_app:${args.package}`;
    }
    return spec.name;
  }

  const SLASH_COMMANDS = [
    { cmd: 'help', label: '/help — قائمة الأوامر' },
    { cmd: 'skill', label: '/skill — تحميل مهارة' },
    { cmd: 'mcp', label: '/mcp — حالة الأدوات المتصلة' },
    { cmd: 'new', label: '/new — محادثة جديدة' },
    { cmd: 'settings', label: '/settings — الإعدادات' },
    { cmd: 'tasks', label: '/tasks — المهام اليومية' },
    { cmd: 'skills', label: '/skills — شاشة المهارات' },
    { cmd: 'memory', label: '/memory — الذاكرة' },
  ];

  /** Live plan tracker: extracts the "الخطة" bullet section from streamed text. */
  function extractPlan(text: string): string | null {
    const m = /\*?\*?الخطة\*?\*?\s*:?\s*\n([\s\S]*?)(?:\n\s*\n|$)/.exec(text);
    if (!m) return null;
    const lines = m[1]
      .split('\n')
      .map((l) => l.replace(/^[-*•\d.)\s]+/, '').trim())
      .filter(Boolean);
    return lines.length ? lines.join('\n') : null;
  }

  function updateLivePlan(text: string) {
    const p = extractPlan(text);
    if (p) setRunPlan(p);
  }

  function onDraftChange(v: string) {
    setDraft(v);
    if (!v.startsWith('/')) {
      setShowSlash(false);
      setShowSkillMenu(false);
      return;
    }
    if (v === '/') {
      setShowSlash(true);
      setShowSkillMenu(false);
      return;
    }
    const cmd = v.slice(1).split(' ')[0]?.toLowerCase() ?? '';
    if ((cmd === 'skill' || cmd === 'مهارة') && v.includes(' ')) {
      setShowSkillMenu(true);
      setShowSlash(false);
      return;
    }
    setShowSkillMenu(false);
    setShowSlash(
      cmd.length > 0 && SLASH_COMMANDS.some((c) => c.cmd.startsWith(cmd)),
    );
  }

  async function pickSlashCommand(cmd: string) {
    setShowSlash(false);
    setShowSkillMenu(false);
    if (cmd === 'skill') {
      if (skills.filter((s) => s.active).length) {
        setDraft('/skill ');
        setShowSkillMenu(true);
      } else {
        void handleSlashCommand('/skill');
      }
      return;
    }
    setDraft('');
    await handleSlashCommand('/' + cmd);
  }

  async function pickSkill(name: string) {
    setShowSkillMenu(false);
    setDraft('');
    const outcome = await handleSlashCommand('/skill ' + name);
    if (outcome.handled) return;
    if (outcome.text) void sendMessage(outcome.text);
  }

  function requestApproval(
    spec: ToolSpec,
    args: Record<string, unknown>,
  ): Promise<ApprovalDecision> {
    const key = approvalKey(spec, args);
    // Saved "دائمًا" approvals skip the sheet entirely.
    if (agent.autoApprovedTools.includes(key)) return Promise.resolve('once');
    return new Promise((resolve) => {
      setPending({
        spec,
        args,
        resolve: (decision) => {
          setPending(null);
          if (decision === 'always') {
            const next = [...agent.autoApprovedTools, key];
            void saveAgentSettings({ autoApprovedTools: next }).catch(
              () => undefined,
            );
            resolve('turn');
          } else {
            resolve(decision);
          }
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

  async function sendMessage(explicitText?: string) {
    let text = (explicitText ?? draft).trim();
    if (!text || sending) {
      // While a run is active, new messages join the queue instead of being lost.
      if (sending && text) setQueue((q) => [...q, text]);
      return;
    }
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
    setThinkingPreview('');
    setRunPlan(null);
    setPlanDone(null);
    Keyboard.dismiss();

    const controller = new AbortController();
    abortRef.current = controller;
    runSessionIdRef.current = sessionId;
    setLiveSteps([]);
    const responseId = messageId();
    let steps: ToolStep[] = [];
    let fullResponse = '';
    let finalThinking = '';
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
      setContextInfo(
        `السياق: ${Math.round(plan.usedTokens / 1000)}K / ${Math.round(budget / 1000)}K توكن`,
      );
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
          updateLivePlan(text);
          publish();
        },
        onThinking: (chunk) => {
          setThinkingPreview((cur) => (cur + chunk).slice(-1800));
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
      finalThinking = result.thinking;
      setPlanDone('ok');
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
        thinking: finalThinking || undefined,
      });
      assistantPersisted = true;
    } catch (caught) {
      const stopped = controller.signal.aborted;
      setPlanDone('fail');
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
          thinking: finalThinking || undefined,
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
      // Drain the queue: any message sent while a run was active fires now.
      setQueue((current) => {
        const [next, ...rest] = current;
        if (next && !controller.signal.aborted) {
          queueRunningRef.current = true;
          setTimeout(() => {
            queueRunningRef.current = false;
            void sendMessage(next);
          }, 50);
        }
        return rest;
      });
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
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
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
                  }${formatContext(provider.contextLength)}`
                : 'الموديل غير مضبوط بعد'}
            </Text>
            {contextInfo ? (
              <Text style={[styles.contextChip, { color: colors.primary }]}>
                {contextInfo}
                {queue.length ? ` · ⏳ في الطابور: ${queue.length}` : ''}
              </Text>
            ) : queue.length ? (
              <Text style={[styles.contextChip, { color: colors.warning }]}>
                ⏳ في الطابور: {queue.length}
              </Text>
            ) : null}
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
            renderItem={({ item }) => (
              <MessageBubble
                message={item}
                onEditMessage={item.role === 'user' ? (content) => void sendMessage(content) : undefined}
              />
            )}
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

        {runPlan ? (
          <View style={[styles.planBar, { borderColor: colors.border, backgroundColor: colors.card }]}>
            <View style={styles.planHead}>
              <Feather
                name={planDone === 'ok' ? 'check-circle' : planDone === 'fail' ? 'x-circle' : 'list'}
                size={14}
                color={planDone === 'ok' ? colors.success : planDone === 'fail' ? colors.destructive : colors.primary}
              />
              <Text style={[styles.planTitle, { color: colors.foreground }]}>
                {planDone === 'ok' ? 'الخطة — تمت بنجاح' : planDone === 'fail' ? 'الخطة — توقفت' : 'الخطة — جارِ التنفيذ'}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="إغلاق الخطة"
                onPress={() => setRunPlan(null)}
              >
                <Feather name="x" size={14} color={colors.mutedForeground} />
              </Pressable>
            </View>
            {runPlan.split('\n').map((line, i) => (
              <View key={i} style={styles.planRow}>
                <Feather
                  name={planDone === 'ok' ? 'check' : 'circle'}
                  size={12}
                  color={planDone === 'ok' ? colors.success : colors.mutedForeground}
                />
                <Text style={[styles.planText, { color: colors.foreground }]}>{line}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {showSlash ? (
          <View style={[styles.slashMenu, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {SLASH_COMMANDS.filter((c) =>
              c.cmd.startsWith((draft.slice(1).split(' ')[0] || '').toLowerCase()),
            ).map((c) => (
              <Pressable
                key={c.cmd}
                accessibilityRole="button"
                onPress={() => void pickSlashCommand(c.cmd)}
                style={[styles.slashItem, { borderBottomColor: colors.border }]}
              >
                <Text style={[styles.slashText, { color: colors.foreground }]}>{c.label}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {showSkillMenu ? (
          <View style={[styles.slashMenu, styles.skillMenu, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.slashHeader, { color: colors.primary }]}>اختاري مهارة:</Text>
            <ScrollView style={{ maxHeight: 220 }}>
              {skills
                .filter((s) => s.active)
                .map((s) => (
                  <Pressable
                    key={s.id}
                    accessibilityRole="button"
                    onPress={() => void pickSkill(s.name)}
                    style={[styles.slashItem, { borderBottomColor: colors.border }]}
                  >
                    <Text style={[styles.slashText, { color: colors.foreground }]}>{s.name}</Text>
                    {s.description ? (
                      <Text style={[styles.slashSub, { color: colors.mutedForeground }]} numberOfLines={1}>
                        {s.description}
                      </Text>
                    ) : null}
                  </Pressable>
                ))}
            </ScrollView>
          </View>
        ) : null}

        {thinkingPreview && sending ? (
          <View style={[styles.thinkingBar, { borderColor: colors.border }]}>
            <Feather name="cpu" size={13} color={colors.primary} />
            <Text style={[styles.thinkingBarText, { color: colors.mutedForeground }]} numberOfLines={1}>
              {thinkingPreview.slice(-140)}
            </Text>
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
              onChangeText={onDraftChange}
              placeholder="اكتبي رسالتك هنا... (اكتبي / للأوامر)"
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
            {sending && draft.trim() ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="إضافة للطابور"
                onPress={() => {
                  setQueue((q) => [...q, draft.trim()]);
                  setDraft('');
                  setShowSlash(false);
                  setShowSkillMenu(false);
                }}
                style={[styles.sendButton, { backgroundColor: colors.secondary }]}
              >
                <Feather name="plus" size={19} color={colors.secondaryForeground} />
              </Pressable>
            ) : null}
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
  diffLine: { fontFamily: 'monospace', fontSize: 12.5, lineHeight: 19, textAlign: 'left', writingDirection: 'ltr' },
  thinkingToggle: { flexDirection: 'row-reverse', alignItems: 'center', gap: 6, borderTopWidth: 1, paddingTop: 8, marginTop: 8 },
  thinkingToggleText: { fontSize: 11, fontWeight: '700' },
  thinkingBox: { borderWidth: 1, borderRadius: 12, padding: 10, marginTop: 8, marginBottom: 8, maxHeight: 220, overflow: 'hidden' },
  thinkingText: { fontSize: 12, lineHeight: 19, textAlign: 'right' },
  thinkingBar: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginHorizontal: 14,
    marginBottom: 6,
  },
  thinkingBarText: { flex: 1, fontSize: 11 },
  userActions: { flexDirection: 'row-reverse', alignItems: 'center', gap: 5, borderTopWidth: 1, marginTop: 8, paddingTop: 7 },
  userActionText: { fontSize: 11, fontWeight: '700' },
  contextChip: { fontSize: 10, fontWeight: '700', marginTop: 3, textAlign: 'right' },
  planBar: { borderWidth: 1, borderRadius: 14, marginHorizontal: 14, marginBottom: 8, padding: 12, gap: 7 },
  planHead: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  planTitle: { flex: 1, fontSize: 12, fontWeight: '700', textAlign: 'right' },
  planRow: { flexDirection: 'row-reverse', alignItems: 'flex-start', gap: 7 },
  planText: { flex: 1, fontSize: 12, lineHeight: 18, textAlign: 'right' },
  slashMenu: {
    position: 'absolute',
    bottom: '78%',
    right: 14,
    left: 14,
    borderWidth: 1,
    borderRadius: 14,
    maxHeight: 300,
    zIndex: 50,
    elevation: 50,
  },
  skillMenu: { maxHeight: 300, paddingVertical: 6, paddingHorizontal: 4 },
  slashHeader: { fontSize: 11, fontWeight: '700', padding: 8, textAlign: 'right' },
  slashItem: { borderBottomWidth: 1, paddingHorizontal: 12, paddingVertical: 10 },
  slashText: { fontSize: 13, fontWeight: '600', textAlign: 'right' },
  slashSub: { fontSize: 10, marginTop: 2, textAlign: 'right' },
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
