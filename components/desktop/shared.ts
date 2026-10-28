import type { ComponentProps } from 'react';
import type { Feather } from '@expo/vector-icons';
import type { ChatMessage, ToolStep } from '@/src/assistant';
import { desktopColors } from './DesktopTokens';

export type FeatherIcon = ComponentProps<typeof Feather>['name'];

/** Status icon/color shared by DesktopChat and DesktopActivity (single definition). */
export const STEP_META_ROW: Record<ToolStep['status'], { icon: FeatherIcon; color: string; label: string }> = {
  running: { icon: 'loader', color: desktopColors.accentHover, label: 'يعمل' },
  done: { icon: 'check', color: desktopColors.success, label: 'نجح' },
  error: { icon: 'x-circle', color: desktopColors.error, label: 'خطأ' },
  denied: { icon: 'slash', color: desktopColors.warning, label: 'مرفوض' },
};

/** Arabic display labels for the tools the engine currently ships. */
export const TOOL_LABELS: Record<string, string> = {
  read_skill: 'قراءة مهارة',
  search_history: 'بحث في المحادثات',
  save_memory: 'حفظ ذكرى',
  create_task: 'إنشاء مهمة',
  wait: 'انتظار',
  web_search: 'بحث في الويب',
  web_fetch: 'قراءة رابط',
};

/** "قبل ساعتين" / "قبل 3 أيام" style, coarse. */
export function timeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const diff = Date.now() - t;
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'الآن';
  if (min < 60) return `قبل ${min} د`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `قبل ${hr} س`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `قبل ${day} ي`;
  return new Date(iso).toLocaleDateString('ar');
}

/** Real execution events from persisted assistant messages (newest first). */
export function collectTimeline(
  messages: ChatMessage[],
  limit = 40,
): { step: ToolStep; at: string }[] {
  const events: { step: ToolStep; at: string }[] = [];
  for (const message of messages) {
    if (message.role === 'assistant' && message.steps) {
      for (const step of message.steps) events.push({ step, at: message.createdAt });
    }
  }
  return events.reverse().slice(0, limit);
}

/* ────────────────── tiny desktop event channel ──────────────────
 * Lets sibling desktop panels (inspector quick tools, hero cards)
 * drive the composer and reflect the live run state without adding
 * new context providers or duplicating assistant state. */

export interface ComposerPrefill {
  text: string;
  focus?: boolean;
}

type ComposerSink = (prefill: ComposerPrefill) => void;

let composerSink: ComposerSink | null = null;

export function setComposerSink(sink: ComposerSink | null): void {
  composerSink = sink;
}

export function requestPrefill(prefill: ComposerPrefill): void {
  composerSink?.(prefill);
}

type RunStateSink = (running: boolean) => void;

let runStateSink: RunStateSink | null = null;

export function setRunStateSink(sink: RunStateSink | null): void {
  runStateSink = sink;
}

export function publishRunState(running: boolean): void {
  runStateSink?.(running);
}

