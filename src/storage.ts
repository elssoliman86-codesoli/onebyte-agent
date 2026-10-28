import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import {
  clearDesktopApiKey,
  readDesktopApiKey,
  saveDesktopApiKey,
} from './desktop-credentials';
import type {
  AssistantData,
  ChatSession,
  ChatMessage,
  ProviderSettings,
  AssistantSkill,
  AssistantMemory,
  DailyTask,
  AgentSettings,
  AppearanceSettings,
  ToolStep,
} from './assistant';
import type { ToolCall, ApprovalDecision } from './agent';
import type { ProviderChatMessage } from './model-provider';
import type { KnowledgeEntry } from './knowledge';
import { DEFAULT_RESPONSE_STYLE } from './response-style';

// ─── Storage Keys ──────────────────────────────────────────────────────
const KEYS = {
  sessions: '@onebyte-agent/sessions',
  activeSessionId: '@onebyte-agent/activeSessionId',
  provider: '@onebyte-agent/provider',
  skills: '@onebyte-agent/skills',
  memories: '@onebyte-agent/memories',
  tasks: '@onebyte-agent/tasks',
  agent: '@onebyte-agent/agent',
  appearance: '@onebyte-agent/appearance',
  knowledge: '@onebyte-agent/knowledge',
  apiKeyConfigured: '@onebyte-agent/apiKeyConfigured',
  checkpoint: '@onebyte-agent/checkpoint',
} as const;

const API_KEY_ID = 'onebyte-agent.model-api-key';

// ─── Defaults ──────────────────────────────────────────────────────────
const DEFAULT_PROVIDER: ProviderSettings = {
  baseUrl: '',
  model: '',
  providerName: 'Custom provider',
  contextLength: null,
  promptPrice: null,
  completionPrice: null,
  free: false,
  keyless: false,
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
  fontColor: '#F3F7F4',
};

// ─── Agent Checkpoint Types ──────────────────────────────────────────────
export interface AgentCheckpoint {
  version: 1;
  sessionId: string;
  createdAt: string;
  /** The round the agent was in when checkpoint was saved. */
  round: number;
  /** The wire messages (conversation + tool calls) at checkpoint time. */
  wire: WireMessage[];
  /** Tool steps executed so far. */
  steps: ToolStep[];
  /** Accumulated final text response. */
  finalText: string;
  /** Accumulated thinking/reasoning content. */
  finalThinking: string;
  /** Tools approved for the current turn (by name). */
  allowedForTurn: string[];
  /** Currently active tool specs (may be reduced if tools unsupported). */
  activeSpecsNames: string[];
  /** Whether tools were found to be unsupported. */
  toolsWereUnsupported: boolean;
  /** Max steps allowed for this run. */
  maxSteps: number;
  /** Original user message that started this run. */
  originalUserMessage: string;
  /** Provider settings at checkpoint time (for resume validation). */
  provider: ProviderSettings;
}

/** Wire message type for checkpoint serialization. */
type WireMessage =
  | ProviderChatMessage
  | {
      role: 'assistant';
      content: string | null;
      tool_calls: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
    }
  | { role: 'tool'; tool_call_id: string; content: string };

// ─── Migration ─────────────────────────────────────────────────────────
/**
 * Migrate from the old single-key format to the new split-key format.
 * Runs once on first load if old data exists and new data doesn't.
 */
export async function migrateIfNeeded(): Promise<void> {
  const oldKey = '@onebyte-agent/assistant-v1';
  const hasOld = await AsyncStorage.getItem(oldKey);
  const hasNew = await AsyncStorage.getItem(KEYS.sessions);

  if (!hasOld || hasNew) return;

  try {
    const raw = JSON.parse(hasOld) as AssistantData;

    // Write all parts to their new keys in parallel
    const apiKey = await SecureStore.getItemAsync(API_KEY_ID).catch(() => null);
    await Promise.all([
      AsyncStorage.setItem(KEYS.sessions, JSON.stringify(raw.sessions)),
      AsyncStorage.setItem(KEYS.activeSessionId, JSON.stringify(raw.activeSessionId)),
      AsyncStorage.setItem(KEYS.provider, JSON.stringify(raw.provider)),
      AsyncStorage.setItem(KEYS.skills, JSON.stringify(raw.skills)),
      AsyncStorage.setItem(KEYS.memories, JSON.stringify(raw.memories)),
      AsyncStorage.setItem(KEYS.tasks, JSON.stringify(raw.tasks)),
      AsyncStorage.setItem(KEYS.agent, JSON.stringify(raw.agent)),
      AsyncStorage.setItem(KEYS.appearance, JSON.stringify(raw.appearance)),
      AsyncStorage.setItem(KEYS.knowledge, JSON.stringify(raw.knowledge ?? [])),
      AsyncStorage.setItem(KEYS.apiKeyConfigured, JSON.stringify(Boolean(apiKey))),
    ]);

    // Remove old key after successful migration
    await AsyncStorage.removeItem(oldKey);
  } catch (error) {
    console.error('[storage] Migration failed:', error);
    // If migration fails, we'll fall back to loading from old key on next load
  }
}

// ─── Generic Read/Write Helpers ────────────────────────────────────────
async function readJSON<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

async function writeJSON(key: string, value: unknown): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(value));
}

// ─── Public API ────────────────────────────────────────────────────────
export const storage = {
  /** Generic typed JSON read on an explicit key (studio stores). */
  async readRawJSON<T>(key: string, fallback: T): Promise<T> {
    return readJSON<T>(key, fallback);
  },

  /** Generic typed JSON write on an explicit key (studio stores). */
  async writeRawJSON(key: string, value: unknown): Promise<void> {
    await writeJSON(key, value);
  },

  /** Load all data at startup. Returns complete AssistantData. */
  async loadAll(): Promise<AssistantData> {
    await migrateIfNeeded();

    const [
      sessions,
      activeSessionId,
      provider,
      skills,
      memories,
      tasks,
      agent,
      appearance,
      knowledge,
      apiKeyConfigured,
    ] = await Promise.all([
      readJSON<ChatSession[]>(KEYS.sessions, []),
      readJSON<string | null>(KEYS.activeSessionId, null),
      readJSON<ProviderSettings>(KEYS.provider, DEFAULT_PROVIDER),
      readJSON<AssistantSkill[]>(KEYS.skills, []),
      readJSON<AssistantMemory[]>(KEYS.memories, []),
      readJSON<DailyTask[]>(KEYS.tasks, []),
      readJSON<AgentSettings>(KEYS.agent, DEFAULT_AGENT),
      readJSON<AppearanceSettings>(KEYS.appearance, DEFAULT_APPEARANCE),
      readJSON<KnowledgeEntry[]>(KEYS.knowledge, []),
      readJSON<boolean>(KEYS.apiKeyConfigured, false),
    ]);

    return {
      sessions,
      activeSessionId,
      provider,
      skills,
      memories,
      tasks,
      agent,
      appearance,
      knowledge,
    };
  },

  /** Sessions ────────────────────────────────────────────────────────── */
  async getSessions(): Promise<ChatSession[]> {
    return readJSON(KEYS.sessions, []);
  },

  async setSessions(sessions: ChatSession[]): Promise<void> {
    await writeJSON(KEYS.sessions, sessions);
  },

  async getActiveSessionId(): Promise<string | null> {
    return readJSON(KEYS.activeSessionId, null);
  },

  async setActiveSessionId(id: string | null): Promise<void> {
    await writeJSON(KEYS.activeSessionId, id);
  },

  /** Append a message to a single session — ONLY rewrites the sessions key. */
  async appendMessage(sessionId: string, message: ChatMessage): Promise<void> {
    const sessions = await this.getSessions();
    const updated = sessions.map((session) => {
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
    await this.setSessions(updated);
  },

  async createSession(): Promise<ChatSession> {
    const sessions = await this.getSessions();
    const session: ChatSession = {
      id: `session_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      title: 'محادثة جديدة',
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await this.setSessions([session, ...sessions]);
    await this.setActiveSessionId(session.id);
    return session;
  },

  async deleteSession(id: string): Promise<string | null> {
    const sessions = await this.getSessions();
    const filtered = sessions.filter((s) => s.id !== id);
    const activeId = await this.getActiveSessionId();
    const newActiveId = activeId === id ? filtered[0]?.id ?? null : activeId;
    await Promise.all([
      this.setSessions(filtered),
      this.setActiveSessionId(newActiveId),
    ]);
    return newActiveId;
  },

  /** Provider ────────────────────────────────────────────────────────── */
  async getProvider(): Promise<ProviderSettings> {
    return readJSON(KEYS.provider, DEFAULT_PROVIDER);
  },

  async setProvider(settings: ProviderSettings): Promise<void> {
    await writeJSON(KEYS.provider, settings);
  },

  async setApiKeyConfigured(value: boolean): Promise<void> {
    await writeJSON(KEYS.apiKeyConfigured, value);
  },

  async getApiKeyConfigured(): Promise<boolean> {
    return readJSON(KEYS.apiKeyConfigured, false);
  },

  /** Skills ──────────────────────────────────────────────────────────── */
  async getSkills(): Promise<AssistantSkill[]> {
    return readJSON(KEYS.skills, []);
  },

  async setSkills(skills: AssistantSkill[]): Promise<void> {
    await writeJSON(KEYS.skills, skills);
  },

  /** Memories ────────────────────────────────────────────────────────── */
  async getMemories(): Promise<AssistantMemory[]> {
    return readJSON(KEYS.memories, []);
  },

  async setMemories(memories: AssistantMemory[]): Promise<void> {
    await writeJSON(KEYS.memories, memories);
  },

  /** Tasks ───────────────────────────────────────────────────────────── */
  async getTasks(): Promise<DailyTask[]> {
    return readJSON(KEYS.tasks, []);
  },

  async setTasks(tasks: DailyTask[]): Promise<void> {
    await writeJSON(KEYS.tasks, tasks);
  },

  /** Agent Settings ──────────────────────────────────────────────────── */
  async getAgentSettings(): Promise<AgentSettings> {
    return readJSON(KEYS.agent, DEFAULT_AGENT);
  },

  async setAgentSettings(agent: AgentSettings): Promise<void> {
    await writeJSON(KEYS.agent, agent);
  },

  /** Appearance ──────────────────────────────────────────────────────── */
  async getAppearance(): Promise<AppearanceSettings> {
    return readJSON(KEYS.appearance, DEFAULT_APPEARANCE);
  },

  async setAppearance(appearance: AppearanceSettings): Promise<void> {
    await writeJSON(KEYS.appearance, appearance);
  },

  /** Knowledge base ─────────────────────────────────────────────────── */
  async getKnowledge(): Promise<KnowledgeEntry[]> {
    return readJSON(KEYS.knowledge, []);
  },

  async setKnowledge(entries: KnowledgeEntry[]): Promise<void> {
    await writeJSON(KEYS.knowledge, entries);
  },

  /** SecureStore API Key ─────────────────────────────────────────────── */
  /**
   * Native (Android/iOS): SecureStore keychain, WHEN_UNLOCKED_THIS_DEVICE_ONLY.
   * Web/desktop: honest browser adapter — sessionStorage by default, and
   * localStorage only after the user explicitly consents in the settings UI.
   */
  async saveApiKey(key: string): Promise<void> {
    if (Platform.OS === 'web') {
      await saveDesktopApiKey(key);
      await this.setApiKeyConfigured(Boolean(readDesktopApiKey()));
      return;
    }
    await SecureStore.setItemAsync(API_KEY_ID, key, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
    await this.setApiKeyConfigured(true);
  },

  async readApiKey(): Promise<string | null> {
    if (Platform.OS === 'web') return readDesktopApiKey();
    return SecureStore.getItemAsync(API_KEY_ID);
  },

  async removeApiKey(): Promise<void> {
    if (Platform.OS === 'web') {
      clearDesktopApiKey();
      await this.setApiKeyConfigured(false);
      return;
    }
    await SecureStore.deleteItemAsync(API_KEY_ID);
    await this.setApiKeyConfigured(false);
  },

  /** Clear all data (for testing/reset) */
  async clearAll(): Promise<void> {
    await Promise.all(
      Object.values(KEYS).map((key) => AsyncStorage.removeItem(key)),
    );
    if (Platform.OS !== 'web') {
      await SecureStore.deleteItemAsync(API_KEY_ID).catch(() => undefined);
    }
  },

  /** Agent Checkpoint ──────────────────────────────────────────────────── */
  async saveCheckpoint(checkpoint: AgentCheckpoint): Promise<void> {
    await writeJSON(KEYS.checkpoint, checkpoint);
  },

  async loadCheckpoint(): Promise<AgentCheckpoint | null> {
    return readJSON(KEYS.checkpoint, null);
  },

  async clearCheckpoint(): Promise<void> {
    await AsyncStorage.removeItem(KEYS.checkpoint);
  },
};

export { KEYS, API_KEY_ID, DEFAULT_PROVIDER, DEFAULT_AGENT, DEFAULT_APPEARANCE };