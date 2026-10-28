import { Alert, Platform } from 'react-native';

export interface AlertButton {
  text: string;
  style?: 'default' | 'cancel' | 'destructive';
  onPress?: () => void;
}

/**
 * Alert that actually renders on web.
 *
 * react-native-web's Alert is a hard no-op (`static alert() {}`), which made
 * every confirmation and error message silently disappear on the web build.
 * On native this delegates to the real RN Alert; on web it falls back to the
 * browser's native dialog so the user always gets real feedback.
 */
export function alertCompat(title: string, message?: string, buttons?: AlertButton[]): void {
  if (Platform.OS !== 'web') {
    Alert.alert(title, message, buttons);
    return;
  }
  const body = [title, message].filter(Boolean).join('\n\n');
  if (!buttons || buttons.length <= 1) {
    window.alert(body);
    buttons?.[0]?.onPress?.();
    return;
  }
  // Confirmation-style dialog: OK confirms, Cancel cancels.
  const confirmButton =
    buttons.find((b) => b.style === 'destructive') ??
    buttons.filter((b) => b.style !== 'cancel').pop();
  const cancelButtons = buttons.filter((b) => b.style === 'cancel');
  const ok = window.confirm(body);
  if (ok) {
    confirmButton?.onPress?.();
  } else if (!confirmButton) {
    // All buttons are cancel-styled: picking either resolves them.
    cancelButtons[0]?.onPress?.();
  }
}
