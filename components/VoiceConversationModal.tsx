import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import { speechService } from '@/src/speech-service';

type VoiceState = 'ready' | 'listening' | 'thinking' | 'speaking' | 'error';

interface VoiceConversationModalProps {
  visible: boolean;
  language: string;
  modelLabel?: string;
  onClose: () => void;
  onSend: (text: string) => Promise<string>;
  onStop: () => void;
  onUseKeyboard: (transcript: string) => void;
}

function speechLocale(language: string): string {
  if (language === 'ar') return 'ar-SA';
  if (language === 'en') return 'en-US';
  return language || 'ar-SA';
}

export function VoiceConversationModal({
  visible,
  language,
  modelLabel,
  onClose,
  onSend,
  onStop,
  onUseKeyboard,
}: VoiceConversationModalProps) {
  const [state, setState] = useState<VoiceState>('ready');
  const [transcript, setTranscript] = useState('');
  const [reply, setReply] = useState('');
  const [error, setError] = useState('');
  const pulse = useRef(new Animated.Value(0)).current;
  const turnActive = useRef(false);
  const visibleRef = useRef(visible);
  const sendRef = useRef(onSend);
  const stopRef = useRef(onStop);
  const cancelledRef = useRef(false);

  visibleRef.current = visible;
  sendRef.current = onSend;
  stopRef.current = onStop;

  const startTurn = useCallback(async () => {
    if (turnActive.current || !visibleRef.current) return;
    turnActive.current = true;
    cancelledRef.current = false;
    setError('');
    setState('listening');
    try {
      let spoken = (await speechService.startListening({
        language: speechLocale(language),
        maxResults: 1,
        partialResults: false,
        prompt: 'تحدث الآن',
      }) ?? []).join(' ').trim();

      while (visibleRef.current && !cancelledRef.current && spoken) {
        setTranscript(spoken);
        setState('thinking');
        const answer = await sendRef.current(spoken);
        if (!visibleRef.current || cancelledRef.current) return;
        if (!answer.trim()) {
          setError('لم يصل رد من الموديل. راجع الاتصال أو إعدادات الموديل ثم حاول مرة أخرى.');
          setState('error');
          return;
        }
        setReply(answer.trim());
        setState('speaking');

        // Listen while TTS is speaking so the user can interrupt naturally.
        // A transcript that substantially matches the assistant reply is treated as speaker echo.
        const speechPromise = speechService.speak(answer, {
          language: speechLocale(language),
          rate: 0.96,
        }).then(() => ({ kind: 'speech' as const }), (error: unknown) => ({ kind: 'speech-error' as const, error }));
        const listenPromise = speechService.startListening({
          language: speechLocale(language),
          maxResults: 1,
          partialResults: false,
          prompt: 'يمكنك المقاطعة والتحدث',
        }).then(
          (results) => ({ kind: 'heard' as const, text: (results ?? []).join(' ').trim() }),
          () => ({ kind: 'listen-error' as const }),
        );

        const duringReply = await Promise.race([speechPromise, listenPromise]);
        if (!visibleRef.current || cancelledRef.current) {
          await speechService.cancelListening().catch(() => undefined);
          await speechService.stopSpeaking().catch(() => undefined);
          return;
        }

        if (duringReply.kind === 'heard' && duringReply.text) {
          const normalize = (value: string) => value.toLocaleLowerCase()
            .replace(/[^\p{L}\p{N}\s]/gu, ' ')
            .split(/\s+/).filter((word) => word.length > 1);
          const heardWords = new Set(normalize(duringReply.text));
          const replyWords = normalize(answer);
          const overlap = replyWords.length
            ? replyWords.filter((word) => heardWords.has(word)).length / Math.max(1, heardWords.length)
            : 0;
          if (overlap < 0.62 && heardWords.size >= 2) {
            // Genuine user speech interrupts TTS and becomes the next turn.
            await speechService.stopSpeaking().catch(() => undefined);
            spoken = duringReply.text;
            continue;
          }
        }

        // TTS ended or recognition was only an echo/noise: stop the parallel recognizer,
        // wait for TTS cleanup, then return to the normal always-listening loop.
        await speechService.cancelListening().catch(() => undefined);
        await speechPromise;
        spoken = '';
      }

      if (!visibleRef.current || cancelledRef.current) return;
      setError('لم أسمع كلامًا واضحًا. سأعيد الاستماع تلقائيًا.');
      setState('ready');
    } catch (cause) {
      if (!visibleRef.current || cancelledRef.current) return;
      const message = cause instanceof Error ? cause.message : '';
      setError(
        /permission|إذن|السماح/i.test(message)
          ? 'اسمح للتطبيق باستخدام الميكروفون من إعدادات Android.'
          : /speech timeout|no speech|no recognition results/i.test(message)
            ? 'لم أسمع كلامًا واضحًا. سأعيد الاستماع تلقائيًا.'
            : message || 'تعذّر بدء المحادثة الصوتية. سأحاول الاستماع مرة أخرى.',
      );
      setState('error');
    } finally {
      turnActive.current = false;
      if (visibleRef.current) {
        // A stop button cancels only the current turn, not the voice session.
        cancelledRef.current = false;
        setState((current) => current === 'error' ? 'error' : 'ready');
        setTimeout(() => {
          if (visibleRef.current && !turnActive.current && !cancelledRef.current) {
            void startTurnRef.current();
          }
        }, 350);
      }
    }
  }, [language]);

  const startTurnRef = useRef(startTurn);
  startTurnRef.current = startTurn;

  useEffect(() => {
    if (!visible) {
      visibleRef.current = false;
      void speechService.cancelListening().catch(() => undefined);
      void speechService.stopSpeaking().catch(() => undefined);
      cancelledRef.current = true;
      turnActive.current = false;
      return;
    }

    visibleRef.current = true;
    cancelledRef.current = false;
    setTranscript('');
    setReply('');
    setError('');
    const timer = setTimeout(() => void startTurnRef.current(), 350);
    return () => clearTimeout(timer);
  }, [visible]);

  useEffect(() => {
    if (state !== 'listening' && state !== 'speaking') {
      pulse.stopAnimation();
      pulse.setValue(0);
      return;
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: state === 'listening' ? 1100 : 1500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: state === 'listening' ? 1100 : 1500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [pulse, state]);

  function handleMainButton() {
    if (state === 'listening') {
      void speechService.stopListening().catch(() => undefined);
      return;
    }
    if (state === 'speaking') {
      cancelledRef.current = false;
      void speechService.stopSpeaking().finally(() => {
        if (visibleRef.current) setState('ready');
      });
      return;
    }
    if (state === 'thinking') {
      cancelledRef.current = true;
      stopRef.current();
      void speechService.cancelListening().catch(() => undefined);
      void speechService.stopSpeaking().catch(() => undefined);
      setState('ready');
      return;
    }
    if (state === 'ready' || state === 'error') void startTurnRef.current();
  }

  const stateLabel =
    state === 'listening'
      ? 'أستمع إليك…'
      : state === 'thinking'
        ? 'أجهّز الرد…'
        : state === 'speaking'
          ? 'المساعد يتحدث…'
          : error || 'أنا سامعك… اتكلم بشكل طبيعي';
  const orbScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.075] });
  const ringOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.2, 0.72] });

  return (
    <Modal
      visible={visible}
      animationType="fade"
      presentationStyle="fullScreen"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View pointerEvents="none" style={styles.glowTop} />
        <View pointerEvents="none" style={styles.glowBottom} />

        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="إغلاق المحادثة الصوتية"
            onPress={onClose}
            style={styles.headerButton}
          >
            <Feather name="x" size={19} color="#D4E2D9" />
          </Pressable>
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>ONEBYTE · VOICE</Text>
            <Text style={styles.headerTitle}>محادثة صوتية</Text>
          </View>
          <View style={styles.headerButton}>
            <Feather name="activity" size={18} color="#00D977" />
          </View>
        </View>

        <Text style={styles.stateLabel}>{stateLabel}</Text>
        {modelLabel ? (
          <Text style={styles.modelLabel} numberOfLines={1}>{modelLabel}</Text>
        ) : null}

        <View style={styles.orbStage}>
          <Animated.View
            style={[
              styles.pulseRing,
              { opacity: ringOpacity, transform: [{ scale: orbScale }] },
            ]}
          />
          <Animated.View style={{ transform: [{ scale: orbScale }] }}>
            <Svg width={236} height={236} viewBox="0 0 236 236">
              <Defs>
                <RadialGradient id="voiceOrb" cx="34%" cy="27%" rx="76%" ry="76%">
                  <Stop offset="0%" stopColor="#9AFFDC" />
                  <Stop offset="22%" stopColor="#00E58A" />
                  <Stop offset="60%" stopColor="#05794C" />
                  <Stop offset="100%" stopColor="#02160F" />
                </RadialGradient>
                <RadialGradient id="orbShine" cx="28%" cy="22%" rx="60%" ry="58%">
                  <Stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.78" />
                  <Stop offset="100%" stopColor="#7BFFE0" stopOpacity="0" />
                </RadialGradient>
              </Defs>
              <Circle cx="118" cy="118" r="102" fill="#00D977" opacity="0.12" />
              <Circle cx="118" cy="118" r="94" fill="url(#voiceOrb)" />
              <Circle cx="91" cy="81" r="49" fill="url(#orbShine)" />
              <Circle cx="118" cy="118" r="94" fill="none" stroke="#69FFC6" strokeOpacity="0.25" strokeWidth="1.2" />
            </Svg>
          </Animated.View>
          <View style={styles.orbIcon}>
            <Feather
              name={state === 'speaking' ? 'volume-2' : state === 'thinking' ? 'cpu' : 'mic'}
              size={28}
              color="#03190F"
            />
          </View>
        </View>

        <ScrollView
          style={styles.transcriptArea}
          contentContainerStyle={styles.transcriptContent}
          showsVerticalScrollIndicator={false}
        >
          {transcript ? (
            <View style={styles.transcriptCard}>
              <Text style={styles.transcriptLabel}>أنت</Text>
              <Text style={styles.transcriptText}>{transcript}</Text>
            </View>
          ) : null}
          {reply ? (
            <View style={[styles.transcriptCard, styles.replyCard]}>
              <Text style={styles.replyLabel}>OneByte</Text>
              <Text style={styles.transcriptText}>{reply}</Text>
            </View>
          ) : null}
        </ScrollView>

        <View style={styles.controls}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="استخدام لوحة المفاتيح"
            onPress={() => onUseKeyboard(transcript)}
            style={styles.sideButton}
          >
            <Feather name="edit-3" size={18} color="#B8C9BF" />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={state === 'listening' ? 'إنهاء الاستماع' : state === 'thinking' ? 'إيقاف الطلب' : state === 'speaking' ? 'مقاطعة الرد الصوتي' : 'بدء الاستماع'}
            onPress={handleMainButton}
            style={({ pressed }) => [
              styles.micButton,
              state === 'thinking' && styles.micButtonDisabled,
              pressed && state !== 'thinking' && styles.micButtonPressed,
            ]}
          >
            <Feather
              name={state === 'listening' ? 'square' : state === 'speaking' ? 'volume-x' : state === 'thinking' ? 'square' : 'mic'}
              size={24}
              color="#04140D"
            />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="إغلاق المحادثة الصوتية"
            onPress={onClose}
            style={styles.sideButton}
          >
            <Feather name="x" size={19} color="#B8C9BF" />
          </Pressable>
        </View>
        <Text style={styles.footer}>تقدر تتكلم في أي وقت أو تقاطع الرد — الإغلاق يدوي</Text>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#030907', paddingHorizontal: 24 },
  glowTop: { position: 'absolute', top: -160, left: -60, width: 330, height: 330, borderRadius: 165, backgroundColor: '#00B965', opacity: 0.14 },
  glowBottom: { position: 'absolute', bottom: -220, right: -90, width: 390, height: 390, borderRadius: 195, backgroundColor: '#007D4A', opacity: 0.16 },
  header: { minHeight: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerButton: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(201,227,210,0.16)', backgroundColor: 'rgba(12,29,21,0.75)' },
  headerCopy: { alignItems: 'center', gap: 3 },
  eyebrow: { color: '#00D977', fontSize: 9, letterSpacing: 1.4, fontWeight: '700' },
  headerTitle: { color: '#F3F7F4', fontSize: 16, fontWeight: '600' },
  stateLabel: { color: '#E3EEE7', textAlign: 'center', fontSize: 17, fontWeight: '500', marginTop: 28 },
  modelLabel: { color: '#718078', fontSize: 11, textAlign: 'center', marginTop: 7, paddingHorizontal: 16 },
  orbStage: { alignSelf: 'center', width: 280, height: 300, alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  pulseRing: { position: 'absolute', width: 250, height: 250, borderRadius: 125, borderWidth: 1, borderColor: '#00D977', backgroundColor: 'rgba(0,217,119,0.06)' },
  orbIcon: { position: 'absolute', width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(157,255,216,0.78)' },
  transcriptArea: { flex: 1, minHeight: 70, maxHeight: 235, marginTop: 4 },
  transcriptContent: { gap: 10, paddingVertical: 6 },
  transcriptCard: { alignSelf: 'stretch', borderRadius: 18, borderWidth: 1, borderColor: 'rgba(178,214,192,0.12)', paddingHorizontal: 15, paddingVertical: 12, backgroundColor: 'rgba(14,25,19,0.76)' },
  replyCard: { backgroundColor: 'rgba(0,54,33,0.42)', borderColor: 'rgba(0,217,119,0.16)' },
  transcriptLabel: { color: '#81958A', fontSize: 11, marginBottom: 5, textAlign: 'right' },
  replyLabel: { color: '#00D977', fontSize: 11, marginBottom: 5, textAlign: 'right' },
  transcriptText: { color: '#E7F0EA', fontSize: 15, lineHeight: 24, textAlign: 'right' },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, paddingTop: 16 },
  sideButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(17,31,23,0.82)', borderWidth: 1, borderColor: 'rgba(201,227,210,0.22)' },
  micButton: { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center', backgroundColor: '#00D977', borderWidth: 8, borderColor: 'rgba(0,217,119,0.18)' },
  micButtonDisabled: { opacity: 0.48 },
  micButtonPressed: { transform: [{ scale: 0.96 }] },
  footer: { color: '#65776D', fontSize: 11, textAlign: 'center', paddingTop: 12, paddingBottom: 8 },
});
