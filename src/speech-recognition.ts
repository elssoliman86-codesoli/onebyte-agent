import { Platform, NativeModules } from 'react-native';

export interface SpeechRecognitionOptions {
  language?: string;
  maxResults?: number;
  partialResults?: boolean;
  prompt?: string;
}

const isAvailable = Platform.OS === 'android' && NativeModules.SpeechRecognition != null;

export const SpeechRecognition = {
  isAvailable: () => Promise.resolve(Platform.OS === 'android'),
  startListening: async (options?: {
    language?: string;
    maxResults?: number;
    partialResults?: boolean;
    prompt?: string;
  }) => {
    if (Platform.OS !== 'android') return [];
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
    if (Platform.OS !== 'android') return;
    const { SpeechRecognition } = require('react-native').NativeModules;
    if (SpeechRecognition) await SpeechRecognition.stopListening();
  },
  cancelListening: async () => {
    if (Platform.OS !== 'android') return;
    const { SpeechRecognition } = require('react-native').NativeModules;
    if (SpeechRecognition) await SpeechRecognition.cancelListening();
  },
  hasPermission: async () => {
    if (Platform.OS !== 'android') return false;
    const { SpeechRecognition } = require('react-native').NativeModules;
    if (!SpeechRecognition) return false;
    return SpeechRecognition.hasPermission();
  },
  requestPermission: async () => false,
};

export function isSpeechRecognitionAvailable(): boolean {
  return Platform.OS === 'android';
}