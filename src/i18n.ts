import { useAssistant } from './assistant';

/**
 * App language support. Two layers, both real:
 * 1) UI strings for the core chat surface (composer, drawer, message actions,
 *    attach menu, thinking, queue) — translated dictionaries.
 * 2) The model's reply language — injected into the system prompt so the
 *    assistant itself answers in the chosen language.
 * Screens beyond the chat core keep their Arabic copy and migrate
 * progressively; the assistant's reply language applies everywhere.
 */
export interface LanguageDef {
  code: string;
  label: string;
  /** Native name shown in the picker. */
  native: string;
  dir: 'rtl' | 'ltr';
  /** Name passed to the model, in the language itself. */
  modelLanguage: string;
}

export const LANGUAGES: LanguageDef[] = [
  { code: 'ar', label: 'العربية', native: 'العربية', dir: 'rtl', modelLanguage: 'العربية' },
  { code: 'en', label: 'English', native: 'English', dir: 'ltr', modelLanguage: 'English' },
  { code: 'fr', label: 'French', native: 'Français', dir: 'ltr', modelLanguage: 'French (Français)' },
  { code: 'es', label: 'Spanish', native: 'Español', dir: 'ltr', modelLanguage: 'Spanish (Español)' },
  { code: 'de', label: 'German', native: 'Deutsch', dir: 'ltr', modelLanguage: 'German (Deutsch)' },
  { code: 'tr', label: 'Turkish', native: 'Türkçe', dir: 'ltr', modelLanguage: 'Turkish (Türkçe)' },
  { code: 'pt', label: 'Portuguese', native: 'Português', dir: 'ltr', modelLanguage: 'Portuguese (Português)' },
  { code: 'it', label: 'Italian', native: 'Italiano', dir: 'ltr', modelLanguage: 'Italian (Italiano)' },
  { code: 'ru', label: 'Russian', native: 'Русский', dir: 'ltr', modelLanguage: 'Russian (Русский)' },
  { code: 'hi', label: 'Hindi', native: 'हिन्दी', dir: 'ltr', modelLanguage: 'Hindi (हिन्दी)' },
  { code: 'ur', label: 'Urdu', native: 'اردو', dir: 'rtl', modelLanguage: 'Urdu (اردو)' },
  { code: 'fa', label: 'Persian', native: 'فارسی', dir: 'rtl', modelLanguage: 'Persian (فارسی)' },
  { code: 'zh', label: 'Chinese', native: '中文', dir: 'ltr', modelLanguage: 'Simplified Chinese (简体中文)' },
  { code: 'ja', label: 'Japanese', native: '日本語', dir: 'ltr', modelLanguage: 'Japanese (日本語)' },
  { code: 'ko', label: 'Korean', native: '한국어', dir: 'ltr', modelLanguage: 'Korean (한국어)' },
];

/** Core chat-surface keys (translated per language, Arabic fallback for gaps). */
export type UiKey =
  | 'send'
  | 'stop'
  | 'thinking'
  | 'showThinking'
  | 'hideThinking'
  | 'attach'
  | 'attachImage'
  | 'attachFiles'
  | 'attachZip'
  | 'editResend'
  | 'copy'
  | 'copied'
  | 'listen'
  | 'stopListen'
  | 'shareDraft'
  | 'modelInUse'
  | 'queued'
  | 'remove'
  | 'chats'
  | 'tasks'
  | 'skills'
  | 'memory'
  | 'approvals'
  | 'settings'
  | 'recentChats'
  | 'preview'
  | 'expand'
  | 'collapse';

type Dict = Partial<Record<UiKey, string>>;

const ar: Dict = {
  send: 'إرسال الرسالة', stop: 'إيقاف المهمة', thinking: 'يفكر…',
  showThinking: 'عرض التفكير', hideThinking: 'إخفاء التفكير',
  attach: 'إرفاق', attachImage: 'صورة', attachFiles: 'ملفات', attachZip: 'أرشيف ZIP',
  editResend: 'تعديل وإعادة إرسال', copy: 'نسخ', copied: 'تم النسخ',
  listen: 'استماع للرد', stopListen: 'إيقاف الاستماع', shareDraft: 'مشاركة المسودة',
  modelInUse: 'الموديل المستخدم', queued: 'في الطابور', remove: 'إزالة',
  chats: 'الشات', tasks: 'المهام', skills: 'المهارات', memory: 'الذاكرة',
  approvals: 'الموافقات', settings: 'الإعدادات', recentChats: 'المحادثات الأخيرة',
  preview: 'معاينة', expand: 'توسيع', collapse: 'تصغير',
};

const en: Dict = {
  send: 'Send message', stop: 'Stop run', thinking: 'Thinking…',
  showThinking: 'Show thinking', hideThinking: 'Hide thinking',
  attach: 'Attach', attachImage: 'Photo', attachFiles: 'Files', attachZip: 'ZIP archive',
  editResend: 'Edit & resend', copy: 'Copy', copied: 'Copied',
  listen: 'Listen to reply', stopListen: 'Stop listening', shareDraft: 'Share draft',
  modelInUse: 'Model in use', queued: 'Queued', remove: 'Remove',
  chats: 'Chat', tasks: 'Tasks', skills: 'Skills', memory: 'Memory',
  approvals: 'Approvals', settings: 'Settings', recentChats: 'Recent chats',
  preview: 'Preview', expand: 'Expand', collapse: 'Collapse',
};

const fr: Dict = {
  send: 'Envoyer', stop: 'Arrêter', thinking: 'Réflexion…',
  showThinking: 'Voir la réflexion', hideThinking: 'Masquer',
  attach: 'Joindre', attachImage: 'Photo', attachFiles: 'Fichiers', attachZip: 'Archive ZIP',
  editResend: 'Modifier et renvoyer', copy: 'Copier', copied: 'Copié',
  listen: 'Écouter la réponse', stopListen: 'Arrêter', shareDraft: 'Partager',
  modelInUse: 'Modèle utilisé', queued: 'En file', remove: 'Retirer',
  chats: 'Chat', tasks: 'Tâches', skills: 'Compétences', memory: 'Mémoire',
  approvals: 'Approbations', settings: 'Réglages', recentChats: 'Chats récents',
  preview: 'Aperçu', expand: 'Agrandir', collapse: 'Réduire',
};

const es: Dict = {
  send: 'Enviar', stop: 'Detener', thinking: 'Pensando…',
  showThinking: 'Ver razonamiento', hideThinking: 'Ocultar',
  attach: 'Adjuntar', attachImage: 'Foto', attachFiles: 'Archivos', attachZip: 'Archivo ZIP',
  editResend: 'Editar y reenviar', copy: 'Copiar', copied: 'Copiado',
  listen: 'Escuchar respuesta', stopListen: 'Detener', shareDraft: 'Compartir',
  modelInUse: 'Modelo en uso', queued: 'En cola', remove: 'Quitar',
  chats: 'Chat', tasks: 'Tareas', skills: 'Habilidades', memory: 'Memoria',
  approvals: 'Aprobaciones', settings: 'Ajustes', recentChats: 'Chats recientes',
  preview: 'Vista previa', expand: 'Expandir', collapse: 'Contraer',
};

const de: Dict = {
  send: 'Senden', stop: 'Stopp', thinking: 'Denkt…',
  showThinking: 'Gedanken zeigen', hideThinking: 'Ausblenden',
  attach: 'Anhängen', attachImage: 'Foto', attachFiles: 'Dateien', attachZip: 'ZIP-Archiv',
  editResend: 'Ändern und erneut senden', copy: 'Kopieren', copied: 'Kopiert',
  listen: 'Antwort anhören', stopListen: 'Stopp', shareDraft: 'Teilen',
  modelInUse: 'Aktives Modell', queued: 'In Warteschlange', remove: 'Entfernen',
  chats: 'Chat', tasks: 'Aufgaben', skills: 'Fähigkeiten', memory: 'Gedächtnis',
  approvals: 'Freigaben', settings: 'Einstellungen', recentChats: 'Neueste Chats',
  preview: 'Vorschau', expand: 'Vergrößern', collapse: 'Verkleinern',
};

const tr: Dict = {
  send: 'Gönder', stop: 'Durdur', thinking: 'Düşünüyor…',
  showThinking: 'Düşünceyi göster', hideThinking: 'Gizle',
  attach: 'Ekle', attachImage: 'Fotoğraf', attachFiles: 'Dosyalar', attachZip: 'ZIP arşivi',
  editResend: 'Düzenle ve yeniden gönder', copy: 'Kopyala', copied: 'Kopyalandı',
  listen: 'Yanıtı dinle', stopListen: 'Durdur', shareDraft: 'Paylaş',
  modelInUse: 'Kullanılan model', queued: 'Sırada', remove: 'Kaldır',
  chats: 'Sohbet', tasks: 'Görevler', skills: 'Yetenekler', memory: 'Hafıza',
  approvals: 'Onaylar', settings: 'Ayarlar', recentChats: 'Son sohbetler',
  preview: 'Önizleme', expand: 'Büyüt', collapse: 'Küçült',
};

const ru: Dict = {
  send: 'Отправить', stop: 'Стоп', thinking: 'Думает…',
  showThinking: 'Показать размышления', hideThinking: 'Скрыть',
  attach: 'Прикрепить', attachImage: 'Фото', attachFiles: 'Файлы', attachZip: 'ZIP-архив',
  editResend: 'Изменить и отправить', copy: 'Копировать', copied: 'Скопировано',
  listen: 'Прослушать ответ', stopListen: 'Стоп', shareDraft: 'Поделиться',
  modelInUse: 'Используемая модель', queued: 'В очереди', remove: 'Убрать',
  chats: 'Чат', tasks: 'Задачи', skills: 'Навыки', memory: 'Память',
  approvals: 'Одобрения', settings: 'Настройки', recentChats: 'Последние чаты',
  preview: 'Просмотр', expand: 'Развернуть', collapse: 'Свернуть',
};

const zh: Dict = {
  send: '发送', stop: '停止', thinking: '思考中…',
  showThinking: '显示思考', hideThinking: '隐藏',
  attach: '附件', attachImage: '图片', attachFiles: '文件', attachZip: 'ZIP 压缩包',
  editResend: '编辑并重发', copy: '复制', copied: '已复制',
  listen: '朗读回复', stopListen: '停止朗读', shareDraft: '分享',
  modelInUse: '当前模型', queued: '排队中', remove: '移除',
  chats: '聊天', tasks: '任务', skills: '技能', memory: '记忆',
  approvals: '审批', settings: '设置', recentChats: '最近聊天',
  preview: '预览', expand: '展开', collapse: '收起',
};

const DICTS: Record<string, Dict> = { ar, en, fr, es, de, tr, ru, zh };

export function languageByCode(code: string | undefined): LanguageDef {
  return LANGUAGES.find((l) => l.code === code) ?? LANGUAGES[0];
}

/** Translate a core UI key for the active language (Arabic fallback). */
export function ui(langCode: string | undefined, key: UiKey): string {
  const dict = DICTS[languageByCode(langCode).code] ?? ar;
  return dict[key] ?? ar[key] ?? key;
}

/** Hook: returns a t() bound to the user's chosen language. */
export function useT() {
  let lang = 'ar';
  try {
    lang = useAssistant().appearance?.language ?? 'ar';
  } catch {
    // outside provider
  }
  return (key: UiKey) => ui(lang, key);
}
