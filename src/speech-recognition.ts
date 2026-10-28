import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';

export interface SpeechRecognitionOptions {
  language?: string;
  maxResults?: number;
  partialResults?: boolean;
  prompt?: string;
}

const isAvailableNative = Platform.OS === 'android';

interface NativeSpeechRecognition {
  isAvailable(): Promise<boolean>;
  startListening(language: string, maxResults: number, partialResults: boolean, prompt: string): Promise<string[]>;
  stopListening(): Promise<void>;
  cancelListening(): Promise<void>;
  hasPermission(): Promise<boolean>;
  requestPermission(): Promise<boolean>;
}

const native = isAvailableNative
  ? requireOptionalNativeModule<NativeSpeechRecognition>('SpeechRecognition')
  : null;

function hasWebSpeechApi(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as Record<string, unknown>;
  return Boolean(w.SpeechRecognition ?? w.webkitSpeechRecognition);
}

export const SpeechRecognition = {
  isAvailable: async () =>
    Platform.OS === 'web' ? hasWebSpeechApi() : Boolean(native && (await native.isAvailable())),
  startListening: async (options?: {
    language?: string;
    maxResults?: number;
    partialResults?: boolean;
    prompt?: string;
  }): Promise<string[]> => {
    if (Platform.OS === 'web') {
      return new Promise((resolve, reject) => {
        const w = window as unknown as Record<string, unknown>;
        const SR =
          (w.SpeechRecognition ?? w.webkitSpeechRecognition) as
            | (new () => {
                lang: string;
                interimResults: boolean;
                continuous: boolean;
                onresult: (event: {
                  resultIndex: number;
                  results: {
                    isFinal: boolean;
                    0?: { transcript?: string };
                  }[];
                }) => void;
                onend: () => void;
                onerror: () => void;
                start: () => void;
                stop: () => void;
              })
            | undefined;
        if (!SR) {
          reject(new Error('المتصفح لا يدعم الإدخال الصوتي.'));
          return;
        }
        const rec = new SR();
        rec.lang = options?.language ?? 'ar-SA';
        rec.interimResults = Boolean(options?.partialResults);
        rec.continuous = false;
        let finalText = '';
        rec.onresult = (event) => {
          for (let i = event.resultIndex; i < event.results.length; i += 1) {
            const chunk = event.results[i]?.[0]?.transcript ?? '';
            if (event.results[i]?.isFinal) finalText += chunk;
          }
        };
        rec.onend = () => resolve(finalText ? [finalText] : []);
        rec.onerror = () => reject(new Error('تعذّر الوصول للميكروفون.'));
        try {
          rec.start();
        } catch (error) {
          reject(error instanceof Error ? error : new Error('تعذّر بدء الميكروفون.'));
        }
      });
    }
    if (!native) throw new Error('خدمة التعرف على الصوت غير موجودة في هذه النسخة.');
    const granted = (await native.hasPermission()) || (await native.requestPermission());
    if (!granted) throw new Error('لم يتم السماح باستخدام الميكروفون.');
    return native.startListening(
      options?.language ?? 'ar-SA',
      options?.maxResults ?? 1,
      options?.partialResults ?? false,
      options?.prompt ?? 'تحدث الآن...',
    );
  },
  stopListening: async () => {
    if (Platform.OS === 'web') return;
    await native?.stopListening();
  },
  cancelListening: async () => {
    if (Platform.OS === 'web') return;
    await native?.cancelListening();
  },
  hasPermission: async () => {
    if (!isAvailableNative) return Platform.OS === 'web';
    return native ? native.hasPermission() : false;
  },
  requestPermission: async () => {
    if (Platform.OS === 'web') return hasWebSpeechApi();
    return native ? native.requestPermission() : false;
  },
};

export function isSpeechRecognitionAvailable(): boolean {
  return isAvailableNative ? native !== null : Platform.OS === 'web' && hasWebSpeechApi();
}
