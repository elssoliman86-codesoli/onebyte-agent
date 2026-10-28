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
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import * as Notifications from 'expo-notifications';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { Image as RNImage } from 'react-native';
import { useColors } from '@/hooks/useColors';
import {
  useAssistant,
  getStoredModelApiKey,
  type AssistantSkill,
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
import { HtmlPreview } from '@/components/HtmlPreview';
import { HomeScreen } from '@/components/HomeScreen';
import { speechService } from '@/src/speech-service';
import { alertCompat } from '@/src/web-alert';
import { spacing, radius, typography, shadows } from '@/src/design-tokens';
import { ScreenTopBar } from '@/components/PhoneDrawer';
import { useT } from '@/src/i18n';
import {
  extractFacts,
  knowledgeContextBlock,
  retrieveKnowledge,
} from '@/src/knowledge';
import type { StudioMode } from '@/src/modes';

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

function MessageBody({
  content,
  user,
  onPreview,
}: {
  content: string;
  user?: boolean;
  onPreview?: (html: string) => void;
}) {
  const segments = parseSegments(content);
  return (
    <>
      {segments.map((seg, i) =>
        seg.kind === 'text' ? (
          <MarkdownText key={i} text={seg.text} user={user} />
        ) : seg.kind === 'code' ? (
          <CodeBlock
            key={i}
            code={seg.code}
            language={seg.language}
            onPreview={
              onPreview &&
              ((seg.language ?? '').toLowerCase() === 'html' ||
              /^\s*<!DOCTYPE html/i.test(seg.code))
                ? onPreview
                : undefined
            }
          />
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
        // Markdown structure: headings and bullets/numbered lists.
        const heading = /^(#{1,4})\s+(.*)$/.exec(line);
        if (heading && !user) {
          const level = heading[1].length;
          return (
            <Text
              key={li}
              style={[
                styles.messageText,
                {
                  color: colors.primary,
                  fontWeight: '700',
                  fontSize: level <= 1 ? 17 : level === 2 ? 15.5 : 14.5,
                  marginTop: level <= 2 ? 8 : 4,
                  textAlign: 'right',
                },
              ]}
            >
              {heading[2]}
            </Text>
          );
        }
        const bullet = /^[-•]\s+(.*)$/.exec(line.trim());
        if (bullet) {
          return (
            <View key={li} style={styles.bulletRow}>
              <View style={[styles.bulletDot, { backgroundColor: colors.primary }]} />
              <Text style={[styles.messageText, { color: baseColor, flex: 1 }]}>
                {bullet[1]}
              </Text>
            </View>
          );
        }
        const numbered = /^(\d{1,2})[.)]\s+(.*)$/.exec(line.trim());
        if (numbered && !user) {
          return (
            <View key={li} style={styles.bulletRow}>
              <Text style={[styles.listNumber, { color: colors.primary }]}>{numbered[1]}.</Text>
              <Text style={[styles.messageText, { color: baseColor, flex: 1 }]}>
                {numbered[2]}
              </Text>
            </View>
          );
        }
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
                    backgroundColor: colors.surfaceGlass,
                    color: baseColor,
                    borderRadius: 4,
                    paddingHorizontal: 4,
                    paddingVertical: 2,
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
  onPreview,
}: {
  message: ChatMessage;
  onEditMessage?: (content: string) => void;
  onPreview?: (html: string) => void;
}) {
  const colors = useColors();
  const t = useT();
  const user = message.role === 'user';
  const [showThinking, setShowThinking] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [copied, setCopied] = useState(false);
  // Code blocks are not meant to be read aloud; keep prose only.
  const speakableText = message.content.replace(/```[\s\S]*?(?:```|$)/g, ' ').replace(/\s+/g, ' ').trim();

  async function toggleSpeak() {
    if (speaking) {
      await speechService.stopSpeaking().catch(() => undefined);
      setSpeaking(false);
      return;
    }
    setSpeaking(true);
    try {
      await speechService.speak(speakableText || message.content);
    } catch {
      // speech synthesis unavailable — nothing to do
    } finally {
      setSpeaking(false);
    }
  }
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
            borderWidth: 1,
            borderRadius: 20,
            paddingVertical: 12,
            paddingHorizontal: 16,
          },
        ]}
      >
        {message.skill ? (
          <View style={[styles.skillChip, { backgroundColor: colors.accent }]}>
            <Feather name="zap" size={11} color={colors.primary} />
            <Text style={[styles.skillChipText, { color: colors.primary }]}>
              استخدمت المهارة: {message.skill}
            </Text>
          </View>
        ) : null}
        {user && message.files?.length ? (
          <View style={styles.fileChipsRow}>
            {message.files.map((name, i) => (
              <View key={i} style={[styles.fileChip, { backgroundColor: 'rgba(255,255,255,0.18)' }]}>
                <Feather name="file-text" size={11} color={colors.primaryForeground} />
                <Text style={[styles.fileChipText, { color: colors.primaryForeground }]} numberOfLines={1}>
                  {name}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
        {user && message.imageUri && !message.images?.length ? (
          <RNImage
            source={{ uri: message.imageUri }}
            style={styles.bubbleImage}
            resizeMode="cover"
          />
        ) : null}
        {user && message.images?.length ? (
          <View style={styles.bubbleImagesWrap}>
            {message.images.map((uri, i) => (
              <RNImage
                key={`${i}-${uri.slice(24, 40)}`}
                source={{ uri }}
                style={styles.bubbleImage}
                resizeMode="cover"
              />
            ))}
          </View>
        ) : null}
        {message.steps?.length ? <StepList steps={message.steps} /> : null}
        {message.thinking ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('showThinking')}
            onPress={() => setShowThinking(!showThinking)}
            style={[styles.thinkingToggle, { borderTopColor: colors.border }]}
          >
            <Feather name="cpu" size={12} color={colors.mutedForeground} />
            <Text style={[styles.thinkingToggleText, { color: colors.mutedForeground }]}>
              {showThinking ? t('hideThinking') : t('showThinking')}
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
        <MessageBody content={message.content} user={user} onPreview={onPreview} />
        {user && (onEditMessage || message.content) ? (
          <View style={[styles.userActions, { borderTopColor: 'rgba(255,255,255,0.25)' }]}>
            {onEditMessage ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('editResend')}
                onPress={() => onEditMessage(message.content)}
                style={styles.iconAction}
                hitSlop={6}
              >
                <Feather name="edit-2" size={13} color={colors.primaryForeground} />
              </Pressable>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('copy')}
              onPress={() => {
                void Clipboard.setStringAsync(message.content).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1400);
                });
              }}
              style={styles.iconAction}
              hitSlop={6}
            >
              <Feather name={copied ? 'check' : 'copy'} size={13} color={colors.primaryForeground} />
            </Pressable>
          </View>
        ) : null}
        {!user ? (
          <View style={styles.assistantActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={speaking ? t('stopListen') : t('listen')}
              onPress={() => void toggleSpeak()}
              style={[styles.shareDraft, { borderTopColor: colors.border }]}
            >
              <Feather name={speaking ? 'volume-x' : 'volume-2'} size={13} color={colors.primary} />
              <Text style={[styles.shareDraftText, { color: colors.primary }]}>
                {speaking ? t('stopListen') : t('listen')}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('copy')}
              onPress={() => {
                void Clipboard.setStringAsync(message.content).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1400);
                });
              }}
              style={[styles.shareDraft, styles.shareDraftStart, { borderTopColor: colors.border }]}
            >
              <Feather name={copied ? 'check' : 'copy'} size={13} color={colors.primary} />
              <Text style={[styles.shareDraftText, { color: colors.primary }]}>
                {copied ? t('copied') : t('copy')}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                void Share.share({
                  title: 'مسودة من OneByte Agent',
                  message: message.content,
                })
              }
              style={[styles.shareDraft, styles.shareDraftStart, { borderTopColor: colors.border }]}
            >
              <Feather name="share-2" size={13} color={colors.primary} />
              <Text style={[styles.shareDraftText, { color: colors.primary }]}>
                {t('shareDraft')}
              </Text>
            </Pressable>
          </View>
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
    createTask: createTaskInStore,
    setTaskActive,
    patchSession,
    createSession,
    setActiveSession,
    deleteSession,
    appendMessage,
    consumePendingPrompt,
    saveAgentSettings,
    storageError,
    knowledge,
    appearance,
    addKnowledge,
  } = useAssistant();
  const t = useT();
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
  const [attachImages, setAttachImages] = useState<string[]>([]);
  const [attachFiles, setAttachFiles] = useState<{ name: string; content: string }[]>([]);
  const [attachMenuVisible, setAttachMenuVisible] = useState(false);
  const [thinkingOpen, setThinkingOpen] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<{ stop: () => void } | null>(null);
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
    // Fill the draft so the user continues typing their request right
    // after the skill name — the enrichment happens at send time.
    setDraft(`/skill ${name} `);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  /**
   * Smart skill detection: if the user's text clearly refers to an active
   * skill (its name / enough of its words appear), its instructions are
   * injected automatically — no manual /skill invocation needed.
   */
  function autoMatchSkill(text: string): AssistantSkill | null {
    const normalize = (s: string) =>
      s
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .split(/\s+/)
        .filter((w) => w.length >= 3);
    const words = new Set(normalize(text));
    if (!words.size) return null;
    let best: { skill: AssistantSkill; score: number } | null = null;
    for (const skill of skills) {
      if (!skill.active) continue;
      const tokens = normalize(skill.name + ' ' + skill.description);
      if (!tokens.length) continue;
      const hits = tokens.filter((t) => words.has(t)).length;
      const ratio = hits / tokens.length;
      // Require a strong signal: ≥2 keyword hits, or most of the skill tokens.
      const confident = hits >= 2 || (ratio >= 0.5 && hits >= 1);
      if (confident && (!best || hits > best.score)) {
        best = { skill, score: hits };
      }
    }
    return best?.skill ?? null;
  }

  /** create_task tool callback: store the task + try to schedule its reminder. */
  async function handleCreateTask(input: { title: string; time: string; prompt: string }) {
    const taskId = await createTaskInStore(input);
    if (Platform.OS === 'web') return;
    try {
      const permission = await Notifications.getPermissionsAsync();
      const granted =
        permission.granted ||
        (await Notifications.requestPermissionsAsync()).granted;
      if (!granted) return;
      const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(input.time);
      if (!match) return;
      const notificationId = await Notifications.scheduleNotificationAsync({
        content: {
          title: 'حان وقت مهمتك',
          body: input.title,
          data: { taskId },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DAILY,
          hour: Number(match[1]),
          minute: Number(match[2]),
          channelId: 'daily-tasks',
        },
      });
      await setTaskActive(taskId, true, notificationId);
    } catch {
      // task is stored even if reminders are unavailable
    }
  }

  /**
   * Pick images (unlimited per message). Web: downscale via canvas so the
   * 5MB localStorage quota survives; native: picker-quality compression.
   */
  async function attachImage() {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.7,
        allowsMultipleSelection: true,
        base64: true,
      });
      if (result.canceled || !result.assets?.length) return;
      const loaded: string[] = [];
      for (const asset of result.assets) {
        let dataUrl = asset.base64
          ? `data:${asset.mimeType ?? 'image/jpeg'};base64,${asset.base64}`
          : asset.uri;
        // Web picker returns a blob/file URI — convert + downscale for the wire.
        if (Platform.OS === 'web' && !dataUrl.startsWith('data:')) {
          dataUrl = await downscaleImageWeb(asset.uri);
        }
        if (!dataUrl.startsWith('data:')) continue; // native non-data URI without base64 — skip honestly
        loaded.push(dataUrl);
      }
      if (loaded.length) setAttachImages((cur) => [...cur, ...loaded]);
    } catch (error) {
      alertCompat('تعذّر إرفاق الصورة', error instanceof Error ? error.message : 'حاولي مرة أخرى.');
    }
  }

  /** Web-only: decode an image URI and re-encode ≤640px wide, JPEG q≈0.72. */
  async function downscaleImageWeb(uri: string): Promise<string> {
    try {
      const blob = await (await fetch(uri)).blob();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('تعذّر قراءة الصورة.'));
        reader.readAsDataURL(blob);
      });
      const img = new Image();
      const loaded = await new Promise<HTMLImageElement>((resolve, reject) => {
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('صورة غير قابلة للمعالجة.'));
        img.src = dataUrl;
      });
      const maxW = 640;
      if (loaded.width <= maxW && dataUrl.length <= 400_000) return dataUrl;
      const scale = Math.min(1, maxW / Math.max(loaded.width, 1));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(loaded.width * scale));
      canvas.height = Math.max(1, Math.round(loaded.height * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) return dataUrl;
      ctx.drawImage(loaded, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', 0.72);
    } catch {
      return '';
    }
  }

  /**
   * Attach text-based files (.md/.txt/code/csv/json) whose content is embedded
   * in the prompt, plus ZIP archives (name+size only — the archive stays
   * binary and is never unpacked; the model is told that honestly).
   * Unlimited files per message.
   */
  async function attachFilesPicker(options?: { zipsOnly?: boolean }) {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: options?.zipsOnly
          ? ['application/zip', 'application/x-zip-compressed', 'application/octet-stream']
          : [
              'text/*', 'text/markdown', 'text/plain', 'text/csv',
              'application/json', 'application/xml', 'application/javascript',
              'application/x-yaml', 'application/octet-stream',
              'application/zip', 'application/x-zip-compressed',
            ],
        copyToCacheDirectory: true,
        multiple: true,
      });
      if (result.canceled || !result.assets?.length) return;
      const loaded: { name: string; content: string }[] = [];
      for (const file of result.assets) {
        const isZip = /\.zip$/i.test(file.name) || /zip/i.test(file.mimeType ?? '');
        if (isZip) {
          loaded.push({
            name: file.name,
            content: `[أرشيف ZIP: ${file.name} — الحجم ${Math.round((file.size ?? 0) / 1024)}KB. الأرشيف ثنائي ولم يُفكّ؛ اطلب من المستخدم فكّه وإرفاق الملفات المطلوبة نصيًا.]`,
          });
          continue;
        }
        if ((file.size ?? 0) > 400_000) {
          alertCompat('ملف كبير', `"${file.name}" أكبر من 400KB — تم تجاهله.`);
          continue;
        }
        const response = await fetch(file.uri);
        let content = await response.text();
        if (content.length > 30_000) {
          content = content.slice(0, 30_000) + '\n…(مقتطع)';
        }
        loaded.push({ name: file.name, content });
      }
      if (loaded.length) setAttachFiles((cur) => [...cur, ...loaded]);
    } catch (error) {
      alertCompat('تعذّر إرفاق الملفات', error instanceof Error ? error.message : 'حاولي مرة أخرى.');
    }
  }

  /** Voice input: Web Speech API on web, native speech module on Android. */
  async function toggleVoice() {
    if (listening) {
      if (Platform.OS === 'web') recognitionRef.current?.stop();
      else await speechService.stopListening().catch(() => undefined);
      setListening(false);
      return;
    }
    if (Platform.OS === 'web') {
      const w = window as unknown as Record<string, unknown>;
      const SR = (w.SpeechRecognition ?? w.webkitSpeechRecognition) as
        | (new () => {
            lang: string;
            interimResults: boolean;
            continuous: boolean;
            onresult: (event: { resultIndex: number; results: { isFinal: boolean; 0?: { transcript?: string } }[] }) => void;
            onend: () => void;
            onerror: () => void;
            start: () => void;
            stop: () => void;
          })
        | undefined;
      if (!SR) {
        alertCompat(
          'الإدخال الصوتي',
          'هذا المتصفح لا يدعم الإدخال الصوتي. يعمل على Chrome/Edge، أو من نسخة Android المثبتة.',
        );
        return;
      }
      const rec = new SR();
      rec.lang = 'ar-SA';
      rec.interimResults = true;
      rec.continuous = false;
      let finalText = '';
      rec.onresult = (event) => {
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const chunk = event.results[i]?.[0]?.transcript ?? '';
          if (event.results[i]?.isFinal) finalText += chunk;
          else interim += chunk;
        }
        const combined = (finalText + interim).trim();
        if (combined) setDraft(combined);
      };
      rec.onend = () => setListening(false);
      rec.onerror = () => setListening(false);
      recognitionRef.current = rec;
      setListening(true);
      try {
        rec.start();
      } catch {
        setListening(false);
        alertCompat('الإدخال الصوتي', 'تعذّر بدء الميكروفون — تحقق من إذن الميكروفون للمتصفح.');
      }
      return;
    }
    // Native (Android dev build): single-shot recognition via the speech module.
    setListening(true);
    try {
      const results = await speechService.startListening({ language: 'ar-SA' });
      const text = (results ?? []).join(' ').trim();
      if (text) setDraft((cur) => (cur ? `${cur} ${text}` : text));
    } catch {
      alertCompat(
        'الإدخال الصوتي',
        'خدمة التعرف على الصوت غير متاحة هنا — يحتاج الإذن من النظام أو نسخة APK مثبتة.',
      );
    } finally {
      setListening(false);
    }
  }

  function requestApproval(
    spec: ToolSpec,
    args: Record<string, unknown>,
  ): Promise<ApprovalDecision> {    const key = approvalKey(spec, args);
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

  async function sendMessage(explicitText?: string, alreadyEnriched = false) {
    let text = (explicitText ?? draft).trim();
    if (!text || sending) {
      // While a run is active, new messages join the queue instead of being lost.
      if (sending && text) setQueue((q) => [...q, text]);
      return;
    }
    if (text.startsWith('/') && !alreadyEnriched) {
      const outcome = await handleSlashCommand(text);
      if (outcome.handled) {
        setDraft('');
        return;
      }
      // /skill N <request> — keep the user's request, drop the command token so
      // the message reads naturally, and mark as enriched to avoid double handling.
      if (outcome.text && outcome.text !== text) {
        return sendMessage(outcome.text.replace(/^\/skill\s+\S+\s*/, '').trim() || outcome.text, true);
      }
    }
    // Smart skill detection: instructions go to the MODEL only — the user's
    // stored/displayed message stays clean.
    let enrichedSkill: string | null = null;
    const displayText = text;
    let wireText = text;
    // Automatic knowledge base: retrieve durable user facts relevant to THIS
    // message (local, instant, invisible in the UI).
    const remembered = retrieveKnowledge(knowledge ?? [], text);
    const knowBlock = knowledgeContextBlock(remembered);
    if (knowBlock) {
      wireText += `\n\n${knowBlock}`;
    }
    // Attached files: their content rides along to the model.
    for (const f of attachFiles) {
      wireText += `\n\n[ملف مرفق: ${f.name}]\n${f.content}`;
    }
    if (!alreadyEnriched) {
      const matched = autoMatchSkill(text);
      if (matched) {
        enrichedSkill = matched.name;
        wireText =
          text +
          '\n\n[تعليمات المهارة «' +
          matched.name +
          '» — اتبعها بدقة أثناء تنفيذ الطلب]\n' +
          matched.instructions;
      }
    }
    if (!provider.model.trim() || (!apiKeyConfigured && !provider.keyless)) {
      alertCompat(
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
      content: displayText,
      createdAt: new Date().toISOString(),
      skill: enrichedSkill ?? undefined,
      imageUri: attachImages[0],
      images: attachImages.length ? attachImages : undefined,
      files: attachFiles.length ? attachFiles.map((f) => f.name) : undefined,
    };
    setAttachImages([]);
    setAttachFiles([]);
    const wireUserMessage: ChatMessage = { ...userMessage, content: wireText };
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
      const apiKey = provider.keyless ? '' : await getStoredModelApiKey();

      const deviceOn = agent.deviceControlEnabled;
      const promptOptions = {
        deviceControl: deviceOn,
        deviceAvailable: Device.isAvailable(),
        summary: activeSession?.summary,
        responseStyle: agent.responseStyle,
        replyLanguage: appearance?.language,
        mode: (activeSession?.mode as StudioMode | undefined) ?? undefined,
      };
      const system = buildAssistantSystemPrompt(skills, memories, promptOptions);

      // Auto-compaction: the chat never "fills up". Old turns are folded into a summary.
      const budget = workingBudget(provider, agent.maxWorkingTokens);
      const plan = planContext(activeSession, [wireUserMessage], estimateTokens(system), budget);
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
            ...promptOptions,
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
          executeTool(name, args, {
            skills,
            memories,
            sessions,
            createMemory,
            createTask: (input) => handleCreateTask(input),
          }),
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
        sessionId,
        originalUserMessage: wireUserMessage.content,
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
      setThinkingOpen(false);
      // Knowledge base update runs in the background: durable first-person
      // facts from THIS user message join the store silently.
      void addKnowledge(extractFacts(displayText), sessionId).catch(() => undefined);
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
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
      >
        <ScreenTopBar active="index" />
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

        {(!apiKeyConfigured && !provider.keyless) || !provider.model ? (
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
          <HomeScreen
            onNewChat={startNewChat}
            onOpenSettings={() => router.push('/(tabs)/settings')}
            onOpenSkills={() => router.push('/(tabs)/skills')}
            onOpenTasks={() => router.push('/(tabs)/tasks')}
            onOpenMemory={() => router.push('/(tabs)/memory')}
            onOpenProviderSelector={() => router.push('/(tabs)/settings')}
            onSuggest={(text) => {
              setDraft(text);
              setShowSlash(false);
              setShowSkillMenu(false);
              requestAnimationFrame(() => inputRef.current?.focus());
            }}
            onUseSkill={(name) => void pickSkill(name)}
          />
        ) : (
          <FlatList
            style={styles.messages}
            data={reversed}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <MessageBubble
                message={item}
                onEditMessage={item.role === 'user' ? (content) => void sendMessage(content) : undefined}
                onPreview={setPreviewHtml}
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
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={thinkingOpen ? t('hideThinking') : t('showThinking')}
              onPress={() => setThinkingOpen((o) => !o)}
              style={styles.thinkingBarHead}
            >
              <Feather name="cpu" size={13} color={colors.primary} />
              <Text style={[styles.thinkingBarText, { color: colors.mutedForeground }]}>
                {t('thinking')}
              </Text>
              <Feather
                name={thinkingOpen ? 'chevron-down' : 'chevron-up'}
                size={13}
                color={colors.mutedForeground}
              />
            </Pressable>
            {thinkingOpen ? (
              <ScrollView
                style={styles.thinkingLiveBox}
                nestedScrollEnabled
                showsVerticalScrollIndicator
              >
                <Text style={[styles.thinkingLiveText, { color: colors.mutedForeground }]} selectable>
                  {thinkingPreview}
                </Text>
              </ScrollView>
            ) : (
              <Text style={[styles.thinkingBarTail, { color: colors.mutedForeground }]} numberOfLines={2}>
                {thinkingPreview.slice(-170)}
              </Text>
            )}
          </View>
        ) : null}

        {queue.length ? (
          <View style={[styles.queueList, { borderColor: colors.border }]}>
            {queue.map((item, i) => (
              <View key={`${i}-${item.slice(0, 10)}`} style={styles.queueRow}>
                <Feather name="clock" size={12} color={colors.warning} />
                <Text style={[styles.queueText, { color: colors.mutedForeground }]} numberOfLines={1}>
                  {item}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${t('remove')} ${i + 1}`}
                  onPress={() => setQueue((cur) => cur.filter((_, idx) => idx !== i))}
                  style={styles.queueRemove}
                  hitSlop={6}
                >
                  <Feather name="x" size={13} color={colors.mutedForeground} />
                </Pressable>
              </View>
            ))}
          </View>
        ) : null}

        <View
          style={[
            styles.composerWrap,
            {
              backgroundColor: colors.background,
              borderTopColor: colors.border,
              paddingBottom: Math.max(insets.bottom, 8) + 6,
            },
          ]}
        >
          {/* The model actually in use — visible at all times, tap to change it. */}
          {provider.model ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('modelInUse')}
              onPress={() => router.push('/(tabs)/settings')}
              style={[styles.modelChip, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <Feather name="cpu" size={12} color={colors.primary} />
              <Text style={[styles.modelChipText, { color: colors.mutedForeground }]} numberOfLines={1}>
                {t('modelInUse')}: {provider.model}
                {provider.free ? ' · مجاني' : provider.promptPrice !== null ? ' · مدفوع' : ''}
              </Text>
              <Feather name="chevron-left" size={13} color={colors.mutedForeground} />
            </Pressable>
          ) : null}
          <View
            style={[
              styles.composer,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            {/* Attach menu overlay: opens above the "+" button */}
            {attachMenuVisible ? (
              <View style={[styles.attachMenu, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('attachImage')}
                  onPress={() => {
                    setAttachMenuVisible(false);
                    void attachImage();
                  }}
                  style={styles.attachMenuItem}
                >
                  <Feather name="image" size={16} color={colors.primary} />
                  <Text style={[styles.attachMenuItemText, { color: colors.foreground }]}>
                    {t('attachImage')}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('attachFiles')}
                  onPress={() => {
                    setAttachMenuVisible(false);
                    void attachFilesPicker();
                  }}
                  style={styles.attachMenuItem}
                >
                  <Feather name="paperclip" size={16} color={colors.primary} />
                  <Text style={[styles.attachMenuItemText, { color: colors.foreground }]}>
                    {t('attachFiles')}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('attachZip')}
                  onPress={() => {
                    setAttachMenuVisible(false);
                    void attachFilesPicker({ zipsOnly: true });
                  }}
                  style={styles.attachMenuItem}
                >
                  <Feather name="archive" size={16} color={colors.primary} />
                  <Text style={[styles.attachMenuItemText, { color: colors.foreground }]}>
                    {t('attachZip')}
                  </Text>
                </Pressable>
              </View>
            ) : null}
            <View style={styles.composerButtons}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('attach')}
                onPress={() => setAttachMenuVisible((v) => !v)}
                style={[
                  styles.attachBtn,
                  {
                    borderColor: attachMenuVisible ? colors.primary : colors.border,
                    backgroundColor: attachMenuVisible ? colors.accent : 'transparent',
                  },
                ]}
              >
                <Feather name="plus" size={19} color={colors.primary} />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={listening ? 'إيقاف الإدخال الصوتي' : 'إدخال صوتي'}
                onPress={() => void toggleVoice()}
                style={[
                  styles.voiceBtn,
                  {
                    borderColor: listening ? colors.destructive : colors.border,
                    backgroundColor: listening ? `${colors.destructive}22` : 'transparent',
                  },
                ]}
              >
                <Feather name="mic" size={18} color={listening ? colors.destructive : colors.primary} />
              </Pressable>
            </View>
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
            {attachFiles.length ? (
              <View style={styles.fileChipsRow}>
                {attachFiles.map((f, i) => (
                  <View key={i} style={[styles.fileChip, { backgroundColor: colors.accent }]}>
                    <Feather name="file-text" size={11} color={colors.primary} />
                    <Text style={[styles.fileChipText, { color: colors.primary }]} numberOfLines={1}>
                      {f.name}
                    </Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`إزالة ${f.name}`}
                      onPress={() => setAttachFiles((cur) => cur.filter((_, idx) => idx !== i))}
                    >
                      <Feather name="x" size={13} color={colors.mutedForeground} />
                    </Pressable>
                  </View>
                ))}
              </View>
            ) : null}
            {attachImages.length ? (
              <View style={styles.attachPreviewWrap}>
                {attachImages.map((uri, i) => (
                  <View key={`${i}-${uri.slice(24, 40)}`} style={styles.attachPreviewItem}>
                    <RNImage source={{ uri }} style={styles.attachPreview} />
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`${t('remove')} ${i + 1}`}
                      onPress={() => setAttachImages((cur) => cur.filter((_, idx) => idx !== i))}
                      style={styles.attachRemove}
                    >
                      <Feather name="x-circle" size={16} color={colors.destructive} />
                    </Pressable>
                  </View>
                ))}
              </View>
            ) : null}
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
              accessibilityLabel={sending ? t('stop') : t('send')}
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

      <HtmlPreview
        visible={previewHtml !== null}
        html={previewHtml ?? ''}
        onClose={() => setPreviewHtml(null)}
      />

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
                      alertCompat('حذف المحادثة؟', 'لا يمكن استعادتها بعد الحذف.', [
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
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm + spacing.xs,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  headerCopy: { flex: 1, alignItems: 'flex-end' },
  eyebrow: { fontSize: typography.xs, fontWeight: typography.weightBold, letterSpacing: 1 },
  title: { fontSize: typography.xl, fontWeight: typography.weightBold, marginTop: spacing.xs, textAlign: 'right' },
  subtitle: { fontSize: typography.xs + 1, marginTop: spacing.xs, textAlign: 'right' },
  headerActions: { flexDirection: 'row', gap: spacing.xs },
  headerButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: radius.md,
  },
  setupBanner: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm + spacing.xs,
    padding: spacing.sm + spacing.xs,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: spacing.sm + spacing.xs,
  },
  bannerIcon: { width: 35, height: 35, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  bannerCopy: { flex: 1, alignItems: 'flex-end' },
  bannerTitle: { fontSize: typography.sm + 1, fontWeight: typography.weightBold, textAlign: 'right' },
  bannerBody: { fontSize: typography.xs + 1, marginTop: spacing.xs, textAlign: 'right' },
  emptyWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  heroIcon: {
    width: 58,
    height: 58,
    borderRadius: radius.xl,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  heroTitle: { fontSize: typography.xxl + 1, fontWeight: typography.weightBold, textAlign: 'center' },
  heroBody: { fontSize: typography.sm + 1, lineHeight: 21, textAlign: 'center', marginTop: spacing.sm, maxWidth: 330 },
  suggestions: { width: '100%', gap: spacing.sm, marginTop: spacing.md },
  suggestion: {
    minHeight: 42,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  suggestionText: { fontSize: typography.sm, textAlign: 'right' },
  messages: { flex: 1 },
  messageList: { paddingHorizontal: spacing.md - 1, paddingTop: spacing.sm + spacing.xs, gap: spacing.md - 3 },
  // Alignment is explicit and LTR-row based: assistant hugs the LEFT edge
  // (avatar first), user hugs the RIGHT edge — deterministic in RTL and LTR.
  messageRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'flex-start', gap: spacing.sm, marginBottom: spacing.md - spacing.xs },
  userMessageRow: { flexDirection: 'row', justifyContent: 'flex-end' },
  avatar: { width: 28, height: 28, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  bubble: {
    maxWidth: '85%',
    borderWidth: 1,
    paddingVertical: spacing.sm + spacing.xs,
    paddingHorizontal: spacing.sm + spacing.xs + 1,
    borderRadius: radius.lg - 1,
  },
  messageText: { fontSize: typography.md, lineHeight: 22, textAlign: 'auto' },
  diffLine: { fontFamily: 'monospace', fontSize: 12.5, lineHeight: 19, textAlign: 'left', writingDirection: 'ltr' },
  thinkingToggle: { flexDirection: 'row-reverse', alignItems: 'center', gap: spacing.xs + 2, borderTopWidth: 1, paddingTop: spacing.sm, marginTop: spacing.sm },
  thinkingToggleText: { fontSize: typography.xs + 1, fontWeight: typography.weightBold },
  thinkingBox: { borderWidth: 1, borderRadius: radius.md - 2, padding: spacing.sm + spacing.xs, marginTop: spacing.sm, marginBottom: spacing.sm, maxHeight: 220, overflow: 'hidden' },
  thinkingText: { fontSize: typography.sm, lineHeight: 19, textAlign: 'right' },
  thinkingBar: {
    borderWidth: 1,
    borderRadius: radius.md - 2,
    paddingHorizontal: spacing.sm + spacing.xs,
    paddingVertical: spacing.sm,
    marginHorizontal: spacing.md - 2,
    marginBottom: spacing.xs + 2,
  },
  thinkingBarHead: { flexDirection: 'row-reverse', alignItems: 'center', gap: spacing.xs + 2 },
  thinkingBarText: { flex: 1, fontSize: typography.xs + 1, fontWeight: typography.weightBold },
  thinkingBarTail: { fontSize: typography.xs, lineHeight: 17, marginTop: spacing.xs, textAlign: 'right' },
  thinkingLiveBox: { maxHeight: 190, marginTop: spacing.xs, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', borderRadius: radius.sm, padding: spacing.sm, backgroundColor: 'rgba(0,0,0,0.25)' },
  thinkingLiveText: { fontSize: typography.xs, lineHeight: 18, textAlign: 'right' },
  queueList: {
    borderWidth: 1,
    borderRadius: radius.md - 2,
    marginHorizontal: spacing.md - 2,
    marginBottom: spacing.xs + 2,
    paddingVertical: spacing.xs,
  },
  queueRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: spacing.xs + 2, paddingHorizontal: spacing.sm + 2, paddingVertical: 5 },
  queueText: { flex: 1, fontSize: typography.xs + 1 },
  queueRemove: { padding: 3 },
  attachMenu: {
    position: 'absolute',
    bottom: 58,
    left: spacing.sm + 2,
    minWidth: 168,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: spacing.xs,
    zIndex: 60,
    elevation: 60,
  },
  attachMenuItem: { flexDirection: 'row-reverse', alignItems: 'center', gap: spacing.sm, paddingVertical: 9, paddingHorizontal: spacing.sm + 4 },
  attachMenuItemText: { fontSize: typography.sm, fontWeight: typography.weightBold },
  bubbleImagesWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.xs },
  attachPreviewItem: { position: 'relative' },
  iconAction: {
    width: 30,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  userActions: { flexDirection: 'row-reverse', alignItems: 'center', gap: spacing.xs + 1, borderTopWidth: 1, marginTop: spacing.sm, paddingTop: spacing.xs + 3 },
  userActionText: { fontSize: typography.xs + 1, fontWeight: typography.weightBold },
  contextChip: { fontSize: typography.xs, fontWeight: typography.weightBold, marginTop: spacing.xs, textAlign: 'right' },
  planBar: { borderWidth: 1, borderRadius: radius.md, marginHorizontal: spacing.md - 2, marginBottom: spacing.sm, padding: spacing.sm + spacing.xs, gap: spacing.xs + 3 },
  planHead: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  planTitle: { flex: 1, fontSize: typography.sm, fontWeight: typography.weightBold, textAlign: 'right' },
  planRow: { flexDirection: 'row-reverse', alignItems: 'flex-start', gap: spacing.xs + 3 },
  planText: { flex: 1, fontSize: typography.sm, lineHeight: spacing.md + 2, textAlign: 'right' },
  slashMenu: {
    position: 'absolute',
    bottom: '78%',
    right: spacing.md - 2,
    left: spacing.md - 2,
    borderWidth: 1,
    borderRadius: radius.md,
    maxHeight: 300,
    zIndex: 50,
    elevation: 50,
  },
  skillMenu: { maxHeight: 300, paddingVertical: spacing.xs + 2, paddingHorizontal: spacing.xs },
  slashHeader: { fontSize: typography.xs + 1, fontWeight: typography.weightBold, padding: spacing.sm, textAlign: 'right' },
  slashItem: { borderBottomWidth: 1, paddingHorizontal: spacing.sm + spacing.xs, paddingVertical: spacing.sm + spacing.xs },
  slashText: { fontSize: typography.sm + 1, fontWeight: typography.weightSemiBold, textAlign: 'right' },
  attachBtn: {
    width: 38,
    height: 38,
    borderRadius: radius.md - 2,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  voiceBtn: {
    width: 38,
    height: 38,
    borderRadius: radius.md - 2,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modelChip: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    borderWidth: 1,
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm + spacing.xs,
    paddingVertical: spacing.xs + 1,
    marginBottom: spacing.sm,
    maxWidth: '100%',
  },
  modelChipText: { fontSize: typography.xs + 1, fontWeight: typography.weightSemiBold, flexShrink: 1 },
  assistantActions: { flexDirection: 'row-reverse', alignItems: 'center', gap: spacing.md, borderTopWidth: 1, marginTop: spacing.xs + 5, paddingTop: spacing.sm },
  shareDraftStart: { borderTopWidth: 0, marginTop: 0, paddingTop: 0 },
  attachPreviewWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, paddingHorizontal: spacing.sm + 2, paddingTop: spacing.xs },
  composerButtons: { flexDirection: 'row-reverse', alignItems: 'flex-end', gap: spacing.xs + 2 },
  fileChipsRow: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: spacing.xs + 2, marginTop: spacing.sm },
  fileChip: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: spacing.xs + 1,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    maxWidth: 180,
  },
  fileChipText: { fontSize: typography.xs, fontWeight: typography.weightBold, flexShrink: 1 },
  attachPreview: { width: 52, height: 52, borderRadius: radius.md - 2 },
  attachRemove: { position: 'absolute', top: -spacing.xs - 2, left: -spacing.xs - 2 },
  bubbleImage: { width: 200, height: 200, borderRadius: radius.md - 2, marginBottom: spacing.sm },
  skillChip: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: spacing.xs + 1,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    alignSelf: 'flex-start',
    marginBottom: spacing.xs + 3,
  },
  skillChipText: { fontSize: typography.xs, fontWeight: typography.weightBold },
  bulletRow: { flexDirection: 'row-reverse', alignItems: 'flex-start', gap: spacing.xs + 3 },
  bulletDot: { width: 6, height: 6, borderRadius: 3, marginTop: 9 },
  listNumber: { fontSize: typography.sm + 1, fontWeight: typography.weightBold, marginTop: 1 },
  slashSub: { fontSize: typography.xs, marginTop: spacing.xs, textAlign: 'right' },
  shareDraft: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'flex-start', gap: spacing.xs + 2, borderTopWidth: 1, marginTop: spacing.xs + 5, paddingTop: spacing.sm },
  shareDraftText: { fontSize: typography.xs + 1, fontWeight: typography.weightBold },
  steps: { gap: spacing.xs + 1, marginBottom: spacing.sm },
  stepRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: spacing.xs + 2 },
  stepText: { fontSize: typography.xs + 1, flexShrink: 1, textAlign: 'right' },
  typingRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: spacing.sm, padding: spacing.sm + spacing.xs },
  typingText: { fontSize: typography.sm },
  errorBox: {
    flexDirection: 'row-reverse',
    alignItems: 'flex-start',
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.md - 1,
    padding: spacing.sm + spacing.xs,
    marginHorizontal: spacing.md - 2,
    marginBottom: spacing.sm,
  },
  errorText: { flex: 1, fontSize: typography.sm, lineHeight: spacing.md + 2, textAlign: 'right' },
  notice: { marginHorizontal: spacing.md - 2, marginBottom: spacing.sm, borderRadius: radius.md - 2, padding: spacing.sm + spacing.xs },
  noticeText: { fontSize: typography.sm, lineHeight: spacing.md + 2, textAlign: 'right' },
  composerWrap: { borderTopWidth: 1, paddingHorizontal: spacing.sm + spacing.xs, paddingTop: spacing.sm + spacing.xs },
  composer: {
    flexDirection: 'row-reverse',
    alignItems: 'flex-end',
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.lg + 2,
    paddingLeft: spacing.xs + 3,
    paddingRight: spacing.sm + spacing.xs + 1,
    paddingVertical: spacing.xs + 3,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    paddingVertical: spacing.sm + 1,
    fontSize: typography.md,
    textAlign: 'right',
  },
  sendButton: { width: 38, height: 38, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  privacyNote: { fontSize: 9, lineHeight: 13, textAlign: 'center', marginTop: spacing.xs + 3 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(4,13,10,0.45)', justifyContent: 'flex-end' },
  historySheet: { maxHeight: '78%', minHeight: '44%', borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingHorizontal: spacing.md + 3, paddingTop: spacing.md + 2, paddingBottom: spacing.lg },
  sheetHeader: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  sheetTitle: { fontSize: typography.xl, fontWeight: typography.weightBold },
  newChatRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: spacing.sm + 1, padding: spacing.sm + spacing.xs, borderRadius: radius.md, marginBottom: spacing.sm },
  newChatText: { fontSize: typography.sm + 1, fontWeight: typography.weightBold },
  historyRow: { flexDirection: 'row-reverse', alignItems: 'center', borderBottomWidth: 1, paddingVertical: spacing.md - spacing.xs },
  historySelect: { flex: 1, alignItems: 'flex-end', gap: spacing.xs },
  historyTitle: { fontSize: typography.md, fontWeight: typography.weightSemiBold, maxWidth: '100%' },
  historyDate: { fontSize: typography.xs },
  deleteButton: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  emptyHistory: { textAlign: 'center', paddingVertical: spacing.md, fontSize: typography.sm + 1 },
});
