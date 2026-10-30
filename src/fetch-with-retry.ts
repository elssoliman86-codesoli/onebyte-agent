import { fetch } from 'expo/fetch';

/**
 * Configuration for fetch-with-retry behavior.
 */
export interface FetchRetryOptions {
  /** Maximum time to wait for a single request attempt (ms). Default: 60_000.
   * Pass 0 to wait indefinitely — no per-attempt abort timer is scheduled and
   * the request waits as long as the provider needs (large-context models can
   * spend minutes before the first byte arrives). The caller's AbortSignal is
   * still honored, so a manual cancel remains possible. */
  timeout?: number;
  /** Maximum number of retry attempts for transient failures. Default: 3. */
  maxRetries?: number;
  /** Initial delay before first retry (ms). Default: 500. */
  baseDelay?: number;
  /** Maximum delay between retries (ms). Default: 8_000. */
  maxDelay?: number;
  /** Exponential backoff multiplier. Default: 2. */
  backoffMultiplier?: number;
  /** HTTP status codes that should trigger a retry. Default: [429, 500, 502, 503, 504]. */
  retryStatusCodes?: number[];
  /** AbortSignal to cancel the entire operation (including retries). */
  signal?: AbortSignal;
  /** Optional callback fired before each retry. */
  onRetry?: (attempt: number, error: Error, delay: number) => void;
}

const DEFAULT_OPTIONS: Omit<Required<FetchRetryOptions>, 'signal' | 'onRetry'> & {
  signal?: AbortSignal;
  onRetry?: (attempt: number, error: Error, delay: number) => void;
} = {
  timeout: 60_000,
  maxRetries: 3,
  baseDelay: 500,
  maxDelay: 8_000,
  backoffMultiplier: 2,
  retryStatusCodes: [429, 500, 502, 503, 504],
  signal: undefined,
  onRetry: undefined,
};

/**
 * Sleep for a given number of milliseconds, respecting an optional AbortSignal.
 */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    let settled = false;
    const cleanup = () => signal?.removeEventListener('abort', onAbort);
    const handle = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      if (settled) return;
      settled = true;
      clearTimeout(handle);
      cleanup();
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    // Close the race between the initial check and listener registration.
    if (signal?.aborted) onAbort();
  });
}

/**
 * Determines if an error or response status should trigger a retry.
 */
function isRetryable(status: number | null, error: unknown, retryStatusCodes: number[]): boolean {
  if (status !== null && retryStatusCodes.includes(status)) return true;
  // Network errors (TypeError, DOMException for abort) are retryable unless explicitly aborted
  if (error instanceof TypeError) return true; // Network failure
  if (error instanceof DOMException && error.name === 'AbortError') return false; // Intentional abort = don't retry
  return false;
}

/**
 * Wrapper around fetch that adds:
 * - Per-attempt timeout
 * - Retry with exponential backoff for transient failures
 * - Respects AbortSignal across the entire operation (including retries)
 */
export async function fetchWithRetry(
  url: string | URL | Request,
  init?: RequestInit,
  options: FetchRetryOptions = {},
): Promise<Response> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const externalSignal = opts.signal ?? init?.signal ?? undefined;
  let attempt = 0;

  while (true) {
    if (externalSignal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    let externallyAborted = false;
    let onExternalAbort: (() => void) | undefined;

    // Do not depend on AbortSignal.any: some Android/Hermes runtimes do not
    // implement it. A manually bridged controller preserves cancellation on
    // every supported runtime, including timeout: 0 requests.
    if (externalSignal) {
      onExternalAbort = () => {
        externallyAborted = true;
        controller.abort();
      };
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
      if (externalSignal.aborted) onExternalAbort();
    }

    if (opts.timeout > 0) {
      timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, opts.timeout);
    }

    const cleanupAttempt = () => {
      if (timeoutId) clearTimeout(timeoutId);
      if (onExternalAbort) externalSignal?.removeEventListener('abort', onExternalAbort);
    };

    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
      });
      cleanupAttempt();

      if (externalSignal?.aborted || externallyAborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
      if (response.ok || !opts.retryStatusCodes.includes(response.status)) return response;
      throw new ResponseError(response.status, `HTTP ${response.status}`);
    } catch (error) {
      cleanupAttempt();

      if (externalSignal?.aborted || externallyAborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
      if (error instanceof DOMException && error.name === 'AbortError' && !timedOut) {
        throw error;
      }

      const status = error instanceof ResponseError ? error.status : null;
      const shouldRetry = attempt < opts.maxRetries &&
        (timedOut || isRetryable(status, error, opts.retryStatusCodes));
      if (!shouldRetry) throw error;

      const delay = Math.min(
        opts.baseDelay * Math.pow(opts.backoffMultiplier, attempt),
        opts.maxDelay,
      );
      const jitter = delay * 0.1 * Math.random();
      const totalDelay = delay + jitter;
      opts.onRetry?.(
        attempt + 1,
        error instanceof Error ? error : new Error(String(error)),
        totalDelay,
      );
      await sleep(totalDelay, externalSignal);
      attempt += 1;
    }
  }
}

class ResponseError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'ResponseError';
  }
}

/**
 * Convenience wrapper for JSON responses with retry.
 */
export async function fetchJsonWithRetry<T>(
  url: string | URL | Request,
  init?: RequestInit,
  options: FetchRetryOptions = {},
): Promise<T> {
  const response = await fetchWithRetry(url, init, options);
  return response.json() as Promise<T>;
}

/**
 * Convenience wrapper for text responses with retry.
 */
export async function fetchTextWithRetry(
  url: string | URL | Request,
  init?: RequestInit,
  options: FetchRetryOptions = {},
): Promise<string> {
  const response = await fetchWithRetry(url, init, options);
  return response.text();
}

/**
 * Default export for backwards compatibility.
 */
export { fetchWithRetry as default };