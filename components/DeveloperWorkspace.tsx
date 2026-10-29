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

  async function exportZip() {\n    if (!project?.files.length) { alertCompat('المشروع فارغ', 'أضف ملفات أولًا.'); return; }\n    try {\n      const entries: Record<string, Uint8Array> = {};\n      for (const file of project.files) entries[file.path] = strToU8(file.content);\n      const zipped = zipSync(entries, { level: 6 });\n      const base64 = Array.from(zipped).map(b => String.fromCharCode(b)).join('');\n      const encoded = typeof btoa === 'function' ? btoa(base64) : base64;\n      const uri = `${FileSystem.cacheDirectory ?? FileSystem.documentDirectory}onebyte-project-${project.sessionId}.zip`;\n      await FileSystem.writeAsStringAsync(uri, encoded, { encoding: FileSystem.EncodingType.Base64 });\n      if (Platform.OS !== 'web' && await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: 'application/zip', dialogTitle: 'تحميل المشروع' });\n      else alertCompat('تم تجهيز ZIP', uri);\n    } catch (error) { alertCompat('فشل تصدير ZIP', error instanceof Error ? error.message : 'خطأ غير معروف'); }\n  }\n\n  async function openReview() {
    if (!selectedFile) { alertCompat('اختار ملفًا', 'أنشئ ملفًا أو افتح ملفًا قبل طلب مراجعة.'); return; }
    setReviewPath(selectedFile.path);
    setReviewOriginal(selectedFile.content);
    setReviewProposed(draft);
    setReviewReason('مراجعة التعديل الذي كتبته يدويًا قبل اعتماده.');
    setReviewOpen(true);
  }

  async function submitReview() {
    if (!activeSession || !reviewPath.trim()) return;
    try {
      await proposeCodeReview(activeSession.id, reviewPath, reviewOriginal, reviewProposed, reviewReason);
      await refresh();
      setReviewOpen(false);
      alertCompat('تم إرسال التعديل للمراجعة', 'التعديل محفوظ كاقتراح للموافقة، ولم يتم تطبيقه على الملف.');
    } catch (error) { alertCompat('تعذّرت المراجعة', error instanceof Error ? error.message : 'خطأ غير معروف'); }
  }

  async function decideReview(reviewId: string, approve: boolean) {
    if (!activeSession) return;
    try { await decideCodeReview(activeSession.id, reviewId, approve); await refresh(); }
    catch (error) { alertCompat('تعذّر اتخاذ القرار', error instanceof Error ? error.message : 'خطأ غير معروف'); }
  }

  const pendingReviews = project?.reviews.filter(r => r.status === 'pending') ?? [];
  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ScreenTopBar active="developer" center={<Text style={{ color: colors.foreground, fontWeight: '700' }}>مختبر المطوّر</Text>} />
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.heading, { color: colors.foreground }]}>مساحة المشروع</Text>
          <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>{activeSession?.title ?? 'اختر محادثة مطوّر'}</Text>
        </View>
        <Pressable onPress={() => void startProjectChat()} style={[styles.smallButton, { borderColor: colors.border }]}><Feather name="plus" size={15} color={colors.foreground}/><Text style={{color:colors.foreground,fontSize:12}}>مشروع جديد</Text></Pressable>
      </View>
      <View style={styles.sessionPicker}>
        <Text style={{color:colors.mutedForeground,fontSize:12}}>مشاريع المحادثات</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap:6}}>
          {sessions.filter(s => s.mode === 'developer').map(s => <Pressable key={s.id} onPress={() => void setActiveSession(s.id)} style={[styles.sessionChip,{borderColor:s.id===activeSession?.id?colors.primary:colors.border,backgroundColor:s.id===activeSession?.id?colors.accentSubtle:colors.card}]}><Text numberOfLines={1} style={{color:colors.foreground,fontSize:12,maxWidth:140}}>{s.title || 'مشروع'}</Text></Pressable>)}
        </ScrollView>
      </View>
      <View style={styles.body}>
        <View style={[styles.sidebar,{borderColor:colors.border,backgroundColor:colors.card}]}>
          <View style={styles.sidebarHead}><Feather name="folder-tree" size={15} color={colors.primary}/><Text style={{color:colors.foreground,fontWeight:'700',flex:1}}>ملفات المشروع</Text></View>
          <View style={styles.newFileRow}><TextInput value={newPath} onChangeText={setNewPath} placeholder="src/main.ts" placeholderTextColor={colors.mutedForeground} style={[styles.pathInput,{color:colors.foreground,borderColor:colors.border}]}/><Pressable onPress={() => void createFile()} style={[styles.iconButton,{backgroundColor:colors.primary}]}><Feather name="plus" size={16} color={colors.primaryForeground}/></Pressable></View>
          <ScrollView style={{maxHeight:260}}>
            {outline.map(item => <Pressable key={item.path} disabled={item.directory} onPress={() => {setSelectedPath(item.path);setDraft(project?.files.find(f=>f.path===item.path)?.content ?? '');}} style={[styles.treeRow,{paddingLeft:8+item.depth*12,backgroundColor:selectedPath===item.path?colors.accentSubtle:'transparent'}]}><Feather name={item.directory?'folder':'file-text'} size={13} color={item.directory?colors.warning:colors.mutedForeground}/><Text numberOfLines={1} style={{fontSize:12,color:colors.foreground,flex:1}}>{item.path.split('/').pop()}</Text></Pressable>)}
            {!outline.length ? <Text style={[styles.empty,{color:colors.mutedForeground}]}>أنشئ أول ملف للمشروع.</Text> : null}
          </ScrollView>
          <Pressable onPress={() => void exportZip()} style={[styles.exportButton,{borderColor:colors.border}]}><Feather name="download" size={14} color={colors.foreground}/><Text style={{fontSize:11,color:colors.foreground}}>تحميل المشروع ZIP</Text></Pressable>
        </View>
        <View style={[styles.editor,{borderColor:colors.border,backgroundColor:colors.card}]}>
          <View style={[styles.editorHead,{borderBottomColor:colors.border}]}><View style={{flex:1}}><Text style={{color:colors.foreground,fontWeight:'700'}}>{selectedFile?.path ?? 'لا يوجد ملف مفتوح'}</Text><Text style={{color:colors.mutedForeground,fontSize:11}}>{selectedFile?.language ?? 'اختر ملفًا من الشجرة'}</Text></View><Pressable onPress={() => setPlanOpen(v=>!v)} style={styles.headerIcon}><Feather name="git-branch" size={16} color={colors.primary}/></Pressable></View>
          <TextInput value={draft} onChangeText={setDraft} editable={!!selectedFile} multiline autoCapitalize="none" autoCorrect={false} spellCheck={false} textAlignVertical="top" placeholder="اكتب الكود هنا..." placeholderTextColor={colors.mutedForeground} style={[styles.codeInput,{color:colors.foreground,borderColor:colors.border}]} />
          <View style={styles.editorActions}><Pressable disabled={!selectedFile||busy} onPress={() => void saveFile()} style={[styles.actionButton,{backgroundColor:colors.primary,opacity:busy ? 0.6 : 1}]}><Feather name="save" size={14} color={colors.primaryForeground}/><Text style={{color:colors.primaryForeground,fontSize:12}}>حفظ الملف</Text></Pressable><Pressable disabled={!selectedFile} onPress={() => void openReview()} style={[styles.actionButton,{borderColor:colors.border,borderWidth:1}]}><Feather name="git-pull-request" size={14} color={colors.foreground}/><Text style={{color:colors.foreground,fontSize:12}}>مراجعة تعديل</Text></Pressable></View>
        </View>
      </View>
      <View style={[styles.timelinePanel,{borderColor:colors.border,backgroundColor:colors.card}]}>
        <Pressable onPress={() => setPlanOpen(v=>!v)} style={styles.timelineTitle}><Feather name="help-circle" size={16} color={colors.primary}/><Text style={{color:colors.foreground,fontWeight:'700',flex:1}}>خطة التنفيذ</Text><Text style={{color:colors.mutedForeground,fontSize:11}}>{project?.plan.length ?? 0} خطوات</Text><Feather name={planOpen?'chevron-up':'chevron-down'} size={15} color={colors.mutedForeground}/></Pressable>
        {planOpen ? <>
          <TextInput value={goal} onChangeText={setGoal} multiline placeholder="اكتب خطوات الخطة، كل خطوة في سطر منفصل..." placeholderTextColor={colors.mutedForeground} style={[styles.planInput,{color:colors.foreground,borderColor:colors.border}]} />
          <Pressable onPress={() => void createPlan()} style={[styles.smallButton,{borderColor:colors.border,alignSelf:'flex-start'}]}><Feather name="list" size={14} color={colors.foreground}/><Text style={{color:colors.foreground,fontSize:12}}>حفظ الخطة</Text></Pressable>
          <ScrollView style={{maxHeight:190}}>
            {(project?.plan ?? []).map((step,index) => <View key={step.id} style={styles.timelineRow}>
              <View style={styles.timelineRail}><View style={[styles.dot,{backgroundColor:step.status==='done'?colors.success:step.status==='running'?colors.primary:step.status==='error'?colors.destructive:colors.border}]} />{index < (project?.plan.length ?? 0)-1 ? <View style={[styles.connector,{backgroundColor:colors.border}]} /> : null}</View>
              <View style={{flex:1,paddingBottom:12}}>
                <Pressable onPress={() => setDetails(details===step.id?null:step.id)} style={styles.timelineStepHead}><Text style={{color:colors.foreground,fontWeight:'600',flex:1}}>{step.title}</Text><Feather name={details===step.id?'chevron-up':'chevron-down'} size={13} color={colors.mutedForeground}/></Pressable>
                <Text style={{color:colors.mutedForeground,fontSize:10}}>{step.status==='done'?'مكتملة':step.status==='running'?'جارية':step.status==='error'?'فشلت':step.status==='waiting-approval'?'بانتظار الإذن':'معلقة'} · {timeLabel(step.startedAt ?? step.finishedAt)}</Text>
                {details===step.id ? <Text style={{color:colors.mutedForeground,fontSize:12,marginTop:5}}>{step.detail}</Text> : null}
                {step.status!=='done' && <View style={styles.stepActions}><Pressable onPress={() => void markStep(step,'running')}><Text style={{color:colors.primary,fontSize:11}}>بدء</Text></Pressable><Pressable onPress={() => void markStep(step,'done')}><Text style={{color:colors.success,fontSize:11}}>تمت</Text></Pressable><Pressable onPress={() => void markStep(step,'error')}><Text style={{color:colors.destructive,fontSize:11}}>فشل</Text></Pressable></View>}
              </View>
            </View>)}
          </ScrollView>
        </> : null}
      </View>
      {pendingReviews.length ? <View style={[styles.reviewPanel,{borderColor:colors.warning,backgroundColor:colors.card}]}><Text style={{color:colors.foreground,fontWeight:'700',marginBottom:6}}>مراجعات تنتظر قرارك</Text>{pendingReviews.map(r=><View key={r.id} style={{gap:5,marginBottom:10}}><Text style={{color:colors.foreground}}>{r.filePath}</Text><Text style={{color:colors.mutedForeground,fontSize:12}}>{r.reason}</Text><View style={{flexDirection:'row',gap:8}}><Pressable onPress={() => void decideReview(r.id,true)} style={[styles.actionButton,{backgroundColor:colors.success}]}><Text style={{color:'#fff',fontSize:12}}>موافقة وتطبيق</Text></Pressable><Pressable onPress={() => void decideReview(r.id,false)} style={[styles.actionButton,{borderWidth:1,borderColor:colors.border}]}><Text style={{color:colors.foreground,fontSize:12}}>رفض</Text></Pressable></View></View>)}</View>:null}
      {reviewOpen ? <View style={[styles.reviewPanel,{borderColor:colors.border,backgroundColor:colors.card}]}><Text style={{color:colors.foreground,fontWeight:'700'}}>اقتراح تعديل للمراجعة</Text><TextInput value={reviewPath} onChangeText={setReviewPath} placeholder="مسار الملف" placeholderTextColor={colors.mutedForeground} style={[styles.pathInput,{color:colors.foreground,borderColor:colors.border}]}/><TextInput value={reviewReason} onChangeText={setReviewReason} placeholder="سبب التعديل أو تعليقك" placeholderTextColor={colors.mutedForeground} style={[styles.pathInput,{color:colors.foreground,borderColor:colors.border}]}/><TextInput value={reviewProposed} onChangeText={setReviewProposed} multiline placeholder="الكود المقترح" placeholderTextColor={colors.mutedForeground} style={[styles.planInput,{color:colors.foreground,borderColor:colors.border}]}/><View style={{flexDirection:'row',gap:8}}><Pressable onPress={() => void submitReview()} style={[styles.actionButton,{backgroundColor:colors.primary}]}><Text style={{color:colors.primaryForeground,fontSize:12}}>إرسال للمراجعة</Text></Pressable><Pressable onPress={() => setReviewOpen(false)} style={[styles.actionButton,{borderColor:colors.border,borderWidth:1}]}><Text style={{color:colors.foreground,fontSize:12}}>إلغاء</Text></Pressable></View></View>:null}
    </View>
  );
}

const styles = StyleSheet.create({
  root:{flex:1,minHeight:0,paddingHorizontal:12,gap:8},
  header:{flexDirection:'row',alignItems:'center',gap:8,paddingTop:8},
  heading:{fontSize:20,fontWeight:'800'},
  smallButton:{minHeight:34,paddingHorizontal:10,borderWidth:1,borderRadius:9,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:6},
  sessionPicker:{gap:5},
  sessionChip:{paddingHorizontal:10,paddingVertical:6,borderWidth:1,borderRadius:9},
  body:{flex:1,minHeight:180,flexDirection:'row',gap:8},
  sidebar:{width:190,borderWidth:1,borderRadius:12,padding:8,gap:8},
  sidebarHead:{flexDirection:'row',alignItems:'center',gap:7},
  newFileRow:{flexDirection:'row',gap:5},
  pathInput:{flex:1,minHeight:34,borderWidth:1,borderRadius:8,paddingHorizontal:8,fontSize:12},
  iconButton:{width:34,height:34,borderRadius:8,alignItems:'center',justifyContent:'center'},
  treeRow:{minHeight:28,flexDirection:'row',alignItems:'center',gap:6,paddingVertical:5,paddingRight:5,borderRadius:6},
  empty:{fontSize:12,padding:8},
  exportButton:{minHeight:32,borderWidth:1,borderRadius:8,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:5},
  editor:{flex:1,minWidth:0,borderWidth:1,borderRadius:12,padding:8,gap:8},
  editorHead:{flexDirection:'row',alignItems:'center',borderBottomWidth:1,paddingBottom:8},
  headerIcon:{padding:8},
  codeInput:{flex:1,minHeight:100,fontFamily:'monospace',fontSize:12,lineHeight:18,borderWidth:1,borderRadius:8,padding:8},
  editorActions:{flexDirection:'row',flexWrap:'wrap',gap:6},
  actionButton:{minHeight:34,paddingHorizontal:10,borderRadius:8,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:5},
  timelinePanel:{borderWidth:1,borderRadius:12,padding:9,maxHeight:260},
  timelineTitle:{flexDirection:'row',alignItems:'center',gap:8,minHeight:30},
  planInput:{minHeight:54,maxHeight:110,borderWidth:1,borderRadius:8,padding:8,fontSize:12,marginTop:6,marginBottom:6},
  timelineRow:{flexDirection:'row',gap:10},
  timelineRail:{width:14,alignItems:'center'},
  dot:{width:10,height:10,borderRadius:5,marginTop:5},
  connector:{width:2,flex:1,minHeight:26,marginTop:3},
  timelineStepHead:{flexDirection:'row',alignItems:'center',gap:6},
  stepActions:{flexDirection:'row',gap:14,marginTop:5},
  reviewPanel:{borderWidth:1,borderRadius:12,padding:10,gap:7,maxHeight:260},
});
