export interface EmbeddedBrowserElement {
  index: number;
  tag: string;
  role: string;
  label: string;
  type?: string;
  placeholder?: string;
  href?: string;
  disabled: boolean;
  password?: boolean;
}

export interface EmbeddedBrowserSnapshot {
  url: string;
  title: string;
  text: string;
  elements: EmbeddedBrowserElement[];
}

export type EmbeddedBrowserNetworkSource = 'fetch' | 'xhr' | 'beacon' | 'navigation';
export interface EmbeddedBrowserNetworkEntry {
  id: string;
  source: EmbeddedBrowserNetworkSource;
  method: string;
  url: string;
  createdAt: string;
  elapsedMs: number;
  status: number | null;
  statusText?: string;
  requestHeaders: Record<string, string>;
  requestBody: string;
  responseHeaders?: Record<string, string>;
  responsePreview?: string;
  error?: string;
}

export interface EmbeddedBrowserRequestResult {
  url: string;
  status: number;
  statusText: string;
  ok: boolean;
  elapsedMs: number;
  headers: Record<string, string>;
  body: string;
}

export interface EmbeddedBrowserDriver {
  currentUrl(): string;
  waitUntilReady(timeoutMs?: number): Promise<string>;
  navigate(url: string, scopeHost: string, requireAuthorization?: boolean): Promise<EmbeddedBrowserSnapshot>;
  readPage(): Promise<EmbeddedBrowserSnapshot>;
  click(index: number): Promise<string>;
  typeText(index: number, text: string): Promise<string>;
  scroll(direction: 'up' | 'down'): Promise<string>;
  wait(ms: number): Promise<string>;
  getNetworkLog(): Promise<EmbeddedBrowserNetworkEntry[]>;
  clearNetworkLog(): Promise<void>;
  sendRequest(input: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
  }): Promise<EmbeddedBrowserRequestResult>;
}

let activeDriver: EmbeddedBrowserDriver | null = null;
const driverWaiters = new Set<{
  resolve: (driver: EmbeddedBrowserDriver) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  afterDriver?: EmbeddedBrowserDriver | null;
}>();

export function registerEmbeddedBrowser(driver: EmbeddedBrowserDriver): () => void {
  activeDriver = driver;
  for (const waiter of [...driverWaiters]) {
    if (waiter.afterDriver && waiter.afterDriver === driver) continue;
    clearTimeout(waiter.timer);
    waiter.resolve(driver);
    driverWaiters.delete(waiter);
  }
  return () => {
    if (activeDriver === driver) activeDriver = null;
  };
}

export function getEmbeddedBrowser(): EmbeddedBrowserDriver | null {
  return activeDriver;
}

export function waitForEmbeddedBrowser(
  timeoutMs = 15_000,
  afterDriver?: EmbeddedBrowserDriver | null,
): Promise<EmbeddedBrowserDriver> {
  if (activeDriver && activeDriver !== afterDriver) return Promise.resolve(activeDriver);
  return new Promise((resolve, reject) => {
    const waiter = {
      resolve,
      reject,
      afterDriver,
      timer: setTimeout(() => {
        driverWaiters.delete(waiter);
        reject(new Error('المتصفح المدمج لم يصبح جاهزًا. ارجع للشات وافتحه مرة أخرى.'));
      }, timeoutMs),
    };
    driverWaiters.add(waiter);
  });
}