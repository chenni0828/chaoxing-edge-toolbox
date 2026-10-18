/** One cancellable operation owns every timer and listener that it creates. */
export class StudyTaskScope {
  readonly controller = new AbortController();
  readonly signal = this.controller.signal;
  private cleanups = new Set<() => void>();
  private closed = false;

  constructor(readonly win: Window, private readonly isCurrent: () => boolean) {}

  check(): void {
    if (this.closed || this.signal.aborted || !this.isCurrent()) {
      throw new DOMException('章节或页面已变更，本次操作已取消。', 'AbortError');
    }
  }

  add(cleanup: () => void): void { this.cleanups.add(cleanup); }

  on(target: EventTarget, type: string, listener: EventListener): void {
    target.addEventListener(type, listener);
    this.add(() => target.removeEventListener(type, listener));
  }

  wait(milliseconds: number): Promise<void> {
    this.check();
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error?: unknown): void => {
        if (settled) return;
        settled = true;
        this.win.clearTimeout(timer);
        this.signal.removeEventListener('abort', abort);
        this.cleanups.delete(cleanup);
        if (error) reject(error);
        else {
          try { this.check(); resolve(); } catch (reason) { reject(reason); }
        }
      };
      const abort = (): void => finish(new DOMException('本次操作已取消。', 'AbortError'));
      const cleanup = (): void => finish(new DOMException('本次操作已结束。', 'AbortError'));
      const timer = this.win.setTimeout(() => finish(), milliseconds);
      this.signal.addEventListener('abort', abort, { once: true });
      this.add(cleanup);
    });
  }

  cancel(): void {
    this.controller.abort();
    this.close();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const cleanup of [...this.cleanups].reverse()) {
      try { cleanup(); } catch { /* Continue removing the other listeners. */ }
    }
    this.cleanups.clear();
  }
}
