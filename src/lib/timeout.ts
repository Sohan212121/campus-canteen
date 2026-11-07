export class TimeoutError extends Error {
  constructor(message = "auth service unreachable") {
    super(message);
    this.name = "TimeoutError";
  }
}

/**
 * Executes a PromiseLike or an async factory with a timeout and AbortSignal.
 *
 * @param promiseOrFactory - Either a thenable/Promise or a factory taking an AbortSignal
 * @param timeoutMs - Timeout in milliseconds (default: 4000)
 */
export async function withTimeout<T>(
  promiseOrFactory: PromiseLike<T> | ((signal: AbortSignal) => PromiseLike<T>),
  timeoutMs = 4000
): Promise<T> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new TimeoutError("auth service unreachable"));
    }, timeoutMs);
  });

  try {
    const value =
      typeof promiseOrFactory === "function"
        ? promiseOrFactory(controller.signal)
        : promiseOrFactory;
    return await Promise.race([Promise.resolve(value), timeoutPromise]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
