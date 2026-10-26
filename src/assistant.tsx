import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Platform } from 'react-native';

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
}

export type ThemePreference = 'system' | 'light' | 'dark';

export interface AppearanceSettings {
  theme: ThemePreference;
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
    patch: Partial<Pick<ChatSession, 'summary' | 'summarizedCount'>>,
  ) => Promise<void>;
  saveAgentSettings: (patch: Partial<AgentSettings>) => Promise<void>;
  saveAppearanceSettings: (patch: Partial<AppearanceSettings>) => Promise<void>;
  setPendingPrompt: (prompt: string) => void;
  consumePendingPrompt: () => void;
  exportLocalData: () => string;
}

const DATA_KEY = '@onebyte-agent/assistant-v1';
const API_KEY_ID = 'onebyte-agent.model-provider-key.v1';
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
};

const DEFAULT_APPEARANCE: AppearanceSettings = { theme: 'system' };

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
    },
    appearance: {
      ...DEFAULT_APPEARANCE,
      ...(value.appearance && typeof value.appearance === 'object' ? value.appearance : {}),
    },
  };
}

async function readApiKey(): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  return SecureStore.getItemAsync(API_KEY_ID);
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
  });
  const dataRef = useRef(data);
  const writeQueue = useRef<Promise<void>>(Promise.resolve());
  const [loading, setLoading] = useState(true);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [apiKeyConfigured, setApiKeyConfigured] = useState(false);
  const [pendingPrompt, setPendingPromptState] = useState('');

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const raw = await AsyncStorage.getItem(DATA_KEY);
        const restored = raw ? normalizeData(JSON.parse(raw)) : dataRef.current;
        const key = await readApiKey();
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
    void load();
    return () => {
      active = false;
    };
  }, []);

  const commit = useCallback(async (next: AssistantData) => {
    dataRef.current = next;
    setData(next);
    const write = writeQueue.current.then(() =>
      AsyncStorage.setItem(DATA_KEY, JSON.stringify(next)),
    );
    writeQueue.current = write.catch(() => undefined);
    try {
      await write;
      setStorageError(null);
    } catch {
      setStorageError('لم يتم حفظ التغيير على هذا الجهاز. حاولي مرة أخرى.');
      throw new Error('تعذّر حفظ البيانات محليًا.');
    }
  }, []);

  const setActiveSession = useCallback(
    async (id: string) => {
      const current = dataRef.current;
      if (!current.sessions.some((session) => session.id === id)) return;
      await commit({ ...current, activeSessionId: id });
    },
    [commit],
  );

  const createSession = useCallback(async () => {
    const current = dataRef.current;
    const session = newSession();
    await commit({
      ...current,
      sessions: [session, ...current.sessions],
      activeSessionId: session.id,
    });
    return session.id;
  }, [commit]);

  const deleteSession = useCallback(
    async (id: string) => {
      const current = dataRef.current;
      const sessions = current.sessions.filter((session) => session.id !== id);
      const activeSessionId =
        current.activeSessionId === id
          ? sessions[0]?.id ?? null
          : current.activeSessionId;
      await commit({ ...current, sessions, activeSessionId });
    },
    [commit],
  );

  const appendMessage = useCallback(
    async (sessionId: string, message: ChatMessage) => {
      const current = dataRef.current;
      const sessions = current.sessions.map((session) => {
        if (session.id !== sessionId) return session;
        const firstUserMessage =
          session.messages.length === 0 && message.role === 'user';
        return {
          ...session,
          title: firstUserMessage
            ? message.content.trim().slice(0, 34) || 'محادثة جديدة'
            : session.title,
          messages: [...session.messages, message],
          updatedAt: now(),
        };
      });
      await commit({ ...current, sessions });
    },
    [commit],
  );

  const saveProvider = useCallback(
    async (settings: ProviderSettings, apiKey?: string) => {
      const trimmedKey = apiKey?.trim();
      if (Platform.OS === 'web' && trimmedKey) {
        throw new Error(
          'حفظ مفتاح الموديل متاح داخل تطبيق Android/iOS فقط، لحمايته في خزنة الجهاز.',
        );
      }
      if (trimmedKey) {
        await SecureStore.setItemAsync(API_KEY_ID, trimmedKey, {
          keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        });
        setApiKeyConfigured(true);
      }
      await commit({
        ...dataRef.current,
        provider: {
          baseUrl: settings.baseUrl.trim().replace(/\/+$/, ''),
          model: settings.model.trim(),
          providerName: settings.providerName.trim() || 'Custom provider',
          contextLength: settings.contextLength ?? null,
          promptPrice: settings.promptPrice ?? null,
          completionPrice: settings.completionPrice ?? null,
          free: settings.free ?? false,
        },
      });
    },
    [commit],
  );

  const removeApiKey = useCallback(async () => {
    if (Platform.OS === 'web') {
      setApiKeyConfigured(false);
      return;
    }
    await SecureStore.deleteItemAsync(API_KEY_ID);
    setApiKeyConfigured(false);
  }, []);

  const createSkill = useCallback(
    async (input: { name: string; description: string; instructions: string }) => {
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
      await commit({
        ...dataRef.current,
        skills: [skill, ...dataRef.current.skills],
      });
    },
    [commit],
  );

  const updateSkill = useCallback(
    async (
      id: string,
      input: { name: string; description: string; instructions: string },
    ) => {
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
      await commit({ ...dataRef.current, skills });
    },
    [commit],
  );

  const setSkillActive = useCallback(
    async (id: string, active: boolean) => {
      const skills = dataRef.current.skills.map((skill) =>
        skill.id === id ? { ...skill, active, updatedAt: now() } : skill,
      );
      await commit({ ...dataRef.current, skills });
    },
    [commit],
  );

  const createMemory = useCallback(
    async (input: { title: string; content: string }) => {
      const timestamp = now();
      const memory: AssistantMemory = {
        id: makeId('memory'),
        title: input.title.trim(),
        content: input.content.trim(),
        active: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      await commit({
        ...dataRef.current,
        memories: [memory, ...dataRef.current.memories],
      });
    },
    [commit],
  );

  const updateMemory = useCallback(
    async (id: string, input: { title: string; content: string }) => {
      const memories = dataRef.current.memories.map((memory) =>
        memory.id === id
          ? { ...memory, ...input, updatedAt: now() }
          : memory,
      );
      await commit({ ...dataRef.current, memories });
    },
    [commit],
  );

  const setMemoryActive = useCallback(
    async (id: string, active: boolean) => {
      const memories = dataRef.current.memories.map((memory) =>
        memory.id === id ? { ...memory, active, updatedAt: now() } : memory,
      );
      await commit({ ...dataRef.current, memories });
    },
    [commit],
  );

  const createTask = useCallback(
    async (input: {
      title: string;
      prompt: string;
      time: string;
      notificationId?: string;
    }) => {
      const task: DailyTask = {
        id: makeId('task'),
        title: input.title.trim(),
        prompt: input.prompt.trim(),
        time: input.time,
        active: true,
        notificationId: input.notificationId,
        createdAt: now(),
      };
      await commit({ ...dataRef.current, tasks: [task, ...dataRef.current.tasks] });
      return task.id;
    },
    [commit],
  );

  const setTaskActive = useCallback(
    async (id: string, active: boolean, notificationId?: string) => {
      const tasks = dataRef.current.tasks.map((task) =>
        task.id === id
          ? { ...task, active, notificationId }
          : task,
      );
      await commit({ ...dataRef.current, tasks });
    },
    [commit],
  );

  const deleteTask = useCallback(
    async (id: string) => {
      const tasks = dataRef.current.tasks.filter((task) => task.id !== id);
      await commit({ ...dataRef.current, tasks });
    },
    [commit],
  );

  const patchSession = useCallback(
    async (
      id: string,
      patch: Partial<Pick<ChatSession, 'summary' | 'summarizedCount'>>,
    ) => {
      const sessions = dataRef.current.sessions.map((session) =>
        session.id === id ? { ...session, ...patch } : session,
      );
      await commit({ ...dataRef.current, sessions });
    },
    [commit],
  );

  const saveAgentSettings = useCallback(
    async (patch: Partial<AgentSettings>) => {
      await commit({
        ...dataRef.current,
        agent: { ...dataRef.current.agent, ...patch },
      });
    },
    [commit],
  );

  const saveAppearanceSettings = useCallback(
    async (patch: Partial<AppearanceSettings>) => {
      await commit({
        ...dataRef.current,
        appearance: { ...dataRef.current.appearance, ...patch },
      });
    },
    [commit],
  );

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
