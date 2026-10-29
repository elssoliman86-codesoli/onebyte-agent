import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { zipSync, strToU8 } from 'fflate';
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
import {
  buildProjectOutline, decideCodeReview, getDeveloperProject, proposeCodeReview,
  replaceProjectPlan, saveProjectFile, setDeveloperCodeModel, updatePlanStep,
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
  const { activeSession, sessions, provider, createSession, setActiveSession, patchSession } = useAssistant();
  const [project, setProject] = useState<DeveloperProject | null>(null);
  const [selectedPath, setSelectedPath] = useState('');
  const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>({});
  const [draft, setDraft] = useState('');
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

  const refresh = useCallback(async () => {
    if (!activeSession) { setProject(null); setSelectedPath(''); setDraft(''); return; }
    const next = await getDeveloperProject(activeSession.id, activeSession.title);
    setProject(next);
    const chosen = next.files.find(f => f.path === selectedPath) ?? next.files[0];
    setSelectedPath(chosen?.path ?? '');
    setDraft(chosen?.content ?? '');
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

  async function newProject() {
    if (busy) return;
    setBusy(true);
    try { const id = await createSession(); await patchSession(id, { mode: 'developer' }); await setActiveSession(id); }
    catch { alertCompat('تعذّر إنشاء المشروع', 'حاول مرة أخرى.'); }
    finally { setBusy(false); }
  }
  async function createFile() {
    if (!activeSession || !newPath.trim()) return;
    try {
      await saveProjectFile(activeSession.id, activeSession.title, newPath.trim(), '');
      setSelectedPath(newPath.trim()); setDraft(''); await refresh();
    } catch (e) { alertCompat('تعذّر إنشاء الملف', e instanceof Error ? e.message : 'مسار غير صالح'); }
  }
  async function saveFile() {
    if (!activeSession || !selectedPath) return;
    setBusy(true);
    const savedContent = draft;
    const filePath = selectedPath;
    try {
      await saveProjectFile(activeSession.id, activeSession.title, filePath, savedContent);
      try {
        const apiKey = provider.keyless ? '' : await getStoredModelApiKey();
        if (!provider.baseUrl.trim() || !(project?.codeModelId || provider.model).trim()) throw new Error('لا يوجد موديل مراجعة مضبوط.');
        const response = await fetchWithRetry(endpointFor(provider.baseUrl), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
          body: JSON.stringify({
            model: project?.codeModelId || provider.model,
            temperature: 0.1,
            messages: [
              { role: 'system', content: 'Review the complete source file for correctness, logic bugs, security, maintainability, and edge cases. Return ONLY a JSON object with keys "should_change" (boolean), "reason" (short string), and "proposed_code" (complete source file). Never claim tests were run. If no meaningful improvement is needed, set should_change false and proposed_code to the original file.' },
              { role: 'user', content: `Review this entire file. Path: ${filePath}\n\n${savedContent}\n\nReturn JSON only.` },
            ],
          }),
        }, { timeout: 120000, maxRetries: 1 });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json() as { choices?: Array<{message?:{content?:string}}> };
        const raw = payload.choices?.[0]?.message?.content ?? '';
        const parsed = JSON.parse(raw.replace(/^\`\`\`(?:json)?\s*/i, '').replace(/\s*\`\`\`$/, '')) as {should_change?:boolean;reason?:string;proposed_code?:string};
        if (parsed.should_change && typeof parsed.proposed_code === 'string' && parsed.proposed_code.trim() && parsed.proposed_code !== savedContent) {
          await proposeCodeReview(activeSession.id, filePath, savedContent, parsed.proposed_code, parsed.reason || 'مراجعة تلقائية للملف بعد الحفظ');
          await refresh();
          alertCompat('تم حفظ الملف وظهرت مراجعة', 'الموديل اقترح تحسينًا. لم يُطبّق أي تغيير حتى توافق عليه.');
        } else {
          await refresh();
          alertCompat('تم الحفظ والمراجعة', 'لم يقترح الموديل تغييرًا جوهريًا. لم يتم تشغيل الاختبارات تلقائيًا.');
        }
      } catch (reviewError) {
        await refresh();
        alertCompat('تم الحفظ؛ تعذّرت المراجعة الآلية', reviewError instanceof Error ? reviewError.message : 'خطأ غير معروف');
      }
    } catch (error) {
      alertCompat('فشل الحفظ', error instanceof Error ? error.message : 'خطأ غير معروف');
    } finally { setBusy(false); }
  }

  async function exportZip() {
    if (!project?.files.length) { alertCompat('المشروع فارغ', 'أضف ملفات أولًا.'); return; }
    try {
      const entries: Record<string, Uint8Array> = {};
      project.files.forEach(file => { entries[file.path] = strToU8(file.content); });
      const encoded = toBase64(zipSync(entries, { level: 6 }));
      const uri = `${FileSystem.cacheDirectory ?? FileSystem.documentDirectory}onebyte-project-${project.sessionId}.zip`;
      await FileSystem.writeAsStringAsync(uri, encoded, { encoding: FileSystem.EncodingType.Base64 });
      if (Platform.OS !== 'web' && await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: 'application/zip', dialogTitle: 'تحميل المشروع ZIP' });
      else alertCompat('تم تجهيز ملف ZIP', uri);
    } catch (e) { alertCompat('فشل التصدير', e instanceof Error ? e.message : 'خطأ غير معروف'); }
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
      const apiKey = provider.keyless ? '' : await getStoredModelApiKey();
      if (!provider.baseUrl.trim() || !provider.model.trim()) throw new Error('اختار مزودًا وموديلًا من الإعدادات أولًا.');
      if (activeSession.mode !== 'developer') await patchSession(activeSession.id, { mode: 'developer' });
      if (step) await updatePlanStep(activeSession.id, step.id, 'running');
      await refresh();
      const response = await fetchWithRetry(endpointFor(provider.baseUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
        body: JSON.stringify({
          model: project?.codeModelId || provider.model,
          temperature: 0.2,
          messages: [
            { role: 'system', content: 'You are the code-generation worker inside an IDE. Return only the complete file contents, no markdown fences or commentary. Preserve requested language and produce maintainable, secure code. Do not claim to have run tests. Never generate secrets or hardcode credentials.' },
            { role: 'user', content: `Project: ${activeSession.title}\nFile path: ${selectedPath}\nTask: ${goal}\nExisting file content (replace/update as appropriate):\n${draft}\nReturn the complete contents for this one file only.` },
          ],
        }),
      }, { timeout: 120000, maxRetries: 1 });
      if (!response.ok) throw new Error(`Provider returned HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
      const payload = await response.json() as { choices?: Array<{ message?: { content?: string | Array<{type?:string;text?:string}> } }> };
      const content = payload.choices?.[0]?.message?.content;
      const generated = typeof content === 'string' ? content : Array.isArray(content) ? content.map(part => part.text ?? '').join('') : '';
      if (!generated.trim()) throw new Error('الموديل لم يرجع محتوى كود صالحًا.');
      const clean = generated.replace(/^\`\`\`[a-zA-Z0-9_-]*\s*\n/, '').replace(/\n\`\`\`\s*$/, '');
      await saveProjectFile(activeSession.id, activeSession.title, selectedPath, clean);
      setDraft(clean);
      if (step) await updatePlanStep(activeSession.id, step.id, 'done');
      await refresh();
      alertCompat('اكتمل توليد الملف', 'تم حفظ الكود في مساحة المشروع. لم يتم تشغيله تلقائيًا؛ راجعه واختبره قبل الاستخدام.');
    } catch (error) {
      if (step) await updatePlanStep(activeSession.id, step.id, 'error').catch(() => undefined);
      await refresh();
      alertCompat('تعذّر توليد الكود', error instanceof Error ? error.message : 'خطأ غير معروف');
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
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.sessions}>{sessions.filter(x=>x.mode==='developer').map(x=><Pressable key={x.id} onPress={()=>void setActiveSession(x.id)} style={[s.chip,{borderColor:x.id===activeSession?.id?colors.primary:colors.border,backgroundColor:colors.card}]}><Text style={{color:colors.foreground}} numberOfLines={1}>{x.title||'مشروع'}</Text></Pressable>)}</ScrollView>
    <View style={s.body}>
      <View style={[s.sidebar,{borderColor:colors.border,backgroundColor:colors.card}]}>
        <Text style={[s.sectionTitle,{color:colors.foreground}]}> <Feather name="folder" size={14}/> ملفات المشروع</Text>
        <View style={s.inline}><TextInput value={newPath} onChangeText={setNewPath} placeholder="src/main.ts" placeholderTextColor={colors.mutedForeground} style={[s.path,{color:colors.foreground,borderColor:colors.border}]}/><Pressable onPress={()=>void createFile()} style={[s.plus,{backgroundColor:colors.primary}]}><Feather name="plus" size={15} color={colors.primaryForeground}/></Pressable></View>
        <ScrollView style={{maxHeight:240}}>{visibleOutline.map(item=><Pressable key={item.path} onPress={()=>{if(item.directory){setCollapsedFolders(prev=>({...prev,[item.path]:!prev[item.path]}));}else{setSelectedPath(item.path);setDraft(project?.files.find(f=>f.path===item.path)?.content??'');}}} style={[s.tree,{paddingLeft:7+item.depth*11,backgroundColor:selectedPath===item.path?colors.accentSubtle:'transparent'}]}><Feather name={item.directory?(collapsedFolders[item.path]?'chevron-right':'chevron-down'):'file-text'} size={13} color={colors.mutedForeground}/><Text numberOfLines={1} style={{color:colors.foreground,fontSize:12,flex:1}}>{item.path.split('/').pop()}</Text></Pressable>)}</ScrollView>
        <Pressable onPress={()=>void exportZip()} style={[s.button,{borderColor:colors.border}]}><Feather name="download" size={14} color={colors.foreground}/><Text style={{color:colors.foreground,fontSize:11}}>تحميل المشروع ZIP</Text></Pressable>
      </View>
      <View style={[s.editor,{borderColor:colors.border,backgroundColor:colors.card}]}>
        <View style={s.fileHeading}><View style={{flex:1}}><Text style={{color:colors.foreground,fontWeight:'700'}}>{selectedPath||'لا يوجد ملف مفتوح'}</Text><Text style={{color:colors.mutedForeground,fontSize:11}}>{selectedFile?.language??'اختر ملفًا من الشجرة'}</Text><Text style={{color:colors.mutedForeground,fontSize:10}}>موديل الكود: {project?.codeModelId || provider.model || 'غير محدد'}</Text></View><Pressable onPress={()=>setCodeModelPickerOpen(true)} style={{padding:5}}><Feather name="cpu" size={17} color={colors.primary}/></Pressable><Pressable onPress={()=>setPlanOpen(v=>!v)}><Feather name="help-circle" size={18} color={colors.primary}/></Pressable></View>
        <TextInput value={draft} onChangeText={setDraft} editable={!!selectedFile} multiline autoCapitalize="none" autoCorrect={false} spellCheck={false} textAlignVertical="top" placeholder="اكتب الكود أو عدّله هنا..." placeholderTextColor={colors.mutedForeground} style={[s.code,{color:colors.foreground,borderColor:colors.border}]}/>
        <View style={s.inline}><Pressable disabled={!selectedFile||busy} onPress={()=>void saveFile()} style={[s.primary,{backgroundColor:colors.primary,opacity:busy?0.6:1}]}><Feather name="save" size={13} color={colors.primaryForeground}/><Text style={{color:colors.primaryForeground,fontSize:12}}>حفظ</Text></Pressable><Pressable disabled={!selectedFile} onPress={()=>{setReviewPath(selectedPath);setReviewProposed(draft);setReviewReason('مراجعة التعديلات اليدوية');setReviewOpen(true);}} style={[s.button,{borderColor:colors.border}]}><Text style={{color:colors.foreground,fontSize:12}}>طلب مراجعة</Text></Pressable></View>
      </View>
    </View>
    <View style={[s.timeline,{borderColor:colors.border,backgroundColor:colors.card}]}>
      <Pressable style={s.timelineHead} onPress={()=>setPlanOpen(v=>!v)}><Feather name="activity" size={15} color={colors.primary}/><Text style={{color:colors.foreground,fontWeight:'700',flex:1}}>Timeline · خطة التنفيذ</Text><Text style={{color:colors.mutedForeground,fontSize:11}}>{project?.plan.length??0} خطوات</Text><Feather name={planOpen?'chevron-up':'chevron-down'} size={14} color={colors.mutedForeground}/></Pressable>
      {planOpen&&<><TextInput value={goal} onChangeText={setGoal} multiline placeholder="خطوة في كل سطر..." placeholderTextColor={colors.mutedForeground} style={[s.planInput,{color:colors.foreground,borderColor:colors.border}]}/><Pressable onPress={()=>void savePlan()} style={[s.button,{borderColor:colors.border,alignSelf:'flex-start'}]}><Text style={{color:colors.foreground}}>حفظ الخطة</Text></Pressable><Pressable disabled={busy||!selectedFile} onPress={()=>void generateFile()} style={[s.primary,{backgroundColor:colors.primary,alignSelf:'flex-start',opacity:busy?0.6:1}]}><Feather name={busy?'loader':'zap'} size={13} color={colors.primaryForeground}/><Text style={{color:colors.primaryForeground}}>توليد الكود بالموديل الحالي</Text></Pressable><ScrollView style={{maxHeight:170}}>{(project?.plan??[]).map((step,i)=><View key={step.id} style={s.step}><View style={s.rail}><View style={[s.dot,{backgroundColor:step.status==='done'?colors.success:step.status==='running'?colors.primary:step.status==='error'?colors.destructive:colors.border}]}/>{i<(project?.plan.length??0)-1&&<View style={[s.connector,{backgroundColor:colors.border}]}/>}</View><View style={{flex:1,paddingBottom:9}}><Pressable onPress={()=>setDetails(details===step.id?null:step.id)}><Text style={{color:colors.foreground,fontWeight:'600'}}>{step.title}</Text></Pressable><Text style={{color:colors.mutedForeground,fontSize:10}}>{step.status} · {timeLabel(step.startedAt??step.finishedAt)}</Text>{details===step.id&&<Text style={{color:colors.mutedForeground,fontSize:12}}>{step.detail}</Text>}{step.status!=='done'&&<View style={s.inline}><Pressable onPress={()=>void markStep(step,'running')}><Text style={{color:colors.primary,fontSize:11}}>بدء</Text></Pressable><Pressable onPress={()=>void markStep(step,'done')}><Text style={{color:colors.success,fontSize:11}}>اكتملت</Text></Pressable><Pressable onPress={()=>void markStep(step,'error')}><Text style={{color:colors.destructive,fontSize:11}}>فشل</Text></Pressable></View>}</View></View>)}</ScrollView></>}
    </View>
    {pendingReviews.length>0&&<View style={[s.review,{borderColor:colors.warning,backgroundColor:colors.card}]}><Text style={{color:colors.foreground,fontWeight:'700'}}>اقتراحات تنتظر الموافقة</Text>{pendingReviews.map(r=><View key={r.id} style={{gap:6,marginTop:5}}><Text style={{color:colors.foreground}}>{r.filePath} — {r.reason}</Text><View style={s.inline}><Pressable onPress={()=>void decideReview(r.id,true)} style={[s.primary,{backgroundColor:colors.success}]}><Text style={{color:'#fff'}}>موافقة وتطبيق</Text></Pressable><Pressable onPress={()=>void decideReview(r.id,false)} style={[s.button,{borderColor:colors.border}]}><Text style={{color:colors.foreground}}>رفض</Text></Pressable></View></View>)}</View>}
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
 root:{flex:1,minHeight:0,paddingHorizontal:12,gap:8},header:{flexDirection:'row',alignItems:'center',gap:8,paddingTop:8},heading:{fontSize:20,fontWeight:'800'},button:{minHeight:33,paddingHorizontal:9,borderWidth:1,borderRadius:8,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:5},sessions:{gap:6,paddingVertical:3},chip:{paddingHorizontal:9,paddingVertical:6,borderWidth:1,borderRadius:8,maxWidth:180},body:{flex:1,minHeight:170,flexDirection:'row',gap:8},sidebar:{width:185,borderWidth:1,borderRadius:11,padding:7,gap:7},sectionTitle:{fontWeight:'700',fontSize:12},inline:{flexDirection:'row',alignItems:'center',gap:7,flexWrap:'wrap'},path:{flex:1,minHeight:32,borderWidth:1,borderRadius:7,paddingHorizontal:7,fontSize:11},plus:{width:32,height:32,borderRadius:7,alignItems:'center',justifyContent:'center'},tree:{minHeight:26,flexDirection:'row',alignItems:'center',gap:5,paddingVertical:4,paddingRight:3,borderRadius:5},editor:{flex:1,minWidth:0,borderWidth:1,borderRadius:11,padding:7,gap:7},fileHeading:{flexDirection:'row',alignItems:'center',gap:7},code:{flex:1,minHeight:80,borderWidth:1,borderRadius:7,padding:7,fontFamily:'monospace',fontSize:12,lineHeight:18},primary:{minHeight:33,paddingHorizontal:10,borderRadius:8,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:5},timeline:{borderWidth:1,borderRadius:11,padding:8,maxHeight:260},timelineHead:{minHeight:28,flexDirection:'row',alignItems:'center',gap:7},planInput:{minHeight:48,maxHeight:90,borderWidth:1,borderRadius:7,padding:7,fontSize:12,marginVertical:5},step:{flexDirection:'row',gap:8},rail:{width:12,alignItems:'center'},dot:{width:9,height:9,borderRadius:5,marginTop:4},connector:{width:2,flex:1,minHeight:22,marginTop:2},review:{borderWidth:1,borderRadius:10,padding:9,gap:6,maxHeight:220}
});
