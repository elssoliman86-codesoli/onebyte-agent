/**
 * The response backend ("مهارة الرد") — settings-driven reply styling that
 * runs invisibly before any reply reaches the user. The raw model output is
 * produced with these directives already active (a single pass, no extra
 * model call), so it costs no latency: the "polish" happens by construction.
 */
export interface ResponseStyle {
  /** When the reply carries a short headline. */
  title: 'auto' | 'always' | 'never';
  /** When links are included. */
  links: 'needed' | 'always' | 'never';
  /** When a mermaid flow diagram is drawn. */
  diagram: 'ideas' | 'never';
  /** Markdown richness of the reply. */
  markdown: 'full' | 'light' | 'plain';
  /** Reply length bias. */
  length: 'short' | 'balanced' | 'detailed';
  /** Overall tone. */
  tone: 'friendly' | 'professional' | 'direct';
}

export const DEFAULT_RESPONSE_STYLE: ResponseStyle = {
  title: 'auto',
  links: 'needed',
  diagram: 'ideas',
  markdown: 'full',
  length: 'balanced',
  tone: 'friendly',
};

/** Merge partial/legacy stored settings onto the defaults (load-time tolerant). */
export function normalizeResponseStyle(raw: unknown): ResponseStyle {
  const input = (raw ?? {}) as Partial<ResponseStyle>;
  const pick = <T extends string>(
    value: unknown,
    allowed: readonly T[],
    fallback: T,
  ): T =>
    typeof value === 'string' && (allowed as readonly string[]).includes(value)
      ? (value as T)
      : fallback;
  return {
    title: pick(input.title, ['auto', 'always', 'never'] as const, DEFAULT_RESPONSE_STYLE.title),
    links: pick(input.links, ['needed', 'always', 'never'] as const, DEFAULT_RESPONSE_STYLE.links),
    diagram: pick(input.diagram, ['ideas', 'never'] as const, DEFAULT_RESPONSE_STYLE.diagram),
    markdown: pick(input.markdown, ['full', 'light', 'plain'] as const, DEFAULT_RESPONSE_STYLE.markdown),
    length: pick(input.length, ['short', 'balanced', 'detailed'] as const, DEFAULT_RESPONSE_STYLE.length),
    tone: pick(input.tone, ['friendly', 'professional', 'direct'] as const, DEFAULT_RESPONSE_STYLE.tone),
  };
}

/** Turn the stored style into the invisible system directive applied to every reply. */
export function buildResponseStyleDirective(style: ResponseStyle): string {
  const parts: string[] = [
    '【مهارة تنظيم الرد — إلزامية في كل إجابة】',
    '- ابدأ بالمعلومة أو النتيجة المطلوبة مباشرة. لا تكتب مقدمة عن أنك ستساعد أو أنك فهمت الطلب.',
    '- نظّم بصريًا: فقرات قصيرة، عنوان رئيسي عند تعدد الأقسام فقط، ونقاط متوازية عند وجود عدة عناصر. لا تحول كل جملة إلى عنوان أو قائمة.',
    '- استخدم جدولًا فقط للمقارنة بين عناصر متعددة لها نفس الخصائص؛ لا تستخدم جدولًا للشرح البسيط. لا تكثر الرموز التعبيرية أو الزخرفة.',
    '- في المهام التنفيذية، افصل بوضوح بين ما تم تنفيذه فعلًا، وما فشل، وما يحتاج إذنًا أو إعدادًا. لا تدّعِ النجاح دون نتيجة مؤكدة.',
    '- لا تكرر الطلب ولا تعِد صياغته بلا فائدة. تجنب الحشو والتكرار والخاتمة المصطنعة.',
  ];
  parts.push(
    style.title === 'always'
      ? '- ابدأ كل رد بعنوان قصير واضح بين قوسين **عنوان:**.'
      : style.title === 'never'
        ? '- لا تستخدم عناوين نهائيًا؛ ردك سطور متصلة مباشرة.'
        : '- ضع عنوانًا قصيرًا فقط عندما يكون الرد متعدد الأقسام؛ الردود القصيرة تدخل في الموضوع مباشرة.',
  );
  parts.push(
    style.links === 'always'
      ? '- ارفق رابط مصدر أو مرجع في كل رد فيه معلومة خارجية، وسطر واحد يشرحه.'
      : style.links === 'never'
        ? '- لا تدرج روابط في الرد إطلاقًا؛ اذكر المصدر باسمه نصًا فقط.'
        : '- أضف رابطًا فقط عندما يكون المصدر أو خطوة تفعيل حقيقية تحتاجها.',
  );
  parts.push(
    style.diagram === 'never'
      ? '- لا ترسم دياجرامات؛ اشرح التدفق بنقاط نصية.'
      : '- عند شرح تدفق أو بنية أو تسلسل أفكار، أرفق كتلة ```mermaid قصيرة توضح الفكرة؛ الفكرة البسيطة تُشرح نصًا.',
  );
  parts.push(
    style.markdown === 'full'
      ? '- استخدم الماركداون كاملًا: عناوين ونقاط و**عريض** و`كود` وكتل كود.'
      : style.markdown === 'light'
        ? '- ماركداون خفيف فقط: نقاط وعريض، بلا عناوين متعددة المستويات.'
        : '- بدون ماركداون: نص عادي بسطور قصيرة، والكود داخل كتلة واحدة فقط عند الضرورة.',
  );
  parts.push(
    style.length === 'short'
      ? '- طول الرد: مقتضب — 3–6 سطور للسؤال العادي، بلا أي حشو.'
      : style.length === 'detailed'
        ? '- طول الرد: مفصل — غطِ التفاصيل والحواف والبدائل مع الحفاظ على الترتيب.'
        : '- طول الرد: متوازن — ما يكفي لإتمام المهمة بدون سرد زائد.',
  );
  parts.push(
    style.tone === 'friendly'
      ? '- النبرة: ودودة قريبة، بلا مبالغة.'
      : style.tone === 'professional'
        ? '- النبرة: مهنية محايدة.'
        : '- النبرة: مباشرة إلى النقطة.',
  );
  return parts.join('\n');
}

/** Arabic labels for the settings UI. */
export const RESPONSE_STYLE_LABELS: Record<keyof ResponseStyle, Record<string, string>> = {
  title: { auto: 'عند الحاجة', always: 'دائمًا', never: 'أبدًا' },
  links: { needed: 'عند الحاجة', always: 'دائمًا', never: 'أبدًا' },
  diagram: { ideas: 'عند الأفكار والتدفقات', never: 'أبدًا' },
  markdown: { full: 'كامل', light: 'خفيف', plain: 'نص عادي' },
  length: { short: 'مختصر', balanced: 'متوازن', detailed: 'مفصل' },
  tone: { friendly: 'ودود', professional: 'مهني', direct: 'مباشر' },
};
