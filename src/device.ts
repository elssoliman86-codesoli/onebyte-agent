import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';

export interface InstalledApp {
  label: string;
  package: string;
}

interface DeviceControlNative {
  isServiceEnabled(): boolean;
  openAccessibilitySettings(): void;
  listApps(): Promise<InstalledApp[]>;
  launchApp(pkg: string): Promise<boolean>;
  openUrl(url: string, pkg: string | null): Promise<boolean>;
  getScreen(): Promise<string>;
  tap(index: number): Promise<string>;
  typeText(index: number, text: string): Promise<string>;
  scroll(down: boolean): Promise<string>;
  press(key: string): Promise<string>;
}

const native: DeviceControlNative | null =
  Platform.OS === 'android'
    ? requireOptionalNativeModule<DeviceControlNative>('DeviceControl')
    : null;

/** False in Expo Go, on iOS and on web: the native module only exists in an installed Android build. */
export function isAvailable(): boolean {
  return native !== null;
}

export function isServiceEnabled(): boolean {
  try {
    return native?.isServiceEnabled() ?? false;
  } catch {
    return false;
  }
}

export function assertServiceEnabled(): void {
  if (!isServiceEnabled()) {
    throw new Error('خدمة إمكانية الوصول غير مفعّلة. فعّلها من الإعدادات ثم أعد المحاولة.');
  }
}

export function openAccessibilitySettings(): void {
  native?.openAccessibilitySettings();
}

function need(): DeviceControlNative {
  if (!native) throw new Error('التحكم في الجهاز غير متاح في هذه النسخة.');
  return native;
}

export const listApps = () => need().listApps();
export const launchApp = (pkg: string) => need().launchApp(pkg);
export const openUrl = (url: string, pkg: string | null) => need().openUrl(url, pkg);
export const getScreen = () => need().getScreen();
export const tap = (index: number) => need().tap(index);
export const typeText = (index: number, text: string) => need().typeText(index, text);
export const scroll = (direction: 'up' | 'down') => need().scroll(direction === 'down');
export const press = (key: 'back' | 'home' | 'recents' | 'notifications') => need().press(key);
