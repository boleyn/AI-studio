/** Keep the native connector's <=60s execution lease alive only while work runs. */
export async function withExecutionLease<T>(
  renew: (expiresAt: number, signal: AbortSignal) => Promise<unknown>,
  execute: (signal: AbortSignal) => Promise<T>,
  signal?: AbortSignal,
  intervalMs = 20_000,
): Promise<T> {
  const controller = new AbortController();
  const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let renewalError: unknown;
  const heartbeat = async () => {
    try {
      await renew(Date.now() + 50_000, combined);
      if (!stopped && !combined.aborted) timer = setTimeout(() => void heartbeat(), intervalMs);
    } catch (error) {
      if (!stopped) {
        renewalError = error;
        controller.abort(error);
      }
    }
  };
  try {
    combined.throwIfAborted();
    await heartbeat();
    if (renewalError) throw renewalError;
    const result = await execute(combined);
    if (renewalError) throw renewalError;
    return result;
  } catch (error) {
    throw renewalError ?? error;
  } finally {
    stopped = true;
    clearTimeout(timer);
    controller.abort();
  }
}
