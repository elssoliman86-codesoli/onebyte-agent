import { SpeechRecognition } from './speech-recognition';
import * as Speech from 'expo-speech';

export interface SpeechServiceInterface {
  startListening(options?: {
    language?: string;
    maxResults?: number;
    partialResults?: boolean;
    prompt?: string;
  }): Promise<string[]>;
  stopListening(): Promise<void>;
  cancelListening(): Promise<void>;
  speak(text: string, options?: { language?: string; pitch?: number; rate?: number }): Promise<void>;
  stopSpeaking(): Promise<void>;
  pauseSpeaking(): Promise<void>;
  resumeSpeaking(): Promise<void>;
  getIsListening(): boolean;
  getIsSpeaking(): boolean;
  getCurrentUtterance(): string;
}

class SpeechService {
  private isListening = false;
  private isSpeaking = false;
  private currentUtterance = '';

  async startListening(options?: {
    language?: string;
    maxResults?: number;
    partialResults?: boolean;
    prompt?: string;
  }): Promise<string[]> {
    if (!(await SpeechRecognition.isAvailable())) {
      throw new Error('Speech recognition not available');
    }
    this.isListening = true;
    try {
      return await SpeechRecognition.startListening({
        language: options?.language ?? 'ar-SA',
        maxResults: options?.maxResults ?? 1,
        partialResults: options?.partialResults ?? true,
        prompt: options?.prompt ?? 'تحدث الآن...',
      });
    } catch (error) {
      this.isListening = false;
      throw error;
    }
  }

  async stopListening(): Promise<void> {
    await SpeechRecognition.stopListening();
    this.isListening = false;
  }

  async cancelListening(): Promise<void> {
    await SpeechRecognition.cancelListening();
    this.isListening = false;
  }

  async speak(text: string, options?: { language?: string; pitch?: number; rate?: number }): Promise<void> {
    this.isSpeaking = true;
    this.currentUtterance = text;
    return new Promise<void>((resolve, reject) => {
      Speech.speak(text, {
        language: options?.language ?? 'ar-SA',
        pitch: options?.pitch ?? 1.0,
        rate: options?.rate ?? 1.0,
        onDone: () => {
          this.isSpeaking = false;
          this.currentUtterance = '';
          resolve();
        },
        onError: (error: Error) => {
          this.isSpeaking = false;
          this.currentUtterance = '';
          reject(error);
        },
      });
    });
  }

  async stopSpeaking(): Promise<void> {
    await Speech.stop();
    this.isSpeaking = false;
    this.currentUtterance = '';
  }

  async pauseSpeaking(): Promise<void> {
    await Speech.pause();
  }

  async resumeSpeaking(): Promise<void> {
    await Speech.resume();
  }

  getIsListening(): boolean {
    return this.isListening;
  }

  getIsSpeaking(): boolean {
    return this.isSpeaking;
  }

  getCurrentUtterance(): string {
    return this.currentUtterance;
  }
}

export const speechService = new SpeechService();
