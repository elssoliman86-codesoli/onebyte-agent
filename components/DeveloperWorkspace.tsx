import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
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
import { HtmlPreview } from '@/components/HtmlPreview';
import { loadGithubToken, listRepos, getDefaultBranch, readFileSnapshot, createFile as createGithubFile, writeFile as updateGithubFile, type GhRepo } from '@/src/github';
import fetchWithRetry from '@/src/fetch-with-retry';
import { base64ToBytes, preflightZip, ZIP_IMPORT_LIMITS } from '@/src/zip-safety';
import {
  buildProjectOutline, decideCodeReview, deleteProjectFile, getDeveloperProject, proposeCodeReview,
  renameProjectFile, replaceProjectPlan, saveProjectFile, setDeveloperCodeModel, updatePlanStep,
  type DeveloperProject, type DeveloperProjectFile, type DeveloperPlanStep,
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

function buildProjectPreviewHtml(files: DeveloperProject['files'], selectedPath: string): string {
  const byPath = new Map(files.map(file => [file.path, file.content]));
  const htmlFile = files.find(file => file.path === selectedPath && file.path.toLowerCase().endsWith('.html'))
    ?? files.find(file => /(^|\/)index\.html$/i.test(file.path))
    ?? files.find(file => file.path.toLowerCase().endsWith('.html'));
  if (!htmlFile) throw new Error('المشروع لا يحتوي على ملف HTML لعرض Preview. المشاريع التي تحتاج إلى تشغيل React/Native/Backend تتطلب بيئة Build منفصلة.');
  const normalize = (value: string) => {
    const parts: string[] = [];
    for (const part of value.replace(/\\/g, '/').split('/')) {
      if (!part || part === '.') continue;
      if (part === '..') parts.pop();
      else parts.push(part);
    }
    return parts.join('/');
  };
  const resolveAsset = (src: string) => {
    if (/^(?:https?:|data:|blob:|\/\/|#)/i.test(src)) return null;
    const base = htmlFile.path.split('/').slice(0, -1).join('/');
    const path = normalize([base, src.split(/[?#]/)[0]].filter(Boolean).join('/'));
    return byPath.get(path) ?? null;
  };
  let html = htmlFile.content;
  html = html.replace(/<link\b([^>]*?)href=(["'])([^"']+\.css(?:[?#][^"']*)?)\2([^>]*)>/gi, (tag, before, quote, href) => {
    const css = resolveAsset(href);
    return css === null ? tag : '<style>\n' + css.replace(/<\/style/gi, '<\\/style') + '\n</style>';
  });
  html = html.replace(/<script\b([^>]*?)src=(["'])([^"']+\.js(?:[?#][^"']*)?)\2([^>]*)>\s*<\/script>/gi, (tag, before, quote, src) => {
    const js = resolveAsset(src);
    return js === null ? tag : '<script>\n' + js.replace(/<\/script/gi, '<\\/script') + '\n</script>';
  });
  if (!/<head[\s>]/i.test(html)) html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>' + html + '</body></html>';
  const previewCsp = "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline' data:; script-src 'unsafe-inline'; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
  html = html.replace(/<head\b[^>]*>/i, (head) => head + '<meta http-equiv="Content-Security-Policy" content="' + previewCsp + '">');
  return html;
}

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
  const [details, setDetails] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reviewReason, setReviewReason] = useState('');
  const [reviewProposed, setReviewProposed] = useState('');
  const [reviewPath, setReviewPath] = useState('');
  const [reviewOpen, setReviewOpen] = useState(false);
  const [manualEditMode, setManualEditMode] = useState(false);
  const [manualComment, setManualComment] = useState('');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewHtml, setPreviewHtml] = useState('');
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishRepository, setPublishRepository] = useState('');
  const [publishBranch, setPublishBranch] = useState('');
  const [publishRepos, setPublishRepos] = useState<GhRepo[]>([]);
  const [publishing, setPublishing] = useState(false);
  const [codeModelPickerOpen, setCodeModelPickerOpen] = useState(false);
  const [filesDrawerOpen, setFilesDrawerOpen] = useState(false);

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
      setManualEditMode(false);
      setManualComment('');
      setDetails(null);
      setFilesDrawerOpen(false);
      setReviewOpen(false);
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
  useEffect(() => { void refresh().catch((error) => alertCompat('تعذّر تحميل المشروع', error instanceof Error ? error.message : 'خطأ في التخزين المحلي.')); }, [refresh]);

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
    modelId?: string,
  ): Promise<string> {
    const selectedModel = (modelId || project?.codeModelId || provider.model).trim();
    if (!provider.baseUrl.trim() || !selectedModel) {
      throw new Error('اختار مزودًا وموديلًا من الإعدادات أولًا.');
    }
    const apiKey = provider.keyless ? '' : await getStoredModelApiKey();
    const response = await fetchWithRetry(endpointFor(provider.baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
      body: JSON.stringify({
        model: selectedModel,
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
      // Read a cloned response exactly once. Some React Native fetch adapters
      // mark the original body as consumed while exposing stream metadata;
      // response.json() then throws "Response body is already used".
      const payloadText = await response.clone().text();
      let payload: any;
      try {
        payload = JSON.parse(payloadText);
      } catch {
        throw new Error(`استجابة غير صالحة من مزود الموديل: ${payloadText.slice(0, 400) || 'empty response'}`);
      }
      const full = readPayloadContent(payload);
      if (!full) throw new Error('استجابة الموديل لا تحتوي على نص داخل choices[0].message.content.');
      if (onChunk) onChunk(full);
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
    void setActiveSession(sessionId).catch((error) => alertCompat('تعذّر فتح المشروع', error instanceof Error ? error.message : 'خطأ غير معروف.'));
  }

  async function createFile() {
    if (!activeSession || !newPath.trim()) return;
    if (project?.files.some(file => file.path === newPath.trim())) { alertCompat('الملف موجود بالفعل', 'افتح الملف من الشجرة بدل إنشاء ملف بنفس المسار حتى لا يتم استبدال محتواه.'); return; }
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
    if (!activeSession || !selectedPath || !selectedFile || !manualEditMode) return;
    setBusy(true);
    try {
      const source = draft;
      const comment = manualComment.trim();
      await saveProjectFile(activeSession.id, activeSession.title, selectedPath, source);
      await refresh(selectedPath);
      const raw = await callCodeModel([
        { role: 'system', content: 'You are reviewing a developer\'s manual edit and optional instruction comment. Review the entire file and the full edit in context. Preserve the user\'s intentional changes. If the comment requests a code change, implement that request in the proposed complete file, integrating it with existing logic; remove an instruction comment only when it has been implemented, otherwise preserve it. Fix only real correctness, security, consistency, and workflow issues. Return ONLY JSON: {"should_change":boolean,"reason":"short explanation","proposed_code":"complete updated file"}. Never claim tests were run. Do not erase the manual changes.' },
        { role: 'user', content: `File: ${selectedPath}\nManual user comment/instruction: ${comment || '(none)'}\n\nComplete manually edited source:\n${source}\n\nReview the full file and reconcile the comment with the implementation. Return JSON only.` },
      ], 0.1);
      const jsonText = raw.trim().replace(/^\`\`\`(?:json)?\s*/i, '').replace(/\s*\`\`\`$/, '');
      const parsed = JSON.parse(jsonText) as { should_change?: boolean; reason?: string; proposed_code?: string };
      if (parsed.should_change && typeof parsed.proposed_code === 'string' && parsed.proposed_code.trim() && parsed.proposed_code !== source) {
        await proposeCodeReview(activeSession.id, selectedPath, source, parsed.proposed_code, parsed.reason || 'مراجعة التعديل اليدوي والتعليق');
        await refresh(selectedPath);
        alertCompat('يوجد اقتراح تعديل صحيح', 'حافظنا على تعديلك، والموديل جهّز نسخة محسّنة متوافقة مع الملف كاملًا. لن تُطبق إلا بعد موافقتك.');
      } else {
        alertCompat('اجتازت المراجعة', 'لم يجد الموديل تغييرًا جوهريًا مطلوبًا. تم حفظ تعديلك كما هو.');
      }
      setManualEditMode(false);
      setManualComment('');
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
    if (selectedFile && draft !== selectedFile.content) { alertCompat('احفظ التعديلات أولًا', 'احفظ الملف المفتوح قبل تصدير ZIP حتى يتضمن آخر نسخة.'); return; }
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
    if (selectedFile && draft !== selectedFile.content) { alertCompat('احفظ التعديلات أولًا', 'احفظ الملف المفتوح قبل استيراد ZIP حتى لا تفقد تغييراتك.'); return; }
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
        if (!path || path.includes(String.fromCharCode(0)) || path.startsWith('/') || /^[a-zA-Z]:/.test(path) ||
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
      if (first) { selectedPathRef.current = first; setSelectedPath(first); draftRef.current = entries[0].content; setDraft(entries[0].content); setOpenPaths([first]); }
      alertCompat('اكتمل استيراد المشروع', `تم استيراد ${count} ملفًا نصيًا إلى هذه المحادثة. الملفات الثنائية تم تجاهلها.`);
    } catch (e) { alertCompat('فشل استيراد ZIP', e instanceof Error ? e.message : 'ملف غير صالح أو كبير جدًا.'); }
  }
  async function buildProjectAutomatically() {
    if (selectedFile && draft !== selectedFile.content) { alertCompat('احفظ التعديلات أولًا', 'احفظ الملف المفتوح قبل البناء التلقائي حتى لا يستبدل محتوى غير محفوظ.'); return; }
    if (!activeSession || !goal.trim()) { alertCompat('اكتب وصف المشروع أولًا', 'اكتب المطلوب في حقل المهمة ثم ابدأ البناء التلقائي.'); return; }
    if (!provider.baseUrl.trim() || !provider.model.trim()) { alertCompat('الموديل غير مضبوط', 'اختار مزودًا وموديلًا من إعدادات التطبيق.'); return; }
    setBusy(true);
    try {
      // The primary chat/planning model creates the plan. The secondary model
      // is reserved for writing and reviewing code inside this editor only.
      const rawPlan=await callCodeModel([
        {role:'system',content:'Plan a software project as a practical ordered list of files. Return ONLY JSON: {"files":[{"path":"relative/path.ext","task":"specific task"}]}. Include only necessary source/config/test/docs files. No absolute paths, no .. segments, no secrets, max 30 files. Make each task describe exact responsibilities and acceptance criteria for that file.'},
        {role:'user',content:`Project: ${activeSession.title}\nRequirements:\n${goal}\nExisting files:\n${(project?.files??[]).map(f=>f.path).join('\n')}`},
      ],0.2,undefined,provider.model);
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
        // Create/select the destination before streaming so the editor and
        // file tree render immediately, including for brand-new files.
        await saveProjectFile(activeSession.id,activeSession.title,item.path,old);
        await refresh(item.path);
        selectedPathRef.current = item.path;
        setSelectedPath(item.path);
        setDraft('');
        const generated=await callCodeModel([
          {role:'system',content:'You are a code-writing worker in an IDE. Return only the complete contents of this one file, no markdown fences. Keep interfaces consistent with the provided existing project files. Secure, maintainable code. Never claim tests ran.'},
          {role:'user',content:`Project: ${activeSession.title}\nOverall requirements:\n${goal}\nFile ${i+1}/${normalized.length}: ${item.path}\nTask: ${item.task}\nExisting project files (path and contents):\n${current.files.map(f=>`--- ${f.path} ---\n${f.content.slice(0,12000)}`).join('\n').slice(0,50000)}\nExisting content for target file:\n${old}\nReturn the full new contents for ${item.path} only.`},
        ],0.2,(chunk: string)=>setDraft(value=>value+chunk));
        const output=generated.replace(/^\`\`\`[a-zA-Z0-9_-]*\s*\n/,'').replace(/\n\`\`\`\s*$/,'');
        if(!output.trim()) throw new Error(`الموديل لم ينتج محتوى للملف ${item.path}`);
        await saveProjectFile(activeSession.id,activeSession.title,item.path,output);
        generatedPaths.push(item.path);
        const after=await getDeveloperProject(activeSession.id,activeSession.title);
        const step=after.plan[i];
        if(step) await updatePlanStep(activeSession.id,step.id,'done');
        await refresh(item.path);
      }
      const finished=await getDeveloperProject(activeSession.id,activeSession.title);
      const completedSteps = finished.plan.filter(step => step.status === 'done');
      if (generatedPaths.length !== normalized.length || completedSteps.length !== normalized.length) {
        throw new Error('لم يكتمل توليد جميع الملفات؛ تم إيقاف المراجعة حتى لا تُراجع نسخة ناقصة.');
      }
      for(const file of finished.files.filter(item => generatedPaths.includes(item.path))) {
        try {
          const review=await callCodeModel([
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

  async function submitReview() {
    if (!activeSession || !reviewPath.trim()) return;
    try {
      const file = project?.files.find(f => f.path === reviewPath);
      const original = reviewPath === selectedPath ? draft : (file?.content ?? '');
      if (reviewPath === selectedPath && selectedFile && draft !== selectedFile.content) await saveProjectFile(activeSession.id, activeSession.title, reviewPath, draft);
      await proposeCodeReview(activeSession.id, reviewPath, original, reviewProposed, reviewReason);
      setReviewOpen(false); await refresh();
      alertCompat('الاقتراح بانتظار موافقتك', 'لم يتم تطبيق أي تغيير تلقائيًا.');
    } catch (error) { alertCompat('تعذّر إنشاء المراجعة', error instanceof Error ? error.message : 'خطأ غير معروف.'); }
  }
  async function decideReview(id: string, approve: boolean) {
    if (!activeSession) return;
    try {
      const pending = project?.reviews.find(item => item.id === id);
      await decideCodeReview(activeSession.id, id, approve);
      if (approve && pending?.filePath === selectedPath) {
        const latest = await getDeveloperProject(activeSession.id, activeSession.title);
        const applied = latest.files.find(file => file.path === pending.filePath);
        if (applied) {
          // Apply the approved full-file proposal to the visible editor too;
          // do not let refresh treat the pre-approval text as an unsaved draft.
          draftRef.current = applied.content;
          setDraft(applied.content);
        }
      }
      await refresh(selectedPath);
      alertCompat(approve ? 'تم تطبيق التعديل الموافق عليه' : 'تم رفض الاقتراح', approve ? 'تم تحديث الملف في المشروع والمحرر.' : 'لم يتغير محتوى الملف.');
    } catch (e) { alertCompat('تعذّر تنفيذ القرار', e instanceof Error ? e.message : 'خطأ غير معروف'); }
  }

  const planComplete = !!project?.plan.length && project.plan.every(step => step.status === 'done');

  async function openProjectPreview() {
    if (!project?.files.length) { alertCompat('لا توجد ملفات للمعاينة', 'أنشئ ملفات المشروع أولًا.'); return; }
    try {
      const files = project.files.map(file => file.path === selectedPath && draft !== file.content ? { ...file, content: draft } : file);
      const html = buildProjectPreviewHtml(files, selectedPath);
      setPreviewHtml(html);
      setPreviewOpen(true);
    } catch (error) {
      alertCompat('المعاينة غير متاحة', error instanceof Error ? error.message : 'لا يوجد مدخل HTML صالح.');
    }
  }

  async function openPublishDialog() {
    if (!activeSession || !project?.files.length) { alertCompat('المشروع فارغ', 'أضف ملفات قبل النشر.'); return; }
    if (selectedFile && draft !== selectedFile.content) { alertCompat('احفظ التعديل أولًا', 'احفظ الملف المفتوح قبل مراجعة ونشر المشروع.'); return; }
    try {
      const token = await loadGithubToken();
      if (!token) { alertCompat('GitHub غير متصل', 'أضف GitHub token من صفحة الإعدادات أو GitHub أولًا.'); return; }
      setPublishing(true);
      const repos = await listRepos(token);
      setPublishRepos(repos);
      if (!publishRepository && repos[0]) {
        setPublishRepository(repos[0].full_name);
        setPublishBranch(repos[0].default_branch);
      }
      setPublishOpen(true);
    } catch (error) {
      alertCompat('تعذّر تحميل مستودعات GitHub', error instanceof Error ? error.message : 'خطأ في الاتصال.');
    } finally { setPublishing(false); }
  }

  async function choosePublishRepository(fullName: string) {
    setPublishRepository(fullName);
    setPublishBranch('');
    try {
      const token = await loadGithubToken();
      if (!token) throw new Error('GitHub token غير متاح.');
      const branch = await getDefaultBranch(token, fullName);
      setPublishBranch(branch);
    } catch (error) {
      alertCompat('تعذّر قراءة الفرع الافتراضي', error instanceof Error ? error.message : 'خطأ غير معروف');
    }
  }

  async function publishProjectToGithub() {
    if (!activeSession || !project?.files.length || !publishRepository.trim()) return;
    if (selectedFile && draft !== selectedFile.content) { alertCompat('احفظ التعديل أولًا', 'احفظ الملف المفتوح قبل النشر.'); return; }
    setPublishing(true);
    let published = 0;
    let unchanged = 0;
    try {
      const token = await loadGithubToken();
      if (!token) throw new Error('GitHub token غير متاح.');
      if (project.files.length > 50) throw new Error('المشروع يحتوي على أكثر من 50 ملفًا. قسّم النشر إلى وحدات أصغر حتى يمكن مراجعة كل ملف قبل النشر.');
      for (const file of project.files) {
        const bytes = new TextEncoder().encode(file.content).byteLength;
        if (bytes > 250_000) throw new Error(`الملف ${file.path} يتجاوز حد GitHub البالغ 250KB.`);
      }

      // Full-project code review comes before the first GitHub write.
      const proposals: Array<{ file: DeveloperProjectFile; proposed: string; reason: string }> = [];
      for (const file of project.files) {
        const reviewRaw = await callCodeModel([
          { role: 'system', content: 'Perform a full-file pre-publication code review for correctness, security, consistency and integration risks. Return ONLY JSON {"should_change":boolean,"reason":"short","proposed_code":"complete file"}. Do not claim tests were run. Preserve existing intended behavior. If there is no real issue, should_change=false.' },
          { role: 'user', content: `Repository target: ${publishRepository}\nProject: ${activeSession.title}\nProject file manifest:\n${project.files.map(item => item.path).join('\n')}\nRelated files context (read-only, do not rewrite these):\n${project.files.filter(item => item.path !== file.path).map(item => `--- ${item.path} ---\n${item.content.slice(0, 5000)}`).join('\n').slice(0, 30000)}\nFile to review: ${file.path}\nComplete source:\n${file.content}\nReview this entire file together with its integration context before publication.` },
        ], 0.1);
        const reviewJson = reviewRaw.trim().replace(/^\`\`\`(?:json)?\s*/i, '').replace(/\s*\`\`\`$/, '');
        const review = JSON.parse(reviewJson) as { should_change?: boolean; reason?: string; proposed_code?: string };
        if (review.should_change && typeof review.proposed_code === 'string' && review.proposed_code.trim() && review.proposed_code !== file.content) {
          proposals.push({ file, proposed: review.proposed_code, reason: review.reason || 'مراجعة ما قبل النشر' });
        }
      }
      if (proposals.length) {
        for (const item of proposals) await proposeCodeReview(activeSession.id, item.file.path, item.file.content, item.proposed, item.reason);
        await refresh(selectedPath);
        setPublishOpen(false);
        alertCompat('تم إيقاف النشر للمراجعة', `اكتشف الموديل ${proposals.length} ملفات تحتاج إلى تحسين. أضفنا اقتراحات للمراجعة والموافقة؛ لم نرفع أي ملف إلى GitHub.`);
        return;
      }

      const branch = publishBranch.trim() || await getDefaultBranch(token, publishRepository.trim());
      let commitUrls: string[] = [];
      for (const file of project.files) {
        try {
          const remote = await readFileSnapshot(token, publishRepository.trim(), file.path, branch);
          if (remote.content === file.content) { unchanged += 1; continue; }
          const result = await updateGithubFile(token, publishRepository.trim(), file.path, file.content, `Update ${file.path} from OneByte Agent`, branch, remote.sha);
          if (result.commitUrl) commitUrls.push(result.commitUrl);
          published += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (!/404/.test(message)) throw error;
          const result = await createGithubFile(token, publishRepository.trim(), file.path, file.content, `Create ${file.path} from OneByte Agent`, branch);
          if (result.commitUrl) commitUrls.push(result.commitUrl);
          published += 1;
        }
      }
      setPublishOpen(false);
      alertCompat('اكتمل النشر على GitHub', `المستودع: ${publishRepository}\nالفرع: ${branch}\nملفات مرفوعة/محدّثة: ${published}\nملفات مطابقة دون تغيير: ${unchanged}\n${commitUrls.slice(0, 3).join('\n')}`);
    } catch (error) {
      alertCompat('توقف النشر', `تم رفع ${published} ملفًا قبل التوقف. ${error instanceof Error ? error.message : 'خطأ غير معروف'}`);
    } finally { setPublishing(false); }
  }


  return <View style={[s.root,{backgroundColor:colors.background}]}>
    <ScreenTopBar active="developer" center={<Text style={{color:colors.foreground,fontWeight:'700'}}>مختبر المطوّر</Text>} />
    <View style={s.header}><View style={{flex:1}}><Text style={[s.heading,{color:colors.foreground}]}>مساحة المشروع</Text><Text style={{color:colors.mutedForeground,fontSize:12}}>{activeSession?.title ?? 'اختر محادثة مطوّر'}</Text></View><Pressable accessibilityRole="button" accessibilityLabel="إنشاء مشروع جديد" onPress={() => void newProject()} style={[s.button,{borderColor:colors.border,paddingHorizontal:compactLayout?9:12}]}><Feather name="plus" size={14} color={colors.foreground}/>{!compactLayout?<Text style={{color:colors.foreground}}>مشروع جديد</Text>:null}</Pressable></View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[s.sessions, { alignItems: 'center' }]}>
      {sessions.filter(x=>x.mode==='developer').map(x=><Pressable key={x.id} onPress={()=>openProjectSession(x.id)} style={[s.chip,{borderColor:x.id===activeSession?.id?colors.primary:colors.border,backgroundColor:x.id===activeSession?.id?colors.accentSubtle:colors.card}]}><Text style={{color:x.id===activeSession?.id?colors.primary:colors.foreground}} numberOfLines={1}>{x.title||'مشروع بدون اسم'}</Text></Pressable>)}
      {!sessions.some(x=>x.mode==='developer') ? <Text style={{color:colors.mutedForeground,fontSize:12,paddingHorizontal:8}}>لا توجد مشاريع بعد — أنشئ مشروعًا جديدًا أو استورد ملفاتك.</Text> : null}
    </ScrollView>
    {compactLayout ? (
      <View style={[s.mobileFileBar,{borderColor:colors.border,backgroundColor:colors.card}]}>
        <Pressable onPress={()=>setFilesDrawerOpen(true)} style={[s.mobileFilesButton,{backgroundColor:colors.accentSubtle,borderColor:colors.border}]}>
          <Feather name="folder" size={15} color={colors.primary}/>
          <Text numberOfLines={1} style={{color:colors.foreground,fontSize:12,fontWeight:'700',flex:1}}>الملفات · {project?.files.length??0}</Text>
          <Feather name="chevron-down" size={14} color={colors.mutedForeground}/>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="اختيار موديل كتابة الكود" onPress={()=>setCodeModelPickerOpen(true)} style={[s.mobileToolButton,{borderColor:colors.border,backgroundColor:colors.background,paddingHorizontal:7}]}>
          <Feather name="cpu" size={15} color={colors.primary}/>
          <Text style={{color:colors.foreground,fontSize:10,fontWeight:'700'}}>موديل الكود</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="معاينة المشروع بالكامل" onPress={()=>void openProjectPreview()} style={[s.mobileToolButton,{borderColor:colors.border,backgroundColor:colors.background,paddingHorizontal:7}]}>
          <Feather name="play" size={15} color={colors.primary}/>
          <Text style={{color:colors.foreground,fontSize:10,fontWeight:'700'}}>Preview</Text>
        </Pressable>
      </View>
    ) : null}
    {compactLayout ? (
      <Modal visible={filesDrawerOpen} transparent animationType="slide" onRequestClose={()=>setFilesDrawerOpen(false)}>
        <View style={s.mobileFilesOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={()=>setFilesDrawerOpen(false)} accessibilityLabel="إغلاق قائمة الملفات"/>
          <View style={[s.mobileFilesSheet,{backgroundColor:colors.card,borderColor:colors.border}]}>
            <View style={s.mobileFilesHeader}>
              <Text style={{color:colors.foreground,fontSize:15,fontWeight:'800',flex:1}}>ملفات المشروع الحالي</Text>
              <Pressable onPress={()=>setFilesDrawerOpen(false)} style={s.mobileToolButton}><Feather name="x" size={19} color={colors.foreground}/></Pressable>
            </View>
            <View style={s.inline}>
              <TextInput value={newPath} onChangeText={setNewPath} placeholder="src/main.ts" placeholderTextColor={colors.mutedForeground} style={[s.path,{color:colors.foreground,borderColor:colors.border}]}/>
              <Pressable onPress={()=>void createFile()} style={[s.plus,{backgroundColor:colors.primary}]}><Feather name="plus" size={15} color={colors.primaryForeground}/></Pressable>
            </View>
            <ScrollView style={s.mobileFilesList} keyboardShouldPersistTaps="handled">
              {visibleOutline.map(item=><Pressable key={item.path} onPress={()=>{if(item.directory){setCollapsedFolders(prev=>({...prev,[item.path]:!prev[item.path]}));}else{selectProjectFile(item.path);setFilesDrawerOpen(false);}}} style={[s.tree,{paddingLeft:8+item.depth*12,backgroundColor:selectedPath===item.path?colors.accentSubtle:'transparent'}]}>
                <Feather name={item.directory?(collapsedFolders[item.path]?'chevron-right':'chevron-down'):'file-text'} size={14} color={colors.mutedForeground}/>
                <Text numberOfLines={1} style={{color:colors.foreground,fontSize:13,flex:1}}>{item.path.split('/').pop()}</Text>
                {selectedPath===item.path?<Feather name="check" size={13} color={colors.primary}/>:null}
              </Pressable>)}
              {!visibleOutline.length?<Text style={{color:colors.mutedForeground,padding:12}}>المشروع لا يحتوي على ملفات بعد.</Text>:null}
            </ScrollView>
            <View style={s.mobileFilesActions}>
              <Pressable onPress={()=>void importZip().then(()=>setFilesDrawerOpen(false))} style={[s.button,{borderColor:colors.border,flex:1}]}><Feather name="upload" size={14} color={colors.foreground}/><Text style={{color:colors.foreground,fontSize:12}}>استيراد ZIP</Text></Pressable>
              <Pressable onPress={()=>void exportZip()} style={[s.button,{borderColor:colors.border,flex:1}]}><Feather name="download" size={14} color={colors.foreground}/><Text style={{color:colors.foreground,fontSize:12}}>تصدير ZIP</Text></Pressable>
            </View>
            <Pressable disabled={!project?.files.length||publishing||busy} onPress={()=>{setFilesDrawerOpen(false);void openPublishDialog();}} style={[s.publishButton,{backgroundColor:colors.primary,opacity:!project?.files.length||publishing||busy?0.5:1}]}>
              <Feather name="github" size={15} color={colors.primaryForeground}/><Text style={{color:colors.primaryForeground,fontSize:12,fontWeight:'800'}}>نشر المشروع على GitHub</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    ) : null}
    <View style={[s.body, compactLayout ? s.bodyCompact : null]}>
      <View style={[s.sidebar,{borderColor:colors.border,backgroundColor:colors.card}, compactLayout ? { display: 'none' } : null]}>
        <Pressable accessibilityRole="button" onPress={()=>setCodeModelPickerOpen(true)} style={[s.modelSelectCard,{backgroundColor:colors.background,borderColor:colors.border}]}>
          <View style={s.inline}><Feather name="cpu" size={17} color={colors.primary}/><Text style={{color:colors.foreground,fontSize:12,fontWeight:'800'}}>موديل الكود الثنائي</Text></View>
          <Text numberOfLines={1} style={{color:colors.mutedForeground,fontSize:10}}>{project?.codeModelId || 'استخدم الموديل الأساسي'}</Text>
          <Text style={{color:colors.primary,fontSize:10,fontWeight:'700'}}>اختيار موديل التنفيذ فقط</Text>
        </Pressable>
        <View style={s.filePanelHeading}><View style={s.inline}><Feather name="folder" size={15} color={colors.primary}/><Text style={[s.sectionTitle,{color:colors.foreground}]}>ملفات المشروع الحالي</Text></View><Text style={{color:colors.mutedForeground,fontSize:10}}>{project?.files.length ?? 0} ملف</Text></View>
        <View style={s.inline}><TextInput value={newPath} onChangeText={setNewPath} placeholder="src/main.ts" placeholderTextColor={colors.mutedForeground} style={[s.path,{color:colors.foreground,borderColor:colors.border}]}/><Pressable onPress={()=>void createFile()} style={[s.plus,{backgroundColor:colors.primary}]}><Feather name="plus" size={15} color={colors.primaryForeground}/></Pressable></View>
        <ScrollView style={{maxHeight:compactLayout?88:260}}>{visibleOutline.map(item=><Pressable key={item.path} onPress={()=>{if(item.directory){setCollapsedFolders(prev=>({...prev,[item.path]:!prev[item.path]}));}else{selectProjectFile(item.path);}}} style={[s.tree,{paddingLeft:7+item.depth*11,backgroundColor:selectedPath===item.path?colors.accentSubtle:'transparent'}]}><Feather name={item.directory?(collapsedFolders[item.path]?'chevron-right':'chevron-down'):'file-text'} size={13} color={colors.mutedForeground}/><Text numberOfLines={1} style={{color:colors.foreground,fontSize:12,flex:1}}>{item.path.split('/').pop()}</Text></Pressable>)}</ScrollView>
        <View style={s.inline}>
          <Pressable onPress={()=>void exportZip()} style={[s.button,{borderColor:colors.border,flex:1}]}><Feather name="download" size={14} color={colors.foreground}/><Text style={{color:colors.foreground,fontSize:11}}>ZIP</Text></Pressable>
          <Pressable onPress={()=>void importZip()} style={[s.button,{borderColor:colors.border,flex:1}]}><Feather name="upload" size={14} color={colors.foreground}/><Text style={{color:colors.foreground,fontSize:11}}>استيراد</Text></Pressable>
        </View>
        <Pressable accessibilityRole="button" disabled={!project?.files.length||publishing||busy} onPress={()=>void openPublishDialog()} style={[s.publishButton,{backgroundColor:colors.primary,opacity:!project?.files.length||publishing||busy?0.5:1}]}>
          {publishing?<ActivityIndicator size="small" color={colors.primaryForeground}/>:<Feather name="github" size={16} color={colors.primaryForeground}/>}
          <Text style={{color:colors.primaryForeground,fontSize:12,fontWeight:'800'}}>نشر على GitHub</Text>
        </Pressable>
      </View>
      <View style={[s.editor,{borderColor:colors.border,backgroundColor:colors.card}, compactLayout ? s.editorCompact : null]}>
        <View style={s.fileHeading}>
          <View style={{flex:1,minWidth:0}}>
            <Text style={{color:colors.foreground,fontWeight:'800'}} numberOfLines={1}>{selectedPath||'المحرر الأساسي'}</Text>
            <Text style={{color:colors.mutedForeground,fontSize:11}}>{selectedFile?.language??'اختر ملفًا من قائمة المشروع'}{selectedFile && draft!==selectedFile.content ? ' · غير محفوظ' : selectedFile ? ' · محفوظ' : ''}</Text>
            <Text style={{color:colors.mutedForeground,fontSize:10}}>منفّذ الكود: {project?.codeModelId || provider.model || 'غير محدد'} · المخطّط: {provider.model || 'غير محدد'}</Text>
          </View>
          <View style={s.fileActions}>
            {selectedFile ? <Pressable hitSlop={7} accessibilityRole="button" accessibilityLabel="إعادة تسمية الملف" onPress={()=>{setRenameDraft(selectedPath);setRenameOpen(true);}} style={s.fileAction}><Feather name="edit-2" size={15} color={colors.mutedForeground}/></Pressable> : null}
            {selectedFile ? <Pressable hitSlop={7} accessibilityRole="button" accessibilityLabel="حذف الملف" onPress={confirmDeleteFile} style={s.fileAction}><Feather name="trash-2" size={15} color={colors.destructive}/></Pressable> : null}
            <Pressable hitSlop={7} accessibilityRole="button" accessibilityLabel="معاينة المشروع بالكامل" onPress={()=>void openProjectPreview()} style={[s.toolButton,{borderColor:colors.border}]}><Feather name="play" size={14} color={colors.primary}/><Text style={{fontSize:10,color:colors.foreground,fontWeight:'700'}}>Preview</Text></Pressable>
            {selectedFile && planComplete ? <Pressable hitSlop={7} accessibilityRole="button" accessibilityLabel="تعديل يدوي" onPress={()=>setManualEditMode(value=>!value)} style={[s.toolButton,{borderColor:manualEditMode?colors.primary:colors.border,backgroundColor:manualEditMode?colors.accentSubtle:colors.background}]}><Feather name="edit-3" size={14} color={colors.primary}/><Text style={{fontSize:10,color:colors.foreground,fontWeight:'700'}}>{manualEditMode?'إغلاق القلم':'تعديل'}</Text></Pressable> : null}
          </View>
        </View>
        {openPaths.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.fileTabs}>{openPaths.map(path=><Pressable key={path} onPress={()=>selectProjectFile(path)} style={[s.fileTab,{borderColor:path===selectedPath?colors.primary:colors.border,backgroundColor:path===selectedPath?colors.accentSubtle:colors.background}]}><Text numberOfLines={1} style={{color:path===selectedPath?colors.primary:colors.mutedForeground,fontSize:11,fontWeight:'700'}}>{path.split('/').pop()}</Text></Pressable>)}</ScrollView> : null}
        {renameOpen ? <View style={[s.renamePanel,{borderColor:colors.border,backgroundColor:colors.background}]}><TextInput value={renameDraft} onChangeText={setRenameDraft} autoCapitalize="none" autoCorrect={false} placeholder="المسار الجديد للملف" placeholderTextColor={colors.mutedForeground} style={[s.path,{color:colors.foreground,borderColor:colors.border,flex:1}]}/><Pressable onPress={()=>void renameFile()} style={[s.primary,{backgroundColor:colors.primary}]}><Text style={{color:colors.primaryForeground,fontSize:11}}>حفظ الاسم</Text></Pressable><Pressable onPress={()=>setRenameOpen(false)} style={[s.button,{borderColor:colors.border}]}><Text style={{color:colors.foreground,fontSize:11}}>إلغاء</Text></Pressable></View> : null}
        {selectedFile ? (
          <TextInput value={draft} onChangeText={setDraft} editable={manualEditMode && !busy} multiline autoCapitalize="none" autoCorrect={false} spellCheck={false} textAlignVertical="top" placeholder="اكتب الكود أو عدّله هنا..." placeholderTextColor={colors.mutedForeground} style={[s.code,{color:colors.foreground,borderColor:colors.border}]}/>
        ) : (
          <View style={[s.emptyEditor,{borderColor:colors.border,backgroundColor:colors.background}]}>
            <Feather name="code" size={30} color={colors.primary}/>
            <Text style={{color:colors.foreground,fontSize:15,fontWeight:'800',textAlign:'center'}}>مساحة الكود جاهزة</Text>
            <Text style={{color:colors.mutedForeground,fontSize:12,textAlign:'center',lineHeight:19}}>أنشئ ملفًا من قائمة الملفات، أو استورد مشروع ZIP. بعد اختيار الملف سيظهر محتواه هنا ويمكنك تعديله وحفظه.</Text>
            <Pressable onPress={()=>{setNewPath('src/main.ts');void createFile();}} style={[s.primary,{backgroundColor:colors.primary,marginTop:5}]}><Feather name="file-plus" size={14} color={colors.primaryForeground}/><Text style={{color:colors.primaryForeground}}>إنشاء أول ملف</Text></Pressable>
          </View>
        )}
        {manualEditMode ? (
          <View style={s.manualReviewPanel}>
            <TextInput value={manualComment} onChangeText={setManualComment} multiline placeholder="اكتب تعليقًا أو تعليمات للموديل حول التعديل اليدوي..." placeholderTextColor={colors.mutedForeground} style={[s.manualComment,{color:colors.foreground,borderColor:colors.border,backgroundColor:colors.background}]}/>
            <View style={s.inline}>
              <Pressable disabled={!selectedFile||busy} onPress={()=>void reviewFileWithModel()} style={[s.primary,{backgroundColor:colors.success,opacity:busy?0.6:1}]}><Feather name="save" size={13} color="#fff"/><Text style={{color:'#fff',fontSize:12}}>حفظ ثم مراجعة</Text></Pressable>
            </View>
          </View>
        ) : (
          <Text style={{color:colors.mutedForeground,fontSize:10}}>وضع العرض · اضغط «تعديل» لفتح القلم وإدخال تغييرات أو تعليق للموديل.</Text>
        )}
      </View>
    </View>
    <View style={[s.planStrip,{borderColor:colors.border,backgroundColor:colors.card}]}>
      <View style={s.planStripHeader}>
        <View style={s.inline}><Feather name="activity" size={15} color={colors.primary}/><Text style={{color:colors.foreground,fontWeight:'800',fontSize:12}}>خطة التنفيذ</Text></View>
        <Text style={{color:colors.mutedForeground,fontSize:10}}>{project?.plan.filter(step=>step.status==='done').length??0} / {project?.plan.length??0} مكتملة</Text>
        <View style={{flex:1}}/>
        {busy?<ActivityIndicator size="small" color={colors.primary}/>:null}
      </View>
      {(project?.plan.length??0)>0 ? (
        <>
          <ScrollView
            style={s.planTaskList}
            nestedScrollEnabled
            showsVerticalScrollIndicator={(project?.plan.length ?? 0) > 3}
            contentContainerStyle={s.planTasks}
          >
            {(project?.plan??[]).map((step,index)=>(
              <Pressable key={step.id} onPress={()=>setDetails(details===step.id?null:step.id)} style={[s.planTask,{borderColor:step.status==='done'?colors.success:step.status==='running'?colors.primary:step.status==='error'?colors.destructive:colors.border,backgroundColor:details===step.id?colors.accentSubtle:colors.background}]}>
                <View style={s.planTaskStatus}>
                  {step.status==='done'?<Feather name="check-circle" size={15} color={colors.success}/>:step.status==='running'?<ActivityIndicator size="small" color={colors.primary}/>:step.status==='error'?<Feather name="alert-circle" size={15} color={colors.destructive}/>:<Text style={{color:colors.mutedForeground,fontSize:11,fontWeight:'800'}}>{index+1}</Text>}
                </View>
                <View style={{flex:1,minWidth:0,gap:2}}>
                  <Text numberOfLines={2} style={{color:colors.foreground,fontSize:11,fontWeight:'700'}}>{step.title}</Text>
                  <Text numberOfLines={details===step.id?undefined:1} style={{color:colors.mutedForeground,fontSize:10}}>{step.detail}</Text>
                </View>
                <Feather name={details===step.id?'chevron-up':'chevron-down'} size={13} color={colors.mutedForeground}/>
              </Pressable>
            ))}
          </ScrollView>
          {details ? <View style={[s.planDetail,{borderTopColor:colors.border}]}><Text style={{color:colors.foreground,fontSize:11,fontWeight:'700'}}>{project?.plan.find(step=>step.id===details)?.title}</Text><Text style={{color:colors.mutedForeground,fontSize:10,lineHeight:15}}>{project?.plan.find(step=>step.id===details)?.detail}</Text></View> : null}
        </>
      ) : <Text style={{color:colors.mutedForeground,fontSize:10}}>ستظهر هنا كل مهام الملفات بعد تحليل وصف المشروع بالموديل الأساسي.</Text>}
    </View>
    {pendingReviews.length>0&&<View style={[s.review,{borderColor:colors.warning,backgroundColor:colors.card}]}><Text style={{color:colors.foreground,fontWeight:'700'}}>اقتراحات تنتظر الموافقة</Text>{pendingReviews.map(r=><View key={r.id} style={{gap:6,marginTop:5}}><Text style={{color:colors.foreground}}>{r.filePath} — {r.reason}</Text><View style={s.inline}><Pressable onPress={()=>void decideReview(r.id,true)} style={[s.primary,{backgroundColor:colors.success}]}><Text style={{color:'#fff'}}>موافقة وتطبيق</Text></Pressable><Pressable onPress={()=>void decideReview(r.id,false)} style={[s.button,{borderColor:colors.border}]}><Text style={{color:colors.foreground}}>رفض</Text></Pressable></View></View>)}</View>}
    <View style={[s.promptBar,{borderColor:colors.border,backgroundColor:colors.card}]}>
      <TextInput value={goal} onChangeText={setGoal} placeholder="اكتب وصف المشروع أو التعديل المطلوب..." placeholderTextColor={colors.mutedForeground} style={[s.promptInput,{color:colors.foreground}]} returnKeyType="send" onSubmitEditing={()=>{if(!busy) void buildProjectAutomatically();}} />
      <Pressable accessibilityRole="button" accessibilityLabel="بناء المشروع من الوصف" disabled={busy||!goal.trim()} onPress={()=>void buildProjectAutomatically()} style={[s.promptSend,{backgroundColor:colors.primary,opacity:busy||!goal.trim()?0.5:1}]}>
        {busy?<ActivityIndicator size="small" color={colors.primaryForeground}/>:<Feather name="arrow-up" size={18} color={colors.primaryForeground}/>}
      </Pressable>
    </View>
    {reviewOpen&&<View style={[s.review,{borderColor:colors.border,backgroundColor:colors.card}]}><Text style={{color:colors.foreground,fontWeight:'700'}}>اقتراح تعديل — لن يطبق دون موافقتك</Text><TextInput value={reviewPath} onChangeText={setReviewPath} placeholder="مسار الملف" placeholderTextColor={colors.mutedForeground} style={[s.path,{color:colors.foreground,borderColor:colors.border}]}/><TextInput value={reviewReason} onChangeText={setReviewReason} placeholder="سبب التعديل" placeholderTextColor={colors.mutedForeground} style={[s.path,{color:colors.foreground,borderColor:colors.border}]}/><TextInput value={reviewProposed} onChangeText={setReviewProposed} multiline placeholder="الكود المقترح" placeholderTextColor={colors.mutedForeground} style={[s.planInput,{color:colors.foreground,borderColor:colors.border}]}/><View style={s.inline}><Pressable onPress={()=>void submitReview()} style={[s.primary,{backgroundColor:colors.primary}]}><Text style={{color:colors.primaryForeground}}>إرسال للمراجعة</Text></Pressable><Pressable onPress={()=>setReviewOpen(false)} style={[s.button,{borderColor:colors.border}]}><Text style={{color:colors.foreground}}>إلغاء</Text></Pressable></View></View>}
    <Modal visible={publishOpen} transparent animationType="fade" onRequestClose={()=>setPublishOpen(false)}>
      <View style={s.publishOverlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={()=>setPublishOpen(false)}/>
        <View style={[s.publishModal,{backgroundColor:colors.card,borderColor:colors.border}]}>
          <View style={s.publishModalHeader}>
            <View style={{flex:1,gap:3}}>
              <Text style={{color:colors.foreground,fontSize:16,fontWeight:'900'}}>نشر المشروع على GitHub</Text>
              <Text style={{color:colors.mutedForeground,fontSize:11}}>سيتم إجراء Code Review لكل ملف قبل أول عملية رفع.</Text>
            </View>
            <Pressable onPress={()=>setPublishOpen(false)} style={s.fileAction}><Feather name="x" size={19} color={colors.foreground}/></Pressable>
          </View>
          <TextInput value={publishRepository} onChangeText={setPublishRepository} autoCapitalize="none" autoCorrect={false} placeholder="owner/repository" placeholderTextColor={colors.mutedForeground} style={[s.publishInput,{color:colors.foreground,borderColor:colors.border}]}/>
          <TextInput value={publishBranch} onChangeText={setPublishBranch} autoCapitalize="none" autoCorrect={false} placeholder="branch (افتراضي: الفرع الرئيسي)" placeholderTextColor={colors.mutedForeground} style={[s.publishInput,{color:colors.foreground,borderColor:colors.border}]}/>
          <Text style={{color:colors.mutedForeground,fontSize:10}}>المستودعات المتاحة:</Text>
          <ScrollView style={s.repoList} keyboardShouldPersistTaps="handled">
            {publishRepos.map(repo=><Pressable key={repo.full_name} onPress={()=>void choosePublishRepository(repo.full_name)} style={[s.repoRow,{borderColor:publishRepository===repo.full_name?colors.primary:colors.border,backgroundColor:publishRepository===repo.full_name?colors.accentSubtle:colors.background}]}>
              <Feather name={repo.private?'lock':'github'} size={14} color={colors.primary}/>
              <Text numberOfLines={1} style={{color:colors.foreground,flex:1,fontSize:12,fontWeight:'700'}}>{repo.full_name}</Text>
              <Text style={{color:colors.mutedForeground,fontSize:10}}>{repo.default_branch}</Text>
            </Pressable>)}
            {!publishRepos.length?<Text style={{color:colors.mutedForeground,fontSize:11,padding:8}}>لم يتم تحميل مستودعات GitHub.</Text>:null}
          </ScrollView>
          <View style={s.inline}>
            <Pressable disabled={publishing||!publishRepository.trim()} onPress={()=>void publishProjectToGithub()} style={[s.primary,{backgroundColor:colors.primary,flex:1,opacity:publishing||!publishRepository.trim()?0.5:1}]}>
              {publishing?<ActivityIndicator size="small" color={colors.primaryForeground}/>:<Feather name="upload-cloud" size={14} color={colors.primaryForeground}/>}
              <Text style={{color:colors.primaryForeground,fontSize:12,fontWeight:'800'}}>{publishing?'مراجعة ونشر…':'مراجعة كاملة ثم نشر'}</Text>
            </Pressable>
            <Pressable onPress={()=>setPublishOpen(false)} style={[s.button,{borderColor:colors.border}]}><Text style={{color:colors.foreground,fontSize:12}}>إغلاق</Text></Pressable>
          </View>
        </View>
      </View>
    </Modal>
    <HtmlPreview visible={previewOpen} html={previewHtml} onClose={()=>setPreviewOpen(false)}/>
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
 root:{flex:1,minHeight:0,paddingHorizontal:12,gap:7},modelSelectCard:{borderWidth:1,borderRadius:10,padding:9,gap:6},publishButton:{minHeight:40,borderRadius:9,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:7,paddingHorizontal:10},toolButton:{minHeight:32,borderWidth:1,borderRadius:8,paddingHorizontal:7,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:5},planStrip:{borderWidth:1,borderRadius:11,paddingHorizontal:9,paddingVertical:7,gap:6},planStripHeader:{minHeight:22,flexDirection:'row',alignItems:'center',gap:8},planTaskList:{maxHeight:compactLayout?150:220},planTasks:{gap:5,paddingVertical:2},planTask:{minHeight:42,borderWidth:1,borderRadius:9,paddingHorizontal:9,paddingVertical:7,flexDirection:'row',alignItems:'center',gap:8},planTaskStatus:{width:22,height:22,alignItems:'center',justifyContent:'center'},planDetail:{borderTopWidth:1,paddingTop:6,gap:3},manualReviewPanel:{gap:7,paddingTop:3},manualComment:{minHeight:46,maxHeight:80,borderWidth:1,borderRadius:8,padding:8,fontSize:11,textAlign:'right'},publishOverlay:{flex:1,backgroundColor:'rgba(0,0,0,0.6)',alignItems:'center',justifyContent:'center',padding:14},publishModal:{width:'100%',maxWidth:520,maxHeight:'88%',borderWidth:1,borderRadius:16,padding:13,gap:10},publishModalHeader:{flexDirection:'row',alignItems:'center',gap:8},publishInput:{minHeight:38,borderWidth:1,borderRadius:8,paddingHorizontal:9,fontSize:12},repoList:{maxHeight:210,borderTopWidth:1,borderBottomWidth:1,borderColor:'rgba(128,128,128,0.2)'},repoRow:{minHeight:36,borderWidth:1,borderRadius:8,marginVertical:3,paddingHorizontal:8,flexDirection:'row',alignItems:'center',gap:7},mobileFileBar:{minHeight:40,borderWidth:1,borderRadius:10,paddingHorizontal:6,flexDirection:'row',alignItems:'center',gap:5},mobileFilesButton:{height:32,borderWidth:1,borderRadius:8,paddingHorizontal:8,flex:1,flexDirection:'row',alignItems:'center',gap:6},mobileToolButton:{minHeight:34,borderWidth:1,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:5,borderRadius:8},mobileFilesOverlay:{flex:1,backgroundColor:'rgba(0,0,0,0.58)',justifyContent:'flex-end'},mobileFilesSheet:{height:'78%',borderTopLeftRadius:20,borderTopRightRadius:20,borderWidth:1,padding:12,gap:9},mobileFilesHeader:{flexDirection:'row',alignItems:'center',gap:7},mobileFilesList:{flex:1,minHeight:0,borderTopWidth:1,borderBottomWidth:1,borderColor:'rgba(128,128,128,0.2)'},mobileFilesActions:{flexDirection:'row',gap:8},promptBar:{minHeight:48,borderWidth:1,borderRadius:15,padding:5,flexDirection:'row',alignItems:'center',gap:7},promptInput:{flex:1,minHeight:38,paddingHorizontal:9,fontSize:13},promptSend:{width:36,height:36,borderRadius:12,alignItems:'center',justifyContent:'center'},header:{flexDirection:'row',alignItems:'center',gap:8,paddingTop:8},heading:{fontSize:20,fontWeight:'800'},button:{minHeight:33,paddingHorizontal:9,borderWidth:1,borderRadius:8,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:5},sessions:{gap:7,paddingVertical:3,minHeight:52},chip:{paddingHorizontal:9,paddingVertical:6,borderWidth:1,borderRadius:8,maxWidth:180},body:{flex:1,minHeight:260,flexDirection:'row',gap:8},bodyCompact:{flexDirection:'column',gap:7,minHeight:0},sidebar:{width:205,borderWidth:1,borderRadius:13,padding:9,gap:7},sidebarCompact:{width:'100%',maxHeight:166},sectionTitle:{fontWeight:'700',fontSize:12},inline:{flexDirection:'row',alignItems:'center',gap:7,flexWrap:'wrap'},path:{flex:1,minHeight:32,borderWidth:1,borderRadius:7,paddingHorizontal:7,fontSize:11},plus:{width:32,height:32,borderRadius:7,alignItems:'center',justifyContent:'center'},tree:{minHeight:26,flexDirection:'row',alignItems:'center',gap:5,paddingVertical:4,paddingRight:3,borderRadius:5},editor:{flex:1,minWidth:0,borderWidth:1,borderRadius:13,padding:9,gap:8},editorCompact:{minHeight:0,flex:1},fileTabs:{gap:6,paddingVertical:2},fileTab:{maxWidth:180,borderWidth:1,borderRadius:8,paddingHorizontal:9,paddingVertical:6},renamePanel:{flexDirection:'row-reverse',alignItems:'center',gap:6,borderWidth:1,borderRadius:9,padding:7},filePanelHeading:{flexDirection:'row-reverse',alignItems:'center',justifyContent:'space-between'},emptyEditor:{flex:1,minHeight:190,borderWidth:1,borderStyle:'dashed',borderRadius:10,alignItems:'center',justifyContent:'center',padding:18,gap:9},fileHeading:{flexDirection:'row',alignItems:'center',gap:6,minWidth:0},fileActions:{flexDirection:'row',alignItems:'center',gap:1,flexShrink:0},fileAction:{width:31,height:34,alignItems:'center',justifyContent:'center',borderRadius:7},code:{flex:1,minHeight:80,borderWidth:1,borderRadius:7,padding:7,fontFamily:'monospace',fontSize:12,lineHeight:18},primary:{minHeight:33,paddingHorizontal:10,borderRadius:8,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:5},timeline:{borderWidth:1,borderRadius:11,padding:8,maxHeight:260},timelineHead:{minHeight:28,flexDirection:'row',alignItems:'center',gap:7},planInput:{minHeight:48,maxHeight:90,borderWidth:1,borderRadius:7,padding:7,fontSize:12,marginVertical:5},step:{flexDirection:'row',gap:8},rail:{width:12,alignItems:'center'},dot:{width:9,height:9,borderRadius:5,marginTop:4},connector:{width:2,flex:1,minHeight:22,marginTop:2},review:{borderWidth:1,borderRadius:10,padding:9,gap:6,maxHeight:220},timelinePopover:{position:'absolute',right:8,bottom:48,width:'94%',maxHeight:360,zIndex:30,elevation:12,shadowColor:'#000',shadowOpacity:0.22,shadowRadius:12,shadowOffset:{width:0,height:4}},timelineClosed:{alignSelf:'flex-start',maxHeight:40,borderWidth:0,paddingHorizontal:0,paddingVertical:0,backgroundColor:'transparent'}
});
