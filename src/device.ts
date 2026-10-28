import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';

export interface InstalledApp {
  label: string;
  package: string;
}

interface DeviceControlNative {
  isServiceEnabled(): boolean;
  openAccessibilitySettings(): void;
  openAppDetailsSettings(): void;
  listApps(): Promise<InstalledApp[]>;
  launchApp(pkg: string): Promise<boolean>;
  openUrl(url: string, pkg: string | null): Promise<boolean>;
  getScreen(): Promise<string>;
  tap(index: number): Promise<string>;
  typeText(index: number, text: string): Promise<string>;
  scroll(down: boolean): Promise<string>;
  press(key: string): Promise<string>;
  checkServiceHealth(): Promise<{ healthy: boolean; reason?: string; nodeCount?: number }>;
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

/** Opens this app's own details page (restricted-settings unlock path on Android 13+). */
export function openAppDetailsSettings(): void {
  native?.openAppDetailsSettings();
}

function need(): DeviceControlNative {
  if (!native) throw new Error('التحكم في الجهاز غير متاح في هذه النسخة.');
  return native;
}

export interface PcRequestEvent {
  id: string;
  method: string;
  path: string;
  route: string;
  body: string;
  clientIp: string;
}

interface PcServerNative {
  start(port: number): Promise<boolean>;
  stop(): Promise<boolean>;
  isRunning(): boolean;
  getPort(): number;
  secureRandomHex(byteCount: number): string;
  getLocalIp(): string;
  respond(id: string, status: number, contentType: string, body: string): boolean;
  addListener(
    eventName: 'pcRequest',
    listener: (event: PcRequestEvent) => void,
  ): { remove: () => void };
}

const pc: PcServerNative | null =
  Platform.OS === 'android'
    ? requireOptionalNativeModule<PcServerNative>('PcControl')
    : null;

export function pcServerAvailable(): boolean {
  return pc !== null;
}

export async function startPcServer(port: number): Promise<boolean> {
  if (!pc) throw new Error('خادم الكمبيوتر متاح فقط في نسخة Android المثبتة.');
  return pc.start(port);
}

export async function stopPcServer(): Promise<boolean> {
  if (!pc) return false;
  return pc.stop();
}

export function isPcServerRunning(): boolean {
  return pc?.isRunning() ?? false;
}

export function pcServerPort(): number {
  return pc?.getPort() ?? 0;
}

/** Generate secure bytes natively because Hermes has no Web Crypto global on
 * every supported Android build. */
export function pcSecureRandomHex(byteCount: number): string {
  if (!pc) throw new Error('المصدر الآمن للأرقام العشوائية غير متاح في هذه النسخة.');
  return pc.secureRandomHex(byteCount);
}

export function pcServerLocalIp(): string {
  return pc?.getLocalIp() ?? '';
}

export function respondToPc(
  id: string,
  status: number,
  contentType: string,
  body: string,
): void {
  pc?.respond(id, status, contentType, body);
}

/** Subscribe to incoming PC requests. Returns an unsubscribe function. */
export function onPcRequest(
  listener: (event: PcRequestEvent) => void,
): () => void {
  if (!pc) return () => undefined;
  const subscription = pc.addListener('pcRequest', listener);
  return () => subscription.remove();
}

export const listApps = () => need().listApps();
export const launchApp = (pkg: string) => need().launchApp(pkg);
export const openUrl = (url: string, pkg: string | null) => need().openUrl(url, pkg);
export const getScreen = () => need().getScreen();
export const tap = (index: number) => need().tap(index);
export const typeText = (index: number, text: string) => need().typeText(index, text);
export const scroll = (direction: 'up' | 'down') => need().scroll(direction === 'down');
export const press = (key: 'back' | 'home' | 'recents' | 'notifications') => need().press(key);
export const checkServiceHealth = () => need().checkServiceHealth();
