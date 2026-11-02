export type Provider = 'bank' | 'ai';
export type PacingWait = (startedAt: number, signal: AbortSignal, onWait: (text: string) => void) => Promise<void>;
const cancelled = () => new DOMException('已暂停等待。', 'AbortError');

export function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(cancelled()); return; }
    const abort = () => { clearTimeout(timer); reject(cancelled()); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}

function cancellable<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(cancelled());
  return new Promise((resolve, reject) => {
    const abort = () => reject(cancelled());
    signal.addEventListener('abort', abort, { once: true });
    task.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

/** One FIFO per provider; cancelling a queued caller never reserves a future slot. */
export function createRequestPacer(deps: {
  interval(provider: Provider): Promise<number>;
  now?(): number;
  delay?(ms: number, signal: AbortSignal): Promise<void>;
  initial?: Partial<Record<Provider, number>>;
  onStart?(provider: Provider, at: number): void;
}) {
  const now = deps.now ?? Date.now;
  const delay = deps.delay ?? abortableDelay;
  const last = { bank: deps.initial?.bank ?? -Infinity, ai: deps.initial?.ai ?? -Infinity };
  const tails: Record<Provider, Promise<void>> = { bank: Promise.resolve(), ai: Promise.resolve() };
  return {
    wait(provider: Provider, signal: AbortSignal, onWait: (text: string) => void = () => {}): Promise<void> {
      if (signal.aborted) return Promise.reject(cancelled());
      onWait(`正在等待${provider === 'bank' ? '言溪题库' : 'AI'}请求额度…`);
      const task = tails[provider].then(async () => {
        if (signal.aborted) throw cancelled();
        const interval = await deps.interval(provider);
        if (signal.aborted) throw cancelled();
        // A clock rollback must not grant a burst, or turn a short interval into hours of waiting.
        last[provider] = Math.min(last[provider], now());
        let remaining = last[provider] + interval - now();
        while (remaining > 0) {
          onWait(`请求控速：${provider === 'bank' ? '言溪题库' : 'AI'}约 ${Math.ceil(remaining / 1000)} 秒后请求…`);
          await delay(remaining, signal);
          remaining = last[provider] + interval - now();
        }
        if (signal.aborted) throw cancelled();
        last[provider] = now();
        deps.onStart?.(provider, last[provider]);
      });
      tails[provider] = task.catch(() => {});
      return cancellable(task, signal);
    },
  };
}

/** Shared by the two answer controllers in one top page. Network time counts toward the minimum. */
export function createFillPacer(deps: {
  minimum(): Promise<number>;
  now?(): number;
  delay?(ms: number, signal: AbortSignal): Promise<void>;
}): PacingWait {
  const now = deps.now ?? Date.now;
  const delay = deps.delay ?? abortableDelay;
  let last = -Infinity;
  let tail = Promise.resolve();
  return (startedAt, signal, onWait) => {
    if (signal.aborted) return Promise.reject(cancelled());
    const task = tail.then(async () => {
      if (signal.aborted) throw cancelled();
      const minimum = await deps.minimum();
      last = Math.min(last, now());
      const deadline = Math.max(Math.min(startedAt, now()) + minimum, last + minimum);
      let remaining = deadline - now();
      while (remaining > 0) {
        onWait(`填写控速：约 ${Math.ceil(remaining / 1000)} 秒后填入本题…`);
        await delay(remaining, signal);
        remaining = deadline - now();
      }
      if (signal.aborted) throw cancelled();
      last = now();
    });
    tail = task.catch(() => {});
    return cancellable(task, signal);
  };
}
