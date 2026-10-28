import { storage } from './storage';
import type { KnowledgeEntry, ExtractedFact } from './knowledge';
import { mergeFacts, KNOWLEDGE_MAX_ENTRIES } from './knowledge';
import { DEFAULT_RESPONSE_STYLE, normalizeResponseStyle, type ResponseStyle } from './response-style';
import { coreSkillsAsAssistantSkills } from './core-skills';
import type { AccentKey } from '../constants/colors';
export type { AccentKey };
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

export type ChatRole = 'user' | 'assistant';

export interface ToolStep {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  status: 'running' | 'done' | 'error' | 'denied';
  result: string;
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  /** Tools the assistant used while producing this message (for display only). */
  steps?: ToolStep[];
  /** Reasoning-model thinking captured while streaming (DeepSeek-R1 style). */
  thinking?: string;
  /** Name of the skill auto-applied to this message (display chip). */
  skill?: string;
  /** Attached image (data or file URI) sent with this message, if any. */
  imageUri?: string;
  /** Attached images (data URIs) — unlimited per message. */
  images?: string[];
  /** Names of text files attached to this message (display chips). */
  files?: string[];
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
  /** Running summary of the oldest messages (auto-compaction keeps chats from ever "filling up"). */
  summary?: string;
  /** How many leading messages are already folded into `summary`. */
  summarizedCount?: number;
  /** Studio mode tag (marketing/developer/hunter) — drives the system directive. */
  mode?: string;
}

export interface ProviderSettings {
  baseUrl: string;
  model: string;
  providerName: string;
  /** Filled automatically when a model is picked from the provider's catalogue. */
  contextLength?: number | null;
  promptPrice?: number | null;
  completionPrice?: number | null;
  free?: boolean;
  /** Keyless providers (Free OneByte) need no API key at all. */
  keyless?: boolean;
}

export interface AgentSettings {
  /** Master switch: when off, the model gets no device tools at all. */
  deviceControlEnabled: boolean;
  /** Max tool rounds per message. */
  maxSteps: number;
  /** Upper bound of tokens sent per request; older turns are summarised past this. */
  maxWorkingTokens: number;
  /**
   * Tools the user marked "دائمًا" — approval is skipped for these keys.
   * Key format: tool name, or `open_app:<package>` for a specific app.
   */
  autoApprovedTools: string[];
  /** The invisible reply-styling backend ("مهارة الرد") applied to every response. */
  responseStyle: ResponseStyle;
}

export type ThemePreference = 'system' | 'light' | 'dark';

export interface AppearanceSettings {
  theme: ThemePreference;
  /** Accent color theme (default emerald; also blue/red/purple/amber). */
  accent: AccentKey;
  /** App UI + model reply language code (see src/i18n.ts). */
  language: string;
}

export interface SkillVersion {
  version: number;
  name: string;
  description: string;
  instructions: string;
  savedAt: string;
}

export interface AssistantSkill {
  id: string;
  name: string;
  description: string;
  instructions: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  versions: SkillVersion[];
  /** Core built-in skill (shipped with the app; seeded automatically). */
  core?: boolean;
}

export interface AssistantMemory {
  id: string;
  title: string;
  content: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DailyTask {
  id: string;
  title: string;
  prompt: string;
  time: string;
  active: boolean;
  notificationId?: string;
  createdAt: string;
}

interface AssistantData {
  sessions: ChatSession[];
  activeSessionId: string | null;
  provider: ProviderSettings;
  skills: AssistantSkill[];
  memories: AssistantMemory[];
  tasks: DailyTask[];
  agent: AgentSettings;
  appearance: AppearanceSettings;
  /** Automatic per-user knowledge base (background facts, not shown in chat). */
  knowledge: KnowledgeEntry[];
}

export type { AssistantData };

interface AssistantContextValue extends AssistantData {
  loading: boolean;
  storageError: string | null;
  apiKeyConfigured: boolean;
  pendingPrompt: string;
  activeSession: ChatSession | null;
  setActiveSession: (id: string) => Promise<void>;
  createSession: () => Promise<string>;
  deleteSession: (id: string) => Promise<void>;
  appendMessage: (sessionId: string, message: ChatMessage) => Promise<void>;
  saveProvider: (
    settings: ProviderSettings,
    apiKey?: string,
  ) => Promise<void>;
  removeApiKey: () => Promise<void>;
  createSkill: (input: {
    name: string;
    description: string;
    instructions: string;
  }) => Promise<void>;
  updateSkill: (
    id: string,
    input: { name: string; description: string; instructions: string },
  ) => Promise<void>;
  setSkillActive: (id: string, active: boolean) => Promise<void>;
  createMemory: (input: { title: string; content: string }) => Promise<void>;
  updateMemory: (
    id: string,
    input: { title: string; content: string },
  ) => Promise<void>;
  setMemoryActive: (id: string, active: boolean) => Promise<void>;
  createTask: (input: {
    title: string;
    prompt: string;
    time: string;
    notificationId?: string;
  }) => Promise<string>;
  setTaskActive: (
    id: string,
    active: boolean,
    notificationId?: string,
  ) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  patchSession: (
    id: string,
    patch: Partial<Pick<ChatSession, 'summary' | 'summarizedCount' | 'mode'>>,
  ) => Promise<void>;
  saveAgentSettings: (patch: Partial<AgentSettings>) => Promise<void>;
  saveAppearanceSettings: (patch: Partial<AppearanceSettings>) => Promise<void>;
  /** Merge extracted facts into the automatic knowledge base (background). */
  addKnowledge: (facts: ExtractedFact[], sessionId?: string) => Promise<void>;
  /** Wipe the automatic knowledge base (privacy control in Memory screen). */
  clearKnowledge: () => Promise<void>;
  setPendingPrompt: (prompt: string) => void;
  consumePendingPrompt: () => void;
  exportLocalData: () => string;
}

const DATA_KEY = '@onebyte-agent/assistant-v1';
// Out of the box the app works on Free OneByte: a keyless free endpoint
// that runs entirely from the phone — no key, no external device.
const DEFAULT_PROVIDER: ProviderSettings = {
  baseUrl: 'https://text.pollinations.ai/openai',
  model: 'openai',
  providerName: 'Free OneByte',
  keyless: true,
  free: true,
};

const DEFAULT_AGENT: AgentSettings = {
  deviceControlEnabled: false,
  maxSteps: 25,
  maxWorkingTokens: 100_000,
  autoApprovedTools: [],
  responseStyle: DEFAULT_RESPONSE_STYLE,
};

const DEFAULT_APPEARANCE: AppearanceSettings = {
  theme: 'system',
  accent: 'emerald',
  language: 'ar',
};

let idCounter = 0;
function makeId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now()}-${idCounter}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function now(): string {
  return new Date().toISOString();
}

function newSession(): ChatSession {
  const timestamp = now();
  return {
    id: makeId('chat'),
    title: 'محادثة جديدة',
    messages: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function normalizeData(raw: unknown): AssistantData {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Saved assistant data is not valid.');
  }
  const value = raw as Partial<AssistantData>;
  return {
    sessions: Array.isArray(value.sessions) ? value.sessions : [],
    activeSessionId:
      typeof value.activeSessionId === 'string' ? value.activeSessionId : null,
    provider: {
      ...DEFAULT_PROVIDER,
      ...(value.provider && typeof value.provider === 'object'
        ? value.provider
        : {}),
    },
    skills: Array.isArray(value.skills) ? value.skills : [],
    memories: Array.isArray(value.memories) ? value.memories : [],
    tasks: Array.isArray(value.tasks) ? value.tasks : [],
    agent: {
      ...DEFAULT_AGENT,
      ...(value.agent && typeof value.agent === 'object' ? value.agent : {}),
      autoApprovedTools: Array.isArray(value.agent?.autoApprovedTools)
        ? value.agent.autoApprovedTools.filter((x): x is string => typeof x === 'string')
        : [],
      // Legacy stored data has no responseStyle — normalize with tolerance.
      responseStyle: normalizeResponseStyle(value.agent?.responseStyle),
    },
    appearance: {
      ...DEFAULT_APPEARANCE,
      ...(value.appearance && typeof value.appearance === 'object' ? value.appearance : {}),
    },
    knowledge: Array.isArray(value.knowledge) ? value.knowledge : [],
  };
}

async function readApiKey(): Promise<string | null> {
  // Route through storage so native (SecureStore) and the disclosed desktop
  // browser adapter share ONE key id. Previously this read a different
  // SecureStore id than the one written by storage.saveApiKey, which broke
  // keyed providers everywhere.
  return storage.readApiKey();
}

const AssistantContext = createContext<AssistantContextValue | null>(null);

export function AssistantProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [data, setData] = useState<AssistantData>({
    sessions: [],
    activeSessionId: null,
    provider: DEFAULT_PROVIDER,
    skills: [],
    memories: [],
    tasks: [],
    agent: DEFAULT_AGENT,
    appearance: DEFAULT_APPEARANCE,
    knowledge: [],
  });
  const dataRef = useRef(data);
  const [loading, setLoading] = useState(true);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [apiKeyConfigured, setApiKeyConfigured] = useState(false);
  const [pendingPrompt, setPendingPromptState] = useState('');
  // Mutations wait for the initial storage read: acting on the defaults
  // before hydration would silently overwrite the user's saved data.
  const loadPromiseRef = useRef<Promise<void> | null>(null);
  const ensureLoaded = useCallback(async () => {
    if (loadPromiseRef.current) await loadPromiseRef.current;
  }, []);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const restored = await storage.loadAll();
        // Legacy tolerance: give stored agent/appearance the new fields
        // (responseStyle defaults, accent + language) before anything reads them.
        restored.appearance = {
          ...DEFAULT_APPEARANCE,
          ...(restored.appearance ?? {}),
        };
        restored.agent = {
          ...DEFAULT_AGENT,
          ...(restored.agent ?? {}),
          responseStyle: normalizeResponseStyle(restored.agent?.responseStyle),
        };
        const key = await storage.readApiKey();
        // Seed the core built-in skills exactly once: when no core skill is
        // stored yet. User-created skills always come after them.
        let skills = Array.isArray(restored.skills) ? restored.skills : [];
        if (!skills.some((skill) => skill.core)) {
          skills = [...coreSkillsAsAssistantSkills(), ...skills];
          restored.skills = skills;
          void storage.setSkills(skills);
        } else {
          // Keep core skills in sync with the shipped copy (copy upgrades),
          // while respecting each skill's active/archived state.
          const seeds = coreSkillsAsAssistantSkills();
          let changed = false;
          skills = skills.map((skill) => {
            if (!skill.core) return skill;
            const seed = seeds.find((s) => s.name === skill.name);
            if (!seed || seed.instructions === skill.instructions) return skill;
            changed = true;
            return {
              ...skill,
              description: seed.description,
              instructions: seed.instructions,
              versions: [...skill.versions, { version: skill.versions.length + 1, name: seed.name, description: seed.description, instructions: seed.instructions, savedAt: now() }],
              updatedAt: now(),
            };
          });
          if (changed) {
            restored.skills = skills;
            void storage.setSkills(skills);
          }
        }
        if (!active) return;
        dataRef.current = restored;
        setData(restored);
        setApiKeyConfigured(Boolean(key));
        setStorageError(null);
      } catch {
        if (active) {
          setStorageError(
            'تعذّر قراءة البيانات المحفوظة. أغلقي التطبيق وافتحيه مجددًا، أو صدّري نسخة قبل أي إعادة ضبط.',
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    };
    loadPromiseRef.current = load();
    void loadPromiseRef.current;
    return () => {
      active = false;
    };
  }, []);

  // Optimistic updates: update local state immediately, persist in background.
  const persist = useCallback(async (patch: Partial<AssistantData>) => {
    const next = { ...dataRef.current, ...patch };
    dataRef.current = next;
    setData(next);
    try {
      await Promise.all([
        patch.sessions !== undefined ? storage.setSessions(next.sessions) : Promise.resolve(),
        patch.activeSessionId !== undefined ? storage.setActiveSessionId(next.activeSessionId) : Promise.resolve(),
        patch.provider !== undefined ? storage.setProvider(next.provider) : Promise.resolve(),
        patch.skills !== undefined ? storage.setSkills(next.skills) : Promise.resolve(),
        patch.memories !== undefined ? storage.setMemories(next.memories) : Promise.resolve(),
        patch.tasks !== undefined ? storage.setTasks(next.tasks) : Promise.resolve(),
        patch.agent !== undefined ? storage.setAgentSettings(next.agent) : Promise.resolve(),
        patch.appearance !== undefined ? storage.setAppearance(next.appearance) : Promise.resolve(),
        patch.knowledge !== undefined ? storage.setKnowledge(next.knowledge) : Promise.resolve(),
      ]);
      setStorageError(null);
    } catch {
      setStorageError('لم يتم حفظ التغيير على هذا الجهاز. حاولي مرة أخرى.');
      throw new Error('تعذّر حفظ البيانات محليًا.');
    }
  }, []);

  const setActiveSession = useCallback(
    async (id: string) => {
      await ensureLoaded();
      const current = dataRef.current;
      if (!current.sessions.some((session) => session.id === id)) return;
      await persist({ activeSessionId: id });
    },
    [persist],
  );

  const createSession = useCallback(async () => {
    await ensureLoaded();
    const current = dataRef.current;
    const session: ChatSession = {
      id: `session_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      title: 'محادثة جديدة',
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const sessions = [session, ...current.sessions];
    dataRef.current = { ...current, sessions, activeSessionId: session.id };
    setData(dataRef.current);
    try {
      await Promise.all([
        storage.setSessions(sessions),
        storage.setActiveSessionId(session.id),
      ]);
      return session.id;
    } catch {
      setStorageError('لم يتم حفظ الجلسة الجديدة. حاولي مرة أخرى.');
      throw new Error('تعذّر إنشاء جلسة جديدة.');
    }
  }, []);

  const deleteSession = useCallback(
    async (id: string) => {
      await ensureLoaded();
      const current = dataRef.current;
      const sessions = current.sessions.filter((session) => session.id !== id);
      const activeSessionId =
        current.activeSessionId === id ? sessions[0]?.id ?? null : current.activeSessionId;
      dataRef.current = { ...current, sessions, activeSessionId };
      setData(dataRef.current);
      try {
        await Promise.all([
          storage.setSessions(sessions),
          storage.setActiveSessionId(activeSessionId),
        ]);
      } catch {
        setStorageError('لم يتم حذف الجلسة. حاولي مرة أخرى.');
        throw new Error('تعذّر حذف الجلسة.');
      }
    },
    [],
  );

  const appendMessage = useCallback(
    async (sessionId: string, message: ChatMessage) => {
      await ensureLoaded();
      const current = dataRef.current;
      const sessions = current.sessions.map((session) => {
        if (session.id !== sessionId) return session;
        const firstUserMessage = session.messages.length === 0 && message.role === 'user';
        return {
          ...session,
          title: firstUserMessage
            ? message.content.trim().slice(0, 34) || 'محادثة جديدة'
            : session.title,
          messages: [...session.messages, message],
          updatedAt: new Date().toISOString(),
        };
      });
      dataRef.current = { ...current, sessions };
      setData(dataRef.current);
      try {
        // Only sessions key is rewritten — O(1) for the most frequent operation
        await storage.appendMessage(sessionId, message);
      } catch {
        setStorageError('لم يتم حفظ الرسالة. حاولي مرة أخرى.');
        throw new Error('تعذّر حفظ الرسالة.');
      }
    },
    [],
  );

  const saveProvider = useCallback(
    async (settings: ProviderSettings, apiKey?: string) => {
      await ensureLoaded();
      const trimmedKey = apiKey?.trim();
      if (trimmedKey) {
        // storage.saveApiKey routes to SecureStore on native and to the
        // disclosed browser adapter on web/desktop.
        await storage.saveApiKey(trimmedKey);
      }
      const provider = {
        baseUrl: settings.baseUrl.trim().replace(/\/+$/, ''),
        model: settings.model.trim(),
        providerName: settings.providerName.trim() || 'Custom provider',
        contextLength: settings.contextLength ?? null,
        promptPrice: settings.promptPrice ?? null,
        completionPrice: settings.completionPrice ?? null,
        free: settings.free ?? false,
        keyless: settings.keyless ?? false,
      };
      await persist({ provider });
    },
    [persist],
  );

  const removeApiKey = useCallback(async () => {
    await ensureLoaded();
    await storage.removeApiKey();
    setApiKeyConfigured(false);
  }, []);

  const createSkill = useCallback(
    async (input: { name: string; description: string; instructions: string }) => {
      await ensureLoaded();
      const timestamp = now();
      const skill: AssistantSkill = {
        id: makeId('skill'),
        name: input.name.trim(),
        description: input.description.trim(),
        instructions: input.instructions.trim(),
        active: true,
        createdAt: timestamp,
        updatedAt: timestamp,
        versions: [
          {
            version: 1,
            ...input,
            savedAt: timestamp,
          },
        ],
      };
      const skills = [skill, ...dataRef.current.skills];
      dataRef.current = { ...dataRef.current, skills };
      setData(dataRef.current);
      await storage.setSkills(skills);
    },
    [],
  );

  const updateSkill = useCallback(
    async (
      id: string,
      input: { name: string; description: string; instructions: string },
    ) => {
      await ensureLoaded();
      const timestamp = now();
      const skills = dataRef.current.skills.map((skill) => {
        if (skill.id !== id) return skill;
        const version = skill.versions.length + 1;
        return {
          ...skill,
          ...input,
          updatedAt: timestamp,
          versions: [
            ...skill.versions,
            { version, ...input, savedAt: timestamp },
          ],
        };
      });
      dataRef.current = { ...dataRef.current, skills };
      setData(dataRef.current);
      await storage.setSkills(skills);
    },
    [],
  );

  const setSkillActive = useCallback(
    async (id: string, active: boolean) => {
      await ensureLoaded();
      const skills = dataRef.current.skills.map((skill) =>
        skill.id === id ? { ...skill, active, updatedAt: now() } : skill,
      );
      dataRef.current = { ...dataRef.current, skills };
      setData(dataRef.current);
      await storage.setSkills(skills);
    },
    [],
  );

  const createMemory = useCallback(
    async (input: { title: string; content: string }) => {
      await ensureLoaded();
      const timestamp = now();
      const memory: AssistantMemory = {
        id: makeId('memory'),
        title: input.title.trim(),
        content: input.content.trim(),
        active: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      const memories = [memory, ...dataRef.current.memories];
      dataRef.current = { ...dataRef.current, memories };
      setData(dataRef.current);
      await storage.setMemories(memories);
    },
    [],
  );

  const updateMemory = useCallback(
    async (id: string, input: { title: string; content: string }) => {
      await ensureLoaded();
      const memories = dataRef.current.memories.map((memory) =>
        memory.id === id
          ? { ...memory, ...input, updatedAt: now() }
          : memory,
      );
      dataRef.current = { ...dataRef.current, memories };
      setData(dataRef.current);
      await storage.setMemories(memories);
    },
    [],
  );

  const setMemoryActive = useCallback(
    async (id: string, active: boolean) => {
      await ensureLoaded();
      const memories = dataRef.current.memories.map((memory) =>
        memory.id === id ? { ...memory, active, updatedAt: now() } : memory,
      );
      dataRef.current = { ...dataRef.current, memories };
      setData(dataRef.current);
      await storage.setMemories(memories);
    },
    [],
  );

  const createTask = useCallback(
    async (input: {
      title: string;
      prompt: string;
      time: string;
      notificationId?: string;
    }) => {
      await ensureLoaded();
      const task: DailyTask = {
        id: makeId('task'),
        title: input.title.trim(),
        prompt: input.prompt.trim(),
        time: input.time,
        active: true,
        notificationId: input.notificationId,
        createdAt: now(),
      };
      const tasks = [task, ...dataRef.current.tasks];
      dataRef.current = { ...dataRef.current, tasks };
      setData(dataRef.current);
      await storage.setTasks(tasks);
      return task.id;
    },
    [],
  );

  const setTaskActive = useCallback(
    async (id: string, active: boolean, notificationId?: string) => {
      await ensureLoaded();
      const tasks = dataRef.current.tasks.map((task) =>
        task.id === id
          ? { ...task, active, notificationId }
          : task,
      );
      dataRef.current = { ...dataRef.current, tasks };
      setData(dataRef.current);
      await storage.setTasks(tasks);
    },
    [],
  );

  const deleteTask = useCallback(
    async (id: string) => {
      await ensureLoaded();
      const tasks = dataRef.current.tasks.filter((task) => task.id !== id);
      dataRef.current = { ...dataRef.current, tasks };
      setData(dataRef.current);
      await storage.setTasks(tasks);
    },
    [],
  );

  const patchSession = useCallback(
    async (
      id: string,
      patch: Partial<Pick<ChatSession, 'summary' | 'summarizedCount' | 'mode'>>,
    ) => {
      await ensureLoaded();
      const sessions = dataRef.current.sessions.map((session) =>
        session.id === id ? { ...session, ...patch } : session,
      );
      dataRef.current = { ...dataRef.current, sessions };
      setData(dataRef.current);
      await storage.setSessions(sessions);
    },
    [],
  );

  const saveAgentSettings = useCallback(
    async (patch: Partial<AgentSettings>) => {
      await ensureLoaded();
      const agent = { ...dataRef.current.agent, ...patch };
      dataRef.current = { ...dataRef.current, agent };
      setData(dataRef.current);
      await storage.setAgentSettings(agent);
    },
    [],
  );

  const saveAppearanceSettings = useCallback(
    async (patch: Partial<AppearanceSettings>) => {
      await ensureLoaded();
      const appearance = { ...dataRef.current.appearance, ...patch };
      dataRef.current = { ...dataRef.current, appearance };
      setData(dataRef.current);
      await storage.setAppearance(appearance);
    },
    [],
  );

  // ─── Automatic knowledge base (background, never shown in chat) ───────
  const addKnowledge = useCallback(
    async (facts: ExtractedFact[], sessionId?: string) => {
      if (!facts.length) return;
      await ensureLoaded();
      const knowledge = mergeFacts(dataRef.current.knowledge ?? [], facts, sessionId);
      dataRef.current = { ...dataRef.current, knowledge };
      setData(dataRef.current);
      await storage.setKnowledge(knowledge);
    },
    [],
  );

  const clearKnowledge = useCallback(async () => {
    await ensureLoaded();
    dataRef.current = { ...dataRef.current, knowledge: [] };
    setData(dataRef.current);
    await storage.setKnowledge([]);
  }, []);

  const activeSession = useMemo(
    () =>
      data.sessions.find((session) => session.id === data.activeSessionId) ??
      null,
    [data.activeSessionId, data.sessions],
  );

  const value = useMemo<AssistantContextValue>(
    () => ({
      ...data,
      loading,
      storageError,
      apiKeyConfigured,
      pendingPrompt,
      activeSession,
      setActiveSession,
      createSession,
      deleteSession,
      appendMessage,
      saveProvider,
      removeApiKey,
      createSkill,
      updateSkill,
      setSkillActive,
      createMemory,
      updateMemory,
      setMemoryActive,
      createTask,
      setTaskActive,
      deleteTask,
      patchSession,
      saveAgentSettings,
      saveAppearanceSettings,
      addKnowledge,
      clearKnowledge,
      setPendingPrompt: setPendingPromptState,
      consumePendingPrompt: () => setPendingPromptState(''),
      exportLocalData: () =>
        JSON.stringify(
          {
            exportedAt: now(),
            note: 'Local OneByte Agent data. API keys are deliberately excluded.',
            ...dataRef.current,
          },
          null,
          2,
        ),
    }),
    [
      data,
      loading,
      storageError,
      apiKeyConfigured,
      pendingPrompt,
      activeSession,
      setActiveSession,
      createSession,
      deleteSession,
      appendMessage,
      saveProvider,
      removeApiKey,
      createSkill,
      updateSkill,
      setSkillActive,
      createMemory,
      updateMemory,
      setMemoryActive,
      createTask,
      setTaskActive,
      deleteTask,
      patchSession,
      saveAgentSettings,
      saveAppearanceSettings,
      addKnowledge,
      clearKnowledge,
    ],
  );

  return (
    <AssistantContext.Provider value={value}>
      {children}
    </AssistantContext.Provider>
  );
}

export function useAssistant(): AssistantContextValue {
  const context = useContext(AssistantContext);
  if (!context) {
    throw new Error('useAssistant must be used inside AssistantProvider.');
  }
  return context;
}

export async function getStoredModelApiKey(): Promise<string> {
  const key = await readApiKey();
  if (!key) {
    throw new Error('أضيفي مفتاح الموديل من الإعدادات أولًا.');
  }
  return key;
}
