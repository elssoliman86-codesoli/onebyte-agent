import { fetch } from 'expo/fetch';

/**
 * Configuration for fetch-with-retry behavior.
 */
export interface FetchRetryOptions {
  /** Maximum time to wait for a single request attempt (ms). Default: 60_000. */
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
    const handle = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(handle);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
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
  let attempt = 0;
  let lastError: unknown;

  while (true) {
    // Check for abort before each attempt
    if (opts.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    // Create a controller for this attempt's timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), opts.timeout);

    // Combine the attempt controller with the external signal
    const combinedSignal = AbortSignal.any?.([controller.signal, opts.signal].filter(Boolean) as AbortSignal[]) ?? controller.signal;

    const attemptInit: RequestInit = {
      ...init,
      signal: combinedSignal,
    };

    try {
      const response = await fetch(url, attemptInit);
      clearTimeout(timeoutId);

      // If response is ok or non-retryable status, return it
      if (response.ok || !opts.retryStatusCodes.includes(response.status)) {
        return response;
      }

      // Status is retryable - throw to trigger retry logic
      throw new ResponseError(response.status, `HTTP ${response.status}`);
    } catch (error) {
      clearTimeout(timeoutId);
      lastError = error;

      // If aborted intentionally, don't retry
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw error;
      }

      // Check if we should retry
      const status = error instanceof ResponseError ? error.status : null;
      const shouldRetry = attempt < opts.maxRetries && isRetryable(status, error, opts.retryStatusCodes);

      if (!shouldRetry) {
        throw error;
      }

      // Calculate delay with exponential backoff and jitter
      const delay = Math.min(
        opts.baseDelay * Math.pow(opts.backoffMultiplier, attempt),
        opts.maxDelay,
      );
      const jitter = delay * 0.1 * Math.random(); // 0-10% jitter
      const totalDelay = delay + jitter;

      // Notify about retry
      opts.onRetry?.(attempt + 1, error instanceof Error ? error : new Error(String(error)), totalDelay);

      // Wait before retry
      await sleep(totalDelay, opts.signal);
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