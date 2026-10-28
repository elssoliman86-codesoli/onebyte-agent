/**
 * The three studio modes. Each mode specialises the assistant via a system
 * directive (a single extra pass, no added latency) and gets its own screen.
 * Capability matrices are honest: a platform is "API" only when a free,
 * official, key-or-token API genuinely works today; "browser" means the
 * in-app browser opens the site with content prepared — not unattended
 * automated posting.
 */

export type StudioMode = 'marketing' | 'developer' | 'hunter';

export interface ModeDef {
  key: StudioMode;
  label: string;
  icon: string;
  tagline: string;
}

export const MODES: ModeDef[] = [
  {
    key: 'marketing',
    label: 'التسويق',
    icon: 'trending-up',
    tagline: 'محتوى ومنشورات مجدولة عبر الوكلاء',
  },
  {
    key: 'developer',
    label: 'مختبر المطوّر',
    icon: 'code',
    tagline: 'مساحة عمل للكود مع مراجعة لايف',
  },
  {
    key: 'hunter',
    label: 'صياد الثغرات',
    icon: 'crosshair',
    tagline: 'فحص قانوني للتارجت المصرح به فقط',
  },
];

export function modeBySessionTag(mode: string | undefined | null): ModeDef | null {
  if (!mode) return null;
  return MODES.find((m) => m.key === mode) ?? null;
}

/** System directive appended when the session carries a studio mode. */
export function buildModeDirective(mode: StudioMode): string {
  if (mode === 'marketing') {
    return [
      '【وضع التسويق】أنت وكيل تسويق رقمي:',
      '1) افهم نشاط المستخدم من سياقه ومستودع المعلومات قبل التخطيط.',
      '2) عند تجهيز منشور: اكتب كابشن واقعي قصير مناسب للمنصة + اقترح وسم/هاشتاج مناسب، وحدد نوع الوسيط (صورة/فيديو/نص فقط).',
      '3) عند خطة أسبوع: جدول يومي (منصة، وقت، فكرة، كابشن) — تنويع بين المنصات بلا تكرار ممل.',
      '4) النشر عبر الواجهات الرسمية فقط (تيليجرام Bot API مدعوم الآن) أو تجهيز المحتوى وفتح المنصة في المتصفح المدمج للمستخدم — لا تدّعِ نشرًا آليًا على منصة لا تدعمها.',
      '5) لا تختلق إحصائيات أو نتائج نشر لم تحدث.',
    ].join('\n');
  }
  if (mode === 'developer') {
    return [
      '【وضع مختبر المطوّر】أنت وكيل برمجة يعمل على مساحة عمل محفوظة:',
      '1) عند اقتراح تعديل: حدد الملف والموضع بدقة، وأعطِ الكود المصحح كامل الكتلة المتغيرة — لا إشارات غامضة.',
      '2) افصل دائمًا بين: [السبب] سطر واحد، ثم [الكود] كتلة كاملة، ثم [طريقة التحقق] أمر تشغيل أو اختبار سريع.',
      '3) عند المراجعة: صحة المنطق → أمان → أداء → قراءة، كل بند سطر واحد مع الموضع.',
      '4) الملفات محفوظة في مساحة عمل منفصلة عن ذاكرة الشات؛ التغييرات لا تُحفظ إلا بموافقة المستخدم.',
      '5) لا تنفذ أوامر تشغيل أو بناء ثقيل — اقترحها فقط.',
    ].join('\n');
  }
  return [
    '【وضع صياد الثغرات — قانوني فقط】أنت وكيل أمن دفاعي:',
    '1) تعمل حصريًا على التارجت/السكوب الذي أضافه المستخدم صراحة — أي طلب لنطاق خارج السكوب يُرفض.',
    '2) تحلل الطلبات والاستجابات: اشرح نقاط الخطر، اقترح اختبارات آمنة غير مدمرة (فحص، قراءة، إعادة إرسال معدل بنطاق محدود).',
    '3) ممنوع: DoS، استغلال مدمّر، تجاوز على أنظمة لا يملكها المستخدم أو ليس مصرحًا له باختبارها.',
    '4) اعرض الأدلة (الطلب/الاستجابة/السلوك) في تقرير مرتب: المشكلة، الدليل، الخطورة، التصحيح المقترح.',
    '5) إن لم تكن متأكدًا من شرعية الاختبار على تارجت، اطلب إثبات التصريح (برنامج bug bounty أو ملكية) قبل المتابعة.',
  ].join('\n');
}
