import { Platform } from 'react-native';

export interface SpeechRecognitionOptions {
  language?: string;
  maxResults?: number;
  partialResults?: boolean;
  prompt?: string;
}

const isAvailableNative = Platform.OS === 'android';

export const SpeechRecognition = {
  isAvailable: () => Promise.resolve(isAvailableNative || Platform.OS === 'web'),
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
    if (!isAvailableNative) return [];
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { SpeechRecognition } = require('react-native').NativeModules;
    if (!SpeechRecognition) return [];
    return SpeechRecognition.startListening({
      language: options?.language,
      maxResults: options?.maxResults,
      partialResults: options?.partialResults,
      prompt: options?.prompt,
    });
  },
  stopListening: async () => {
    if (Platform.OS === 'web') return;
    if (!isAvailableNative) return;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { SpeechRecognition } = require('react-native').NativeModules;
    if (SpeechRecognition) await SpeechRecognition.stopListening();
  },
  cancelListening: async () => {
    if (Platform.OS === 'web') return;
    if (!isAvailableNative) return;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { SpeechRecognition } = require('react-native').NativeModules;
    if (SpeechRecognition) await SpeechRecognition.cancelListening();
  },
  hasPermission: async () => {
    if (!isAvailableNative) return Platform.OS === 'web';
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { SpeechRecognition } = require('react-native').NativeModules;
    if (!SpeechRecognition) return false;
    return SpeechRecognition.hasPermission();
  },
  requestPermission: async () => Platform.OS === 'web',
};

export function isSpeechRecognitionAvailable(): boolean {
  return isAvailableNative || Platform.OS === 'web';
}
