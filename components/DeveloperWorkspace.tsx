import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View, Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { zipSync, strToU8 } from 'fflate';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { ScreenTopBar } from '@/components/PhoneDrawer';
import { useAssistant } from '@/src/assistant';
import { alertCompat } from '@/src/web-alert';
import {
  buildProjectOutline, decideCodeReview, getDeveloperProject, proposeCodeReview,
  replaceProjectPlan, saveProjectFile, updatePlanStep,
  type DeveloperProject, type DeveloperProjectFile, type DeveloperPlanStep,
} from '@/src/developer-projects';

function toBase64(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]; const hasB = i + 1 < bytes.length; const hasC = i + 2 < bytes.length;
    const b = hasB ? bytes[i + 1] : 0; const d = hasC ? bytes[i + 2] : 0;
    out += alphabet[a >> 2] + alphabet[((a & 3) << 4) | (b >> 4)] + (hasB ? alphabet[((b & 15) << 2) | (d >> 6)] : '=') + (hasC ? alphabet[d & 63] : '=');
  }
  return out;
}

function timeLabel(value?: string) {
  if (!value) return 'بانتظار التنفيذ';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function DeveloperWorkspace() {
  const colors = useColors();
  const { activeSession, sessions, createSession, setActiveSession, patchSession } = useAssistant();
  const [project, setProject] = useState<DeveloperProject | null>(null);
  const [selectedPath, setSelectedPath] = useState('');
  const [draft, setDraft] = useState('');
  const [newPath, setNewPath] = useState('src/main.ts');
  const [goal, setGoal] = useState('');
  const [planOpen, setPlanOpen] = useState(false);
  const [details, setDetails] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reviewReason, setReviewReason] = useState('');
  const [reviewOriginal, setReviewOriginal] = useState('');
  const [reviewProposed, setReviewProposed] = useState('');
  const [reviewPath, setReviewPath] = useState('');
  const [reviewOpen, setReviewOpen] = useState(false);

  const refresh = useCallback(async () => {
    if (!activeSession) { setProject(null); return; }
    const next = await getDeveloperProject(activeSession.id, activeSession.title);
    setProject(next);
    const chosen = next.files.find(f => f.path === selectedPath) ?? next.files[0];
    setSelectedPath(chosen?.path ?? '');
    setDraft(chosen?.content ?? '');
  }, [activeSession?.id, activeSession?.title]);
  useEffect(() => { void refresh(); }, [refresh]);

  const selectedFile = useMemo(() => project?.files.find(f => f.path === selectedPath) ?? null, [project, selectedPath]);
  const outline = useMemo(() => buildProjectOutline(project?.files ?? []), [project?.files]);

  async function startProjectChat() {
    if (busy) return;
    setBusy(true);
    try {
      const id = await createSession();
      await patchSession(id, { mode: 'developer' });
      await setActiveSession(id);
    } catch { alertCompat('تعذّر إنشاء المشروع', 'حاول مرة أخرى.'); }
    finally { setBusy(false); }
  }

  async function createFile() {
    if (!activeSession || !newPath.trim()) return;
    try {
      await saveProjectFile(activeSession.id, activeSession.title, newPath.trim(), '');
      await refresh();
      setSelectedPath(newPath.trim());
      setDraft('');
    } catch (error) { alertCompat('تعذّر إنشاء الملف', error instanceof Error ? error.message : 'مسار غير صالح'); }
  }

  async function saveFile() {
    if (!activeSession || !selectedPath) return;
    setBusy(true);
    try {
      await saveProjectFile(activeSession.id, activeSession.title, selectedPath, draft);
      await refresh();
      alertCompat('تم حفظ المسودة', 'تم حفظ الملف في مشروع هذه المحادثة. لم يتم تشغيل الكود تلقائيًا في هذه النسخة.');
    } catch (error) { alertCompat('فشل الحفظ', error instanceof Error ? error.message : 'خطأ غير معروف'); }
    finally { setBusy(false); }
  }

  async function createPlan() {
    if (!activeSession || !goal.trim()) return;
    setBusy(true);
    try {
      // Store an explicit user-visible execution checklist; it does not claim code has run.
      const lines = goal.split(/\n+/).map(s => s.trim()).filter(Boolean);
      await replaceProjectPlan(activeSession.id, activeSession.title, lines.map((line, i) => ({
        title: line.length > 70 ? line.slice(0, 67) + '…' : line,
        detail: line || `الخطوة ${i + 1}`,
      })));
      await refresh();
      setPlanOpen(true);
    } catch (error) { alertCompat('تعذّر حفظ الخطة', error instanceof Error ? error.message : 'خطأ غير معروف'); }
    finally { setBusy(false); }
  }

  async function markStep(step: DeveloperPlanStep, status: DeveloperPlanStep['status']) {
    if (!activeSession) return;
    await updatePlanStep(activeSession.id, step.id, status);
    await refresh();
  }

  async function exportZip() {
    if (!project?.files.length) { alertCompat('المشروع فارغ', 'أضف ملفات أولًا.'); return; }
    try {
      const entries: Record<string, Uint8Array> = {};
      for (const file of project.files) entries[file.path] = strToU8(file.content);
      const zipped = zipSync(entries, { level: 6 });
      const encoded = toBase64(zipped);
      const uri = `${FileSystem.cacheDirectory ?? FileSystem.documentDirectory}onebyte-project-${project.sessionId}.zip`;
      await FileSystem.writeAsStringAsync(uri, encoded, { encoding: FileSystem.EncodingType.Base64 });
      if (Platform.OS !== 'web' && await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'application/zip', dialogTitle: 'تحميل المشروع' });
      } else {
        alertCompat('تم تجهيز ZIP', uri);
      }
    } catch (error) {
      alertCompat('فشل تصدير ZIP', error instanceof Error ? error.message : 'خطأ غير معروف');
    }
  }

