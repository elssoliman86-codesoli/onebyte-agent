import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { ScreenTopBar } from '@/components/PhoneDrawer';
import { useAssistant } from '@/src/assistant';
import { alertCompat } from '@/src/web-alert';
import { endpointFor } from '@/src/model-provider';
import { getStoredModelApiKey } from '@/src/assistant';
import { ModelPicker } from '@/components/ModelPicker';
import type { ModelInfo } from '@/src/model-catalog';
import fetchWithRetry from '@/src/fetch-with-retry';
import { base64ToBytes, preflightZip, ZIP_IMPORT_LIMITS } from '@/src/zip-safety';
import {
  buildProjectOutline, decideCodeReview, deleteProjectFile, getDeveloperProject, proposeCodeReview,
  renameProjectFile, replaceProjectPlan, saveProjectFile, setDeveloperCodeModel, updatePlanStep,
  type DeveloperProject, type DeveloperPlanStep,
} from '@/src/developer-projects';

function toBase64(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], hasB = i + 1 < bytes.length, hasC = i + 2 < bytes.length;
    const b = hasB ? bytes[i + 1] : 0, c = hasC ? bytes[i + 2] : 0;
    out += alphabet[a >> 2] + alphabet[((a & 3) << 4) | (b >> 4)] + (hasB ? alphabet[((b & 15) << 2) | (c >> 6)] : '=') + (hasC ? alphabet[c & 63] : '=');
  }
  return out;
}
const timeLabel = (value?: string) => value ? new Date(value).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : 'لم تبدأ';

export function DeveloperWorkspace() {
  const colors = useColors();
  const { width: viewportWidth } = useWindowDimensions();
  const compactLayout = viewportWidth < 700;
  const { activeSession, sessions, provider, createSession, setActiveSession, patchSession } = useAssistant();
  const [project, setProject] = useState<DeveloperProject | null>(null);
  const [selectedPath, setSelectedPath] = useState('');
  const selectedPathRef = useRef('');
  const refreshSequenceRef = useRef(0);
  const projectSessionRef = useRef<string | null>(null);
  const [openPaths, setOpenPaths] = useState<string[]>([]);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameDraft, setRenameDraft] = useState('');
  const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>({});
  const [draft, setDraft] = useState('');
  const draftRef = useRef('');
  const [newPath, setNewPath] = useState('src/main.ts');
  const [goal, setGoal] = useState('');
  const [planOpen, setPlanOpen] = useState(false);
  const [details, setDetails] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reviewReason, setReviewReason] = useState('');
  const [reviewProposed, setReviewProposed] = useState('');
  const [reviewPath, setReviewPath] = useState('');
  const [reviewOpen, setReviewOpen] = useState(false);
  const [codeModelPickerOpen, setCodeModelPickerOpen] = useState(false);

  useEffect(() => { draftRef.current = draft; }, [draft]);

  const refresh = useCallback(async (preferredPath?: string) => {
    const sequence = ++refreshSequenceRef.current;
    if (!activeSession) {
      setProject(null);
      projectSessionRef.current = null;
      selectedPathRef.current = '';
      setSelectedPath('');
      setDraft('');
      setOpenPaths([]);
      return;
    }
    const sessionId = activeSession.id;
    if (projectSessionRef.current !== sessionId) {
      projectSessionRef.current = sessionId;
      selectedPathRef.current = '';
      setOpenPaths([]);
    }
    const next = await getDeveloperProject(sessionId, activeSession.title);
    if (sequence !== refreshSequenceRef.current) return;
    setProject(next);
    const previousPath = selectedPathRef.current;
    const previousFile = next.files.find(file => file.path === previousPath);
    const chosen = next.files.find(f => f.path === preferredPath) ?? previousFile ?? next.files[0];
    const path = chosen?.path ?? '';
    const preserveUnsaved = !!chosen && chosen.path === previousPath && !!previousFile && draftRef.current !== previousFile.content;
    selectedPathRef.current = path;
    setSelectedPath(path);
    setDraft(preserveUnsaved ? draftRef.current : (chosen?.content ?? ''));
    setOpenPaths(current => {
      const valid = current.filter(item => next.files.some(file => file.path === item));
      return path && !valid.includes(path) ? [...valid, path] : valid;
    });
  }, [activeSession?.id, activeSession?.title]);
  useEffect(() => { void refresh(); }, [refresh]);

  const outline = useMemo(() => buildProjectOutline(project?.files ?? []), [project?.files]);
  const visibleOutline = useMemo(() => outline.filter(item => {
    const parts = item.path.split('/');
    for (let i = 1; i < parts.length; i++) {
      if (collapsedFolders[parts.slice(0, i).join('/')]) return false;
    }
    return true;
  }), [outline, collapsedFolders]);
  const selectedFile = project?.files.find(f => f.path === selectedPath);
  const pendingReviews = project?.reviews.filter(r => r.status === 'pending') ?? [];

  async function callCodeModel(
    messages: Array<{ role: string; content: string }>,
    temperature = 0.2,
    onChunk?: (chunk: string) => void,
  ): Promise<string> {
    if (!provider.baseUrl.trim() || !(project?.codeModelId || provider.model).trim()) {
      throw new Error('اختار مزودًا وموديلًا من الإعدادات أولًا.');
    }
    const apiKey = provider.keyless ? '' : await getStoredModelApiKey();
    const response = await fetchWithRetry(endpointFor(provider.baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
      body: JSON.stringify({
        model: project?.codeModelId || provider.model,
        temperature,
        stream: !!onChunk,
        messages,
      }),
    }, { timeout: 180000, maxRetries: 1 });
    if (!response.ok) throw new Error(`Provider returned HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);

    const readPayloadContent = (payload: any): string => {
      const value = payload?.choices?.[0]?.message?.content;
      return typeof value === 'string' ? value : Array.isArray(value)
        ? value.map((part: any) => typeof part?.text === 'string' ? part.text : '').join('') : '';
    };
    const contentType = response.headers.get('content-type') || '';
    const reader = response.body?.getReader?.();
    let complete = '';
    const consumeLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) return;
      const data = trimmed.slice(5).trim();
      if (!data || data === '[DONE]') return;
      try {
        const payload = JSON.parse(data);
        const delta = payload?.choices?.[0]?.delta?.content;
        const chunk = typeof delta === 'string' ? delta : Array.isArray(delta)
          ? delta.map((part: any) => typeof part?.text === 'string' ? part.text : '').join('') : '';
        if (chunk) { complete += chunk; onChunk?.(chunk); }
      } catch { /* Ignore incomplete/non-JSON SSE lines; the next frame is parsed separately. */ }
    };
    if (!onChunk || !contentType.includes('text/event-stream')) {
      const full = readPayloadContent(await response.json());
      if (onChunk && full) onChunk(full);
      return full;
    }
    if (!reader) {
      // React Native fetch implementations may expose no ReadableStream reader.
      // Consume the complete SSE text as a compatibility fallback instead of
      // attempting response.json() on an event stream.
      const raw = await response.text();
      raw.split(/\r?\n/).forEach(consumeLine);
      return complete;
    }

    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      lines.forEach(consumeLine);
      if (done) break;
    }
    if (buffer.trim()) consumeLine(buffer);
    return complete;
  }

  async function newProject(discardUnsaved = false) {
    if (busy) return;
    if (!discardUnsaved && selectedFile && draft !== selectedFile.content) {
      alertCompat('تعديلات غير محفوظة', 'احفظ الملف الحالي أو تجاهل تعديلاته قبل إنشاء مشروع جديد.', [
        { text: 'إلغاء', style: 'cancel' },
        { text: 'تجاهل وإنشاء مشروع', style: 'destructive', onPress: () => void newProject(true) },
      ]);
      return;
    }
    setBusy(true);
    try { const id = await createSession(); await patchSession(id, { mode: 'developer' }); await setActiveSession(id); }
    catch { alertCompat('تعذّر إنشاء المشروع', 'حاول مرة أخرى.'); }
    finally { setBusy(false); }
  }
  function openProjectSession(sessionId: string, discardUnsaved = false) {
    if (sessionId === activeSession?.id) return;
    if (!discardUnsaved && selectedFile && draft !== selectedFile.content) {
      alertCompat('تعديلات غير محفوظة', 'احفظ الملف الحالي أو تجاهل تعديلاته قبل تبديل المشروع.', [
        { text: 'إلغاء', style: 'cancel' },
        { text: 'تجاهل والتبديل', style: 'destructive', onPress: () => openProjectSession(sessionId, true) },
      ]);
      return;
    }
    void setActiveSession(sessionId);
  }

  async function createFile() {
    if (!activeSession || !newPath.trim()) return;
    if (selectedFile && draft !== selectedFile.content) { alertCompat('احفظ التعديلات أولًا', 'احفظ الملف المفتوح قبل إنشاء ملف آخر حتى لا تفقد تغييراتك.'); return; }
    try {
      await saveProjectFile(activeSession.id, activeSession.title, newPath.trim(), '');
      setSelectedPath(newPath.trim()); setDraft(''); await refresh(newPath.trim());
    } catch (e) { alertCompat('تعذّر إنشاء الملف', e instanceof Error ? e.message : 'مسار غير صالح'); }
  }
  async function saveFile() {
    if (!activeSession || !selectedPath) return;
    setBusy(true);
    try {
      await saveProjectFile(activeSession.id, activeSession.title, selectedPath, draft);
      await refresh(selectedPath);
      alertCompat('تم حفظ الملف', 'تم حفظ التعديلات محليًا داخل المشروع. لم يتم إرسال الكود إلى أي موديل ولم يتم تشغيله.');
    } catch (error) {
      alertCompat('فشل الحفظ', error instanceof Error ? error.message : 'خطأ غير معروف');
    } finally {
      setBusy(false);
    }
  }

  async function reviewFileWithModel() {
    if (!activeSession || !selectedPath || !selectedFile) return;
    setBusy(true);
    try {
      const source = draft;
      const raw = await callCodeModel([
        { role: 'system', content: 'Review the complete source file for correctness, logic bugs, security, maintainability, and edge cases. Return ONLY JSON with keys should_change (boolean), reason (short string), and proposed_code (complete source file). Never claim tests were run. If no meaningful improvement is needed, set should_change false.' },
        { role: 'user', content: `Review this file. Path: ${selectedPath}\n\n${source}\n\nReturn JSON only.` },
      ], 0.1);
      const jsonText = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
      const parsed = JSON.parse(jsonText) as { should_change?: boolean; reason?: string; proposed_code?: string };
      if (parsed.should_change && typeof parsed.proposed_code === 'string' && parsed.proposed_code.trim() && parsed.proposed_code !== source) {
        await proposeCodeReview(activeSession.id, selectedPath, source, parsed.proposed_code, parsed.reason || 'مراجعة AI');
        await refresh(selectedPath);
        alertCompat('المراجعة جاهزة', 'الموديل اقترح تعديلًا. لم يتم تطبيقه؛ راجعه ثم وافق عليه يدويًا.');
      } else {
        alertCompat('انتهت المراجعة', 'لم يقترح الموديل تغييرًا جوهريًا. لم يتم تشغيل الاختبارات.');
      }
    } catch (error) {
      alertCompat('تعذّرت مراجعة الملف', error instanceof Error ? error.message : 'استجابة غير صالحة من الموديل.');
    } finally {
      setBusy(false);
    }
  }

  function selectProjectFile(path: string, discardUnsaved = false) {
    if (path === selectedPath) return;
    if (!discardUnsaved && selectedFile && draft !== selectedFile.content) {
      alertCompat('تعديلات غير محفوظة', 'احفظ الملف الحالي أولًا، أو اختر تجاهل التعديلات لفتح الملف الآخر.', [
        { text: 'إلغاء', style: 'cancel' },
        { text: 'تجاهل وفتح', style: 'destructive', onPress: () => selectProjectFile(path, true) },
      ]);
      return;
    }
    selectedPathRef.current = path;
    setSelectedPath(path);
    setDraft(project?.files.find(file => file.path === path)?.content ?? '');
    setOpenPaths(current => current.includes(path) ? current : [...current, path]);
  }

  async function renameFile() {
    if (!activeSession || !selectedPath || !renameDraft.trim()) return;
    try {
      const oldPath = selectedPath;
      if (selectedFile && draft !== selectedFile.content) await saveProjectFile(activeSession.id, activeSession.title, oldPath, draft);
      await renameProjectFile(activeSession.id, oldPath, renameDraft.trim());
      selectedPathRef.current = renameDraft.trim();
      setSelectedPath(renameDraft.trim());
      setOpenPaths(current => current.map(path => path === oldPath ? renameDraft.trim() : path));
      setRenameOpen(false);
      await refresh(renameDraft.trim());
      alertCompat('تم تغيير اسم الملف', 'تم تحديث المسار مع الحفاظ على محتوى الملف.');
    } catch (error) {
      alertCompat('تعذّر تغيير الاسم', error instanceof Error ? error.message : 'مسار غير صالح.');
    }
  }

  function confirmDeleteFile() {
    if (!activeSession || !selectedPath) return;
    const path = selectedPath;
    alertCompat('حذف ملف المشروع؟', `سيتم حذف ${path} من هذا المشروع وإغلاق مراجعاته المعلقة. لا يمكن التراجع عن الحذف.`, [
      { text: 'إلغاء', style: 'cancel' },
      { text: 'حذف الملف', style: 'destructive', onPress: () => {
        void deleteProjectFile(activeSession.id, path).then(async () => {
          selectedPathRef.current = '';
          setSelectedPath('');
          setDraft('');
          setOpenPaths(current => current.filter(item => item !== path));
          await refresh();
        }).catch(error => alertCompat('تعذّر حذف الملف', error instanceof Error ? error.message : 'خطأ غير معروف'));
      } },
    ]);
  }

  async function exportZip() {
    if (!project?.files.length) { alertCompat('المشروع فارغ', 'أضف ملفات أولًا.'); return; }
    try {
      if (project.files.length > 500) throw new Error('المشروع يتجاوز حد 500 ملف.');
      const entries: Record<string, Uint8Array> = {};
      let totalBytes = 0;
      for (const file of project.files) {
        const bytes = strToU8(file.content);
        if (bytes.length > 25 * 1024 * 1024) throw new Error(`الملف ${file.path} يتجاوز حد 25MB.`);
        totalBytes += bytes.length;
        if (totalBytes > 80 * 1024 * 1024) throw new Error('الحجم الإجمالي للمشروع يتجاوز 80MB.');
        entries[file.path] = bytes;
      }
      const archive = zipSync(entries, { level: 6 });
      if (archive.length > ZIP_IMPORT_LIMITS.archiveBytes) throw new Error('ملف ZIP الناتج أكبر من حد الاستيراد على الهاتف (32MB). قلّل حجم المشروع أو قسّمه.');
      const encoded = toBase64(archive);
      const uri = `${FileSystem.cacheDirectory ?? FileSystem.documentDirectory}onebyte-project-${project.sessionId}.zip`;
      await FileSystem.writeAsStringAsync(uri, encoded, { encoding: FileSystem.EncodingType.Base64 });
      if (Platform.OS !== 'web' && await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: 'application/zip', dialogTitle: 'تحميل المشروع ZIP' });
      else alertCompat('تم تجهيز ملف ZIP', uri);
    } catch (e) { alertCompat('فشل التصدير', e instanceof Error ? e.message : 'خطأ غير معروف'); }
  }

  async function importZip() {
    if (!activeSession) { alertCompat('اختر محادثة مشروع أولًا', 'استورد الملفات داخل مشروع المحادثة النشطة.'); return; }
    try {
      const picked = await DocumentPicker.getDocumentAsync({ type: ['application/zip', 'application/x-zip-compressed'], copyToCacheDirectory: true, multiple: false });
      if (picked.canceled || !picked.assets?.length) return;
      const asset = picked.assets[0];
      const info = await FileSystem.getInfoAsync(asset.uri);
      const size = asset.size ?? (info.exists && 'size' in info ? info.size : 0);
      if (size > ZIP_IMPORT_LIMITS.archiveBytes) throw new Error('حجم ملف ZIP أكبر من 32MB على أندرويد. قسّم الأرشيف إلى أجزاء أصغر.');
      const base64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
      const archive = base64ToBytes(base64);
      preflightZip(archive);
      const unpacked = unzipSync(archive);
      const entries: Array<{path:string;content:string}> = [];
      let totalBytes = 0;
      const binaryExt = /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|7z|rar|exe|dll|so|a|o|class|jar|mp4|mp3|woff2?|ttf|otf)$/i;
      for (const [rawPath, bytes] of Object.entries(unpacked)) {
        if (rawPath.endsWith('/')) continue;
        const path = rawPath;
        if (!path || path.startsWith('/') || /^[a-zA-Z]:/.test(path) ||
          path.split('/').some(part => !part.trim() || part === '.' || part === '..')) {
          throw new Error(`مسار غير آمن داخل الأرشيف: ${rawPath}`);
        }
        if (bytes.length > 25 * 1024 * 1024) throw new Error(`الملف ${path} يتجاوز حد 25MB.`);
        totalBytes += bytes.length;
        if (totalBytes > 80 * 1024 * 1024) throw new Error('الحجم بعد فك الضغط يتجاوز 80MB.');
        if (binaryExt.test(path) || bytes.includes(0)) continue;
        entries.push({ path, content: strFromU8(bytes) });
        if (entries.length > 500) throw new Error('الأرشيف يحتوي على أكثر من 500 ملف.');
      }
      const { importProjectFiles } = await import('@/src/developer-projects');
      const count = await importProjectFiles(activeSession.id, activeSession.title, entries);
      await refresh();
      const first = entries[0]?.path;
      if (first) { setSelectedPath(first); setDraft(entries[0].content); }
      alertCompat('اكتمل استيراد المشروع', `تم استيراد ${count} ملفًا نصيًا إلى هذه المحادثة. الملفات الثنائية تم تجاهلها.`);
    } catch (e) { alertCompat('فشل استيراد ZIP', e instanceof Error ? e.message : 'ملف غير صالح أو كبير جدًا.'); }
  }
  async function generateFile() {
    if (!activeSession || !selectedPath || !goal.trim()) {
      alertCompat('بيانات ناقصة', 'اختار ملفًا واكتب المطلوب في حقل الخطة/المهمة أولًا.');
      return;
    }
    setBusy(true);
    const plan = project?.plan ?? [];
    const step = plan.find(item => item.status === 'pending') ?? plan.find(item => item.status === 'running');
    try {
      if (!provider.baseUrl.trim() || !provider.model.trim()) throw new Error('اختار مزودًا وموديلًا من الإعدادات أولًا.');
      if (activeSession.mode !== 'developer') await patchSession(activeSession.id, { mode: 'developer' });
      if (step) await updatePlanStep(activeSession.id, step.id, 'running');
      await refresh();
      const existingContent = draft;
      setDraft('');
      const generated = await callCodeModel([
        { role: 'system', content: 'You are the code-generation worker inside an IDE. Return only the complete file contents, no markdown fences or commentary. Preserve requested language and produce maintainable, secure code. Do not claim to have run tests. Never generate secrets or hardcode credentials.' },
        { role: 'user', content: `Project: ${activeSession.title}\nFile path: ${selectedPath}\nTask: ${goal}\nExisting file content (replace/update as appropriate):\n${existingContent}\nReturn the complete contents for this one file only.` },
      ], 0.2, chunk => setDraft(current => current + chunk));
      if (!generated.trim()) throw new Error('الموديل لم يرجع محتوى كود صالحًا.');
      const clean = generated.replace(/^\`\`\`[a-zA-Z0-9_-]*\s*\n/, '').replace(/\n\`\`\`\s*$/, '');
      await saveProjectFile(activeSession.id, activeSession.title, selectedPath, clean);
      setDraft(clean);
      if (step) await updatePlanStep(activeSession.id, step.id, 'done');
      await refresh(selectedPath);
      alertCompat('اكتمل توليد الملف', 'تم حفظ الكود في مساحة المشروع. لم يتم تشغيله تلقائيًا؛ راجعه واختبره قبل الاستخدام.');
    } catch (error) {
      if (step) await updatePlanStep(activeSession.id, step.id, 'error').catch(() => undefined);
      await refresh();
      alertCompat('تعذّر توليد الكود', error instanceof Error ? error.message : 'خطأ غير معروف');
    } finally { setBusy(false); }
  }

  async function buildProjectAutomatically() {
    if (!activeSession || !goal.trim()) { alertCompat('اكتب وصف المشروع أولًا', 'اكتب المطلوب في حقل المهمة ثم ابدأ البناء التلقائي.'); return; }
    if (!provider.baseUrl.trim() || !provider.model.trim()) { alertCompat('الموديل غير مضبوط', 'اختار مزودًا وموديلًا من إعدادات التطبيق.'); return; }
    setBusy(true);
    try {
      const callModel = callCodeModel;
      const rawPlan=await callModel([
        {role:'system',content:'Plan a software project as a practical ordered list of files. Return ONLY JSON: {"files":[{"path":"relative/path.ext","task":"specific task"}]}. Include only necessary source/config/test/docs files. No absolute paths, no .. segments, no secrets, max 30 files.'},
        {role:'user',content:`Project: ${activeSession.title}\nRequirements:\n${goal}\nExisting files:\n${(project?.files??[]).map(f=>f.path).join('\n')}`},
      ]);
      const json=rawPlan.replace(/^\`\`\`(?:json)?\s*/i,'').replace(/\s*\`\`\`$/,'');
      const parsed=JSON.parse(json) as {files?:Array<{path?:string;task?:string}>};
      const files=(parsed.files??[]).filter(f=>typeof f.path==='string'&&typeof f.task==='string').slice(0,30);
      if (!files.length) throw new Error('الخطة لم تتضمن ملفات صالحة.');
      const cleanPath=(path:string)=>path.trim().replace(/\\/g,'/').replace(/^\.\//,'');
      const normalized=files.map(f=>({path:cleanPath(f.path!),task:f.task!.trim()})).filter(f=>f.path&&!f.path.startsWith('/')&&!/^[a-zA-Z]:/.test(f.path)&&!f.path.split('/').some(p=>p==='..'||p==='.'||!p.trim()));
      if (!normalized.length) throw new Error('كل مسارات الملفات في الخطة غير صالحة.');
      if (new Set(normalized.map(file => file.path)).size !== normalized.length) throw new Error('الخطة تحتوي على مسارات ملفات مكررة؛ أعد توليد الخطة قبل البناء.');
      await replaceProjectPlan(activeSession.id,activeSession.title,normalized.map(f=>({title:f.path,detail:f.task})));
      if (activeSession.mode!=='developer') await patchSession(activeSession.id,{mode:'developer'});
      await refresh();
      const generatedPaths: string[] = [];
      for (let i=0;i<normalized.length;i++) {
        const item=normalized[i];
        await updatePlanStep(activeSession.id,(await getDeveloperProject(activeSession.id,activeSession.title)).plan[i].id,'running');
        await refresh();
        const current=await getDeveloperProject(activeSession.id,activeSession.title);
        const old=current.files.find(f=>f.path===item.path)?.content??'';
        setSelectedPath(item.path);
        setDraft('');
        const generated=await callModel([
          {role:'system',content:'You are a code-writing worker in an IDE. Return only the complete contents of this one file, no markdown fences. Keep interfaces consistent with the provided existing project files. Secure, maintainable code. Never claim tests ran.'},
          {role:'user',content:`Project: ${activeSession.title}\nOverall requirements:\n${goal}\nFile ${i+1}/${normalized.length}: ${item.path}\nTask: ${item.task}\nExisting project files (path and contents):\n${current.files.map(f=>`--- ${f.path} ---\n${f.content.slice(0,12000)}`).join('\n').slice(0,50000)}\nExisting content for target file:\n${old}\nReturn the full new contents for ${item.path} only.`},
        ],0.2,chunk=>setDraft(value=>value+chunk));
        const output=generated.replace(/^\`\`\`[a-zA-Z0-9_-]*\s*\n/,'').replace(/\n\`\`\`\s*$/,'');
        if(!output.trim()) throw new Error(`الموديل لم ينتج محتوى للملف ${item.path}`);
        await saveProjectFile(activeSession.id,activeSession.title,item.path,output);
        generatedPaths.push(item.path);
        const after=await getDeveloperProject(activeSession.id,activeSession.title);
        const step=after.plan[i];
        if(step) await updatePlanStep(activeSession.id,step.id,'done');
      }
      const finished=await getDeveloperProject(activeSession.id,activeSession.title);
      const completedSteps = finished.plan.filter(step => step.status === 'done');
      if (generatedPaths.length !== normalized.length || completedSteps.length !== normalized.length) {
        throw new Error('لم يكتمل توليد جميع الملفات؛ تم إيقاف المراجعة حتى لا تُراجع نسخة ناقصة.');
      }
      for(const file of finished.files.filter(item => generatedPaths.includes(item.path))) {
        try {
          const review=await callModel([
            {role:'system',content:'Review the entire source file for correctness, security, logic bugs, and edge cases. Return ONLY JSON {"should_change":boolean,"reason":"short","proposed_code":"complete file contents"}. Never claim tests ran.'},
            {role:'user',content:`File: ${file.path}\n${file.content}\nReview the whole file.`},
          ],0.1);
          const result=JSON.parse(review.replace(/^\`\`\`(?:json)?\s*/i,'').replace(/\s*\`\`\`$/,'')) as {should_change?:boolean;reason?:string;proposed_code?:string};
          if(result.should_change&&result.proposed_code?.trim()&&result.proposed_code!==file.content) await proposeCodeReview(activeSession.id,file.path,file.content,result.proposed_code,result.reason||'مراجعة ما بعد البناء');
        } catch { /* Preserve generated files; review failures are surfaced in the completion notice. */ }
      }
      await refresh(normalized[normalized.length - 1].path);
      alertCompat('انتهى البناء متعدد الملفات', `تم توليد ${normalized.length} ملفًا بالتتابع، ثم إنشاء اقتراحات المراجعة الممكنة. راجع اقتراحات الموافقة قبل تطبيقها. لم يتم تشغيل المشروع أو الاختبارات تلقائيًا.`);
    } catch(error) {
      if (activeSession) {
        const interrupted = await getDeveloperProject(activeSession.id, activeSession.title).catch(() => null);
        for (const step of interrupted?.plan ?? []) {
          if (step.status === 'running') await updatePlanStep(activeSession.id, step.id, 'error').catch(() => undefined);
        }
      }
      await refresh();
      alertCompat('توقف البناء متعدد الملفات',error instanceof Error?error.message:'خطأ غير معروف');
    } finally { setBusy(false); }
  }

  async function savePlan() {
    if (!activeSession || !goal.trim()) return;
    const lines = goal.split(/\n+/).map(x => x.trim()).filter(Boolean);
    await replaceProjectPlan(activeSession.id, activeSession.title, lines.map(line => ({title: line.slice(0,70), detail: line})));
    await refresh(); setPlanOpen(true);
  }
  async function markStep(step: DeveloperPlanStep, status: DeveloperPlanStep['status']) {
    if (!activeSession) return;
    await updatePlanStep(activeSession.id, step.id, status); await refresh();
  }
  async function submitReview() {
    if (!activeSession || !reviewPath.trim()) return;
    const file = project?.files.find(f => f.path === reviewPath);
    await proposeCodeReview(activeSession.id, reviewPath, file?.content ?? '', reviewProposed, reviewReason);
    setReviewOpen(false); await refresh();
    alertCompat('الاقتراح بانتظار موافقتك', 'لم يتم تطبيق أي تغيير تلقائيًا.');
  }
  async function decideReview(id: string, approve: boolean) {
    if (!activeSession) return;
    try { await decideCodeReview(activeSession.id, id, approve); await refresh(); }
    catch (e) { alertCompat('تعذّر تنفيذ القرار', e instanceof Error ? e.message : 'خطأ غير معروف'); }
  }

  return <View style={[s.root,{backgroundColor:colors.background}]}>
    <ScreenTopBar active="developer" center={<Text style={{color:colors.foreground,fontWeight:'700'}}>مختبر المطوّر</Text>} />
    <View style={s.header}><View style={{flex:1}}><Text style={[s.heading,{color:colors.foreground}]}>مساحة المشروع</Text><Text style={{color:colors.mutedForeground,fontSize:12}}>{activeSession?.title ?? 'اختر محادثة مطوّر'}</Text></View><Pressable onPress={() => void newProject()} style={[s.button,{borderColor:colors.border}]}><Feather name="plus" size={14} color={colors.foreground}/><Text style={{color:colors.foreground}}>مشروع جديد</Text></Pressable></View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[s.sessions, { alignItems: 'center' }]}>
      {sessions.filter(x=>x.mode==='developer').map(x=><Pressable key={x.id} onPress={()=>openProjectSession(x.id)} style={[s.chip,{borderColor:x.id===activeSession?.id?colors.primary:colors.border,backgroundColor:x.id===activeSession?.id?colors.accentSubtle:colors.card}]}><Text style={{color:x.id===activeSession?.id?colors.primary:colors.foreground}} numberOfLines={1}>{x.title||'مشروع بدون اسم'}</Text></Pressable>)}
      {!sessions.some(x=>x.mode==='developer') ? <Text style={{color:colors.mutedForeground,fontSize:12,paddingHorizontal:8}}>لا توجد مشاريع بعد — أنشئ مشروعًا جديدًا أو استورد ملفاتك.</Text> : null}
    </ScrollView>
    <View style={[s.body, compactLayout ? s.bodyCompact : null]}>
      <View style={[s.sidebar,{borderColor:colors.border,backgroundColor:colors.card}, compactLayout ? s.sidebarCompact : null]}>
        <View style={s.filePanelHeading}><View style={s.inline}><Feather name="folder" size={15} color={colors.primary}/><Text style={[s.sectionTitle,{color:colors.foreground}]}>ملفات المشروع</Text></View><Text style={{color:colors.mutedForeground,fontSize:10}}>{project?.files.length ?? 0} ملف</Text></View>
        <View style={s.inline}><TextInput value={newPath} onChangeText={setNewPath} placeholder="src/main.ts" placeholderTextColor={colors.mutedForeground} style={[s.path,{color:colors.foreground,borderColor:colors.border}]}/><Pressable onPress={()=>void createFile()} style={[s.plus,{backgroundColor:colors.primary}]}><Feather name="plus" size={15} color={colors.primaryForeground}/></Pressable></View>
        <ScrollView style={{maxHeight:compactLayout?88:260}}>{visibleOutline.map(item=><Pressable key={item.path} onPress={()=>{if(item.directory){setCollapsedFolders(prev=>({...prev,[item.path]:!prev[item.path]}));}else{selectProjectFile(item.path);}}} style={[s.tree,{paddingLeft:7+item.depth*11,backgroundColor:selectedPath===item.path?colors.accentSubtle:'transparent'}]}><Feather name={item.directory?(collapsedFolders[item.path]?'chevron-right':'chevron-down'):'file-text'} size={13} color={colors.mutedForeground}/><Text numberOfLines={1} style={{color:colors.foreground,fontSize:12,flex:1}}>{item.path.split('/').pop()}</Text></Pressable>)}</ScrollView>
        <View style={s.inline}>
          <Pressable onPress={()=>void exportZip()} style={[s.button,{borderColor:colors.border,flex:1}]}><Feather name="download" size={14} color={colors.foreground}/><Text style={{color:colors.foreground,fontSize:11}}>تصدير ZIP</Text></Pressable>
          <Pressable onPress={()=>void importZip()} style={[s.button,{borderColor:colors.border,flex:1}]}><Feather name="upload" size={14} color={colors.foreground}/><Text style={{color:colors.foreground,fontSize:11}}>استيراد ZIP</Text></Pressable>
        </View>
      </View>
      <View style={[s.editor,{borderColor:colors.border,backgroundColor:colors.card}, compactLayout ? s.editorCompact : null]}>
        <View style={s.fileHeading}><View style={{flex:1,minWidth:0}}><Text style={{color:colors.foreground,fontWeight:'700'}} numberOfLines={1}>{selectedPath||'المحرر — لا يوجد ملف مفتوح'}</Text><Text style={{color:colors.mutedForeground,fontSize:11}}>{selectedFile?.language??'اختر ملفًا من الشجرة'}{selectedFile && draft!==selectedFile.content ? ' · غير محفوظ' : selectedFile ? ' · محفوظ' : ''}</Text><Text style={{color:colors.mutedForeground,fontSize:10}}>موديل الكود: {project?.codeModelId || provider.model || 'غير محدد'}</Text></View>{selectedFile ? <Pressable accessibilityLabel="إعادة تسمية الملف" onPress={()=>{setRenameDraft(selectedPath);setRenameOpen(true);}} style={{padding:5}}><Feather name="edit-2" size={15} color={colors.primary}/></Pressable> : null}{selectedFile ? <Pressable accessibilityLabel="حذف الملف" onPress={confirmDeleteFile} style={{padding:5}}><Feather name="trash-2" size={15} color={colors.destructive}/></Pressable> : null}<Pressable onPress={()=>setCodeModelPickerOpen(true)} style={{padding:5}}><Feather name="cpu" size={17} color={colors.primary}/></Pressable><Pressable onPress={()=>setPlanOpen(v=>!v)}><Feather name="help-circle" size={18} color={colors.primary}/></Pressable></View>
        {openPaths.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.fileTabs}>{openPaths.map(path=><Pressable key={path} onPress={()=>selectProjectFile(path)} style={[s.fileTab,{borderColor:path===selectedPath?colors.primary:colors.border,backgroundColor:path===selectedPath?colors.accentSubtle:colors.background}]}><Text numberOfLines={1} style={{color:path===selectedPath?colors.primary:colors.mutedForeground,fontSize:11,fontWeight:'700'}}>{path.split('/').pop()}</Text></Pressable>)}</ScrollView> : null}
        {renameOpen ? <View style={[s.renamePanel,{borderColor:colors.border,backgroundColor:colors.background}]}><TextInput value={renameDraft} onChangeText={setRenameDraft} autoCapitalize="none" autoCorrect={false} placeholder="المسار الجديد للملف" placeholderTextColor={colors.mutedForeground} style={[s.path,{color:colors.foreground,borderColor:colors.border,flex:1}]}/><Pressable onPress={()=>void renameFile()} style={[s.primary,{backgroundColor:colors.primary}]}><Text style={{color:colors.primaryForeground,fontSize:11}}>حفظ الاسم</Text></Pressable><Pressable onPress={()=>setRenameOpen(false)} style={[s.button,{borderColor:colors.border}]}><Text style={{color:colors.foreground,fontSize:11}}>إلغاء</Text></Pressable></View> : null}
        {selectedFile ? (
          <TextInput value={draft} onChangeText={setDraft} editable={!busy} multiline autoCapitalize="none" autoCorrect={false} spellCheck={false} textAlignVertical="top" placeholder="اكتب الكود أو عدّله هنا..." placeholderTextColor={colors.mutedForeground} style={[s.code,{color:colors.foreground,borderColor:colors.border}]}/>
        ) : (
          <View style={[s.emptyEditor,{borderColor:colors.border,backgroundColor:colors.background}]}>
            <Feather name="code" size={30} color={colors.primary}/>
            <Text style={{color:colors.foreground,fontSize:15,fontWeight:'800',textAlign:'center'}}>مساحة الكود جاهزة</Text>
            <Text style={{color:colors.mutedForeground,fontSize:12,textAlign:'center',lineHeight:19}}>أنشئ ملفًا من قائمة الملفات، أو استورد مشروع ZIP. بعد اختيار الملف سيظهر محتواه هنا ويمكنك تعديله وحفظه.</Text>
            <Pressable onPress={()=>{setNewPath('src/main.ts');void createFile();}} style={[s.primary,{backgroundColor:colors.primary,marginTop:5}]}><Feather name="file-plus" size={14} color={colors.primaryForeground}/><Text style={{color:colors.primaryForeground}}>إنشاء أول ملف</Text></Pressable>
          </View>
        )}
        <View style={s.inline}><Pressable disabled={!selectedFile||busy} onPress={()=>void saveFile()} style={[s.primary,{backgroundColor:colors.primary,opacity:busy?0.6:1}]}><Feather name="save" size={13} color={colors.primaryForeground}/><Text style={{color:colors.primaryForeground,fontSize:12}}>حفظ</Text></Pressable><Pressable disabled={!selectedFile||busy} onPress={()=>void reviewFileWithModel()} style={[s.button,{borderColor:colors.border,opacity:busy?0.6:1}]}><Feather name="shield" size={13} color={colors.primary}/><Text style={{color:colors.foreground,fontSize:12}}>مراجعة AI</Text></Pressable><Pressable disabled={!selectedFile} onPress={()=>{setReviewPath(selectedPath);setReviewProposed(draft);setReviewReason('اقتراح يدوي');setReviewOpen(true);}} style={[s.button,{borderColor:colors.border}]}><Text style={{color:colors.foreground,fontSize:11}}>اقتراح يدوي</Text></Pressable></View>
      </View>
    </View>
    <View style={[s.timeline,{borderColor:colors.border,backgroundColor:colors.card},planOpen?s.timelinePopover:s.timelineClosed]}>
      <Pressable style={s.timelineHead} onPress={()=>setPlanOpen(v=>!v)}><Feather name="activity" size={15} color={colors.primary}/><Text style={{color:colors.foreground,fontWeight:'700',flex:1}}>Timeline · خطة التنفيذ</Text><Text style={{color:colors.mutedForeground,fontSize:11}}>{project?.plan.length??0} خطوات</Text><Feather name={planOpen?'chevron-up':'chevron-down'} size={14} color={colors.mutedForeground}/></Pressable>
      {planOpen&&<><TextInput value={goal} onChangeText={setGoal} multiline placeholder="خطوة في كل سطر..." placeholderTextColor={colors.mutedForeground} style={[s.planInput,{color:colors.foreground,borderColor:colors.border}]}/><Pressable onPress={()=>void savePlan()} style={[s.button,{borderColor:colors.border,alignSelf:'flex-start'}]}><Text style={{color:colors.foreground}}>حفظ الخطة</Text></Pressable><Pressable disabled={busy} onPress={()=>void buildProjectAutomatically()} style={[s.primary,{backgroundColor:colors.primary,alignSelf:'flex-start',opacity:busy?0.6:1}]}><Feather name={busy?'loader':'layers'} size={13} color={colors.primaryForeground}/><Text style={{color:colors.primaryForeground}}>بناء المشروع كاملًا بالتتابع</Text></Pressable><Pressable disabled={busy||!selectedFile} onPress={()=>void generateFile()} style={[s.primary,{backgroundColor:colors.primary,alignSelf:'flex-start',opacity:busy?0.6:1}]}><Feather name={busy?'loader':'zap'} size={13} color={colors.primaryForeground}/><Text style={{color:colors.primaryForeground}}>توليد الكود بالموديل الحالي</Text></Pressable><ScrollView style={{maxHeight:170}}>{(project?.plan??[]).map((step,i)=><View key={step.id} style={s.step}><View style={s.rail}>{step.status==='running'?<View style={[s.dot,{backgroundColor:'transparent',borderWidth:0,alignItems:'center',justifyContent:'center'}]}><ActivityIndicator size="small" color={colors.primary}/></View>:<View style={[s.dot,{backgroundColor:step.status==='done'?colors.success:step.status==='error'?colors.destructive:colors.border}]}/ >}{i<(project?.plan.length??0)-1&&<View style={[s.connector,{backgroundColor:colors.border}]}/>}</View><View style={{flex:1,paddingBottom:9}}><Pressable onPress={()=>setDetails(details===step.id?null:step.id)} style={{flexDirection:'row',alignItems:'center',gap:5}}><Text style={{color:colors.foreground,fontWeight:'600',flex:1}}>{step.title}</Text><Feather name={details===step.id?'chevron-up':'chevron-down'} size={13} color={colors.mutedForeground}/></Pressable><Text accessibilityLabel={`وقت الحدث ${step.startedAt??step.finishedAt??'لم يبدأ'}`} style={{color:colors.mutedForeground,fontSize:10}}>{step.status==='done'?'مكتملة':step.status==='running'?'قيد التنفيذ':step.status==='error'?'فشلت':step.status==='waiting-approval'?'بانتظار الموافقة':'في الانتظار'} · {timeLabel(step.startedAt??step.finishedAt)}</Text>{details===step.id&&<View style={{borderRightWidth:2,borderRightColor:colors.border,paddingRight:8,marginTop:5}}><Text style={{color:colors.mutedForeground,fontSize:12}}>{step.detail}</Text><Text style={{color:colors.mutedForeground,fontSize:10,marginTop:4}}>بدأت: {step.startedAt??'لم تبدأ'} · انتهت: {step.finishedAt??'لم تنتهِ'}</Text></View>}{step.status!=='done'&&<View style={s.inline}><Pressable onPress={()=>void markStep(step,'running')}><Text style={{color:colors.primary,fontSize:11}}>بدء</Text></Pressable><Pressable onPress={()=>void markStep(step,'done')}><Text style={{color:colors.success,fontSize:11}}>اكتملت</Text></Pressable><Pressable onPress={()=>void markStep(step,'error')}><Text style={{color:colors.destructive,fontSize:11}}>فشل</Text></Pressable></View>}</View></View>)}</ScrollView></>}
    </View>
    {pendingReviews.length>0&&<View style={[s.review,{borderColor:colors.warning,backgroundColor:colors.card}]}><Text style={{color:colors.foreground,fontWeight:'700'}}>اقتراحات تنتظر الموافقة</Text>{pendingReviews.map(r=><View key={r.id} style={{gap:6,marginTop:5}}><Text style={{color:colors.foreground}}>{r.filePath} — {r.reason}</Text><View style={s.inline}><Pressable onPress={()=>void decideReview(r.id,true)} style={[s.primary,{backgroundColor:colors.success}]}><Text style={{color:'#fff'}}>موافقة وتطبيق</Text></Pressable><Pressable onPress={()=>void decideReview(r.id,false)} style={[s.button,{borderColor:colors.border}]}><Text style={{color:colors.foreground}}>رفض</Text></Pressable></View></View>)}</View>}
    <View style={[s.promptBar,{borderColor:colors.border,backgroundColor:colors.card}]}>
      <TextInput value={goal} onChangeText={setGoal} placeholder="اكتب وصف المشروع أو التعديل المطلوب..." placeholderTextColor={colors.mutedForeground} style={[s.promptInput,{color:colors.foreground}]} returnKeyType="send" onSubmitEditing={()=>{if(!busy) void buildProjectAutomatically();}} />
      <Pressable accessibilityRole="button" accessibilityLabel="بناء المشروع من الوصف" disabled={busy||!goal.trim()} onPress={()=>void buildProjectAutomatically()} style={[s.promptSend,{backgroundColor:colors.primary,opacity:busy||!goal.trim()?0.5:1}]}>
        {busy?<ActivityIndicator size="small" color={colors.primaryForeground}/>:<Feather name="arrow-up" size={18} color={colors.primaryForeground}/>}
      </Pressable>
    </View>
    {reviewOpen&&<View style={[s.review,{borderColor:colors.border,backgroundColor:colors.card}]}><Text style={{color:colors.foreground,fontWeight:'700'}}>اقتراح تعديل — لن يطبق دون موافقتك</Text><TextInput value={reviewPath} onChangeText={setReviewPath} placeholder="مسار الملف" placeholderTextColor={colors.mutedForeground} style={[s.path,{color:colors.foreground,borderColor:colors.border}]}/><TextInput value={reviewReason} onChangeText={setReviewReason} placeholder="سبب التعديل" placeholderTextColor={colors.mutedForeground} style={[s.path,{color:colors.foreground,borderColor:colors.border}]}/><TextInput value={reviewProposed} onChangeText={setReviewProposed} multiline placeholder="الكود المقترح" placeholderTextColor={colors.mutedForeground} style={[s.planInput,{color:colors.foreground,borderColor:colors.border}]}/><View style={s.inline}><Pressable onPress={()=>void submitReview()} style={[s.primary,{backgroundColor:colors.primary}]}><Text style={{color:colors.primaryForeground}}>إرسال للمراجعة</Text></Pressable><Pressable onPress={()=>setReviewOpen(false)} style={[s.button,{borderColor:colors.border}]}><Text style={{color:colors.foreground}}>إلغاء</Text></Pressable></View></View>}
    <ModelPicker
      visible={codeModelPickerOpen}
      baseUrl={provider.baseUrl}
      getApiKey={() => provider.keyless ? Promise.resolve('') : getStoredModelApiKey()}
      currentModel={project?.codeModelId || provider.model}
      onClose={() => setCodeModelPickerOpen(false)}
      onPick={(model: ModelInfo) => {
        if (!activeSession) return;
        void setDeveloperCodeModel(activeSession.id, model.id).then(() => refresh()).catch(error => alertCompat('تعذّر حفظ موديل الكود', error instanceof Error ? error.message : 'خطأ غير معروف'));
        setCodeModelPickerOpen(false);
      }}
    />
  </View>;
}
const s=StyleSheet.create({
 root:{flex:1,minHeight:0,paddingHorizontal:12,gap:7},promptBar:{minHeight:48,borderWidth:1,borderRadius:15,padding:5,flexDirection:'row',alignItems:'center',gap:7},promptInput:{flex:1,minHeight:38,paddingHorizontal:9,fontSize:13},promptSend:{width:36,height:36,borderRadius:12,alignItems:'center',justifyContent:'center'},header:{flexDirection:'row',alignItems:'center',gap:8,paddingTop:8},heading:{fontSize:20,fontWeight:'800'},button:{minHeight:33,paddingHorizontal:9,borderWidth:1,borderRadius:8,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:5},sessions:{gap:7,paddingVertical:3,minHeight:52},chip:{paddingHorizontal:9,paddingVertical:6,borderWidth:1,borderRadius:8,maxWidth:180},body:{flex:1,minHeight:260,flexDirection:'row',gap:8},bodyCompact:{flexDirection:'column',gap:7,minHeight:0},sidebar:{width:205,borderWidth:1,borderRadius:13,padding:9,gap:7},sidebarCompact:{width:'100%',maxHeight:166},sectionTitle:{fontWeight:'700',fontSize:12},inline:{flexDirection:'row',alignItems:'center',gap:7,flexWrap:'wrap'},path:{flex:1,minHeight:32,borderWidth:1,borderRadius:7,paddingHorizontal:7,fontSize:11},plus:{width:32,height:32,borderRadius:7,alignItems:'center',justifyContent:'center'},tree:{minHeight:26,flexDirection:'row',alignItems:'center',gap:5,paddingVertical:4,paddingRight:3,borderRadius:5},editor:{flex:1,minWidth:0,borderWidth:1,borderRadius:13,padding:9,gap:8},editorCompact:{minHeight:300,flex:1},fileTabs:{gap:6,paddingVertical:2},fileTab:{maxWidth:180,borderWidth:1,borderRadius:8,paddingHorizontal:9,paddingVertical:6},renamePanel:{flexDirection:'row-reverse',alignItems:'center',gap:6,borderWidth:1,borderRadius:9,padding:7},filePanelHeading:{flexDirection:'row-reverse',alignItems:'center',justifyContent:'space-between'},emptyEditor:{flex:1,minHeight:190,borderWidth:1,borderStyle:'dashed',borderRadius:10,alignItems:'center',justifyContent:'center',padding:18,gap:9},fileHeading:{flexDirection:'row',alignItems:'center',gap:7},code:{flex:1,minHeight:80,borderWidth:1,borderRadius:7,padding:7,fontFamily:'monospace',fontSize:12,lineHeight:18},primary:{minHeight:33,paddingHorizontal:10,borderRadius:8,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:5},timeline:{borderWidth:1,borderRadius:11,padding:8,maxHeight:260},timelineHead:{minHeight:28,flexDirection:'row',alignItems:'center',gap:7},planInput:{minHeight:48,maxHeight:90,borderWidth:1,borderRadius:7,padding:7,fontSize:12,marginVertical:5},step:{flexDirection:'row',gap:8},rail:{width:12,alignItems:'center'},dot:{width:9,height:9,borderRadius:5,marginTop:4},connector:{width:2,flex:1,minHeight:22,marginTop:2},review:{borderWidth:1,borderRadius:10,padding:9,gap:6,maxHeight:220},timelinePopover:{position:'absolute',right:8,bottom:48,width:'94%',maxHeight:360,zIndex:30,elevation:12,shadowColor:'#000',shadowOpacity:0.22,shadowRadius:12,shadowOffset:{width:0,height:4}},timelineClosed:{alignSelf:'flex-start',maxHeight:40,borderWidth:0,paddingHorizontal:0,paddingVertical:0,backgroundColor:'transparent'}
});
