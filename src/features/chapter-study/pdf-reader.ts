import { isPlatformUrl } from '../../shared/sites';

const PDF_READER_CHANNEL = 'toolbox:chapter-study:pdf-reader:v1';
const PDF_READER_PATH = /^\/(?:mooc-ans\/)?screen\/(?:v2\/)?file(?:[_/]|$)/i;
const PDF_COURSEWARE_PATH = /\/ananas\/modules\/pdf\//i;
const SCROLL_TIMEOUT_MS = 30_000;
const SCROLL_INTERVAL_MS = 160;
const BRIDGE_TIMEOUT_MS = 32_000;
const BRIDGE_RETRY_MS = 250;
const BOTTOM_TOLERANCE = 2;
const installed = new WeakSet<Window>();

interface PdfScrollRequest {
  channel: typeof PDF_READER_CHANNEL;
  kind: 'scroll-to-bottom';
  id: string;
}

interface PdfScrollAck {
  channel: typeof PDF_READER_CHANNEL;
  kind: 'scroll-ack';
  id: string;
}

interface PdfScrollResult {
  channel: typeof PDF_READER_CHANNEL;
  kind: 'scroll-result';
  id: string;
  ok: boolean;
  state?: PdfScrollState;
  error?: string;
}

export interface PdfScrollState {
  top: number;
  height: number;
  total: number;
  atBottom: boolean;
}

export interface PdfScrollOptions {
  signal?: AbortSignal;
  timeout?: number;
  interval?: number;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cancelled(): DOMException {
  return new DOMException('PDF 滚动已取消。', 'AbortError');
}

function check(signal?: AbortSignal): void {
  if (signal?.aborted) throw cancelled();
}

function pause(win: Window, milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    check(signal);
    const timer = win.setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, milliseconds);
    const abort = (): void => {
      win.clearTimeout(timer);
      reject(cancelled());
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

function visible(element: Element): boolean {
  if (!element.isConnected) return false;
  const win = element.ownerDocument.defaultView;
  for (let node: Element | null = element; node; node = node.parentElement) {
    if (node.hasAttribute('hidden') || node.getAttribute('aria-hidden') === 'true') return false;
    const style = win?.getComputedStyle(node);
    if (style?.display === 'none' || style?.visibility === 'hidden' || style?.visibility === 'collapse') return false;
  }
  return true;
}

function readerContent(doc: Document): HTMLElement | undefined {
  return Array.from(doc.querySelectorAll<HTMLElement>(
    '.fileBox img, .fileBox canvas, .pdfViewer .page, .pdfViewer .page canvas, '
      + '#viewerContainer .page, #viewerContainer canvas, [data-document-reader] img, [data-document-reader] canvas',
  )).find(visible);
}

function readerContentReady(doc: Document): boolean {
  const images = Array.from(doc.querySelectorAll<HTMLImageElement>('.fileBox img, [data-document-reader] img'))
    .filter(visible);
  if (images.length) return images.some(image => image.complete && image.naturalWidth > 0);
  const pages = Array.from(doc.querySelectorAll<HTMLElement>('.pdfViewer .page, #viewerContainer .page'))
    .filter(visible);
  if (pages.length) return pages.some(page => page.clientHeight > 0);
  return Array.from(doc.querySelectorAll<HTMLCanvasElement>('.fileBox canvas, #viewerContainer canvas'))
    .some(canvas => visible(canvas) && canvas.width > 0 && canvas.height > 0);
}

function scrollTarget(doc: Document): HTMLElement | undefined {
  const win = doc.defaultView;
  const root = (doc.scrollingElement ?? doc.documentElement ?? doc.body) as HTMLElement | null;
  if (!root) return undefined;
  const content = readerContent(doc);
  if (content && win) {
    for (let parent: HTMLElement | null = content; parent && parent !== root; parent = parent.parentElement) {
      const overflow = win.getComputedStyle(parent).overflowY;
      if (/(?:auto|scroll)/.test(overflow) && parent.scrollHeight > parent.clientHeight + 1) return parent;
    }
  }
  const viewer = doc.querySelector<HTMLElement>('#viewerContainer');
  if (viewer && visible(viewer) && viewer.scrollHeight > viewer.clientHeight + 1) return viewer;
  return root;
}

function readState(target: HTMLElement): PdfScrollState {
  const top = Number.isFinite(target.scrollTop) ? target.scrollTop : 0;
  const height = Math.max(0, target.clientHeight);
  const total = Math.max(0, target.scrollHeight);
  return { top, height, total, atBottom: total <= height + BOTTOM_TOLERANCE || top + height >= total - BOTTOM_TOLERANCE };
}

/** Scroll only the PDF reader document, stepping through lazy-loaded pages until its height is stable. */
export async function scrollPdfDocumentToBottom(doc: Document, options: PdfScrollOptions = {}): Promise<PdfScrollState> {
  const win = doc.defaultView;
  if (!win) throw new Error('PDF 阅读器尚未加载完成。');
  const deadline = Date.now() + (options.timeout ?? SCROLL_TIMEOUT_MS);
  const interval = options.interval ?? SCROLL_INTERVAL_MS;
  let target: HTMLElement | undefined;
  let ready = false;
  while (Date.now() < deadline) {
    check(options.signal);
    target = scrollTarget(doc);
    if (target && target.clientHeight > 0 && target.scrollHeight > 0 && readerContentReady(doc)) {
      ready = true;
      break;
    }
    await pause(win, 200, options.signal);
  }
  if (!target || !ready) throw new Error('PDF 阅读器暂未显示可滚动内容。');

  let lastTotal = -1;
  let stableBottom = 0;
  const root = (doc.scrollingElement ?? doc.documentElement ?? doc.body) as HTMLElement | null;
  while (Date.now() < deadline) {
    check(options.signal);
    if (!target.isConnected || target === root) {
      const nextTarget = scrollTarget(doc);
      if (!nextTarget) throw new Error('PDF 阅读器内容已关闭，请手动完成。');
      if (nextTarget !== target) {
        target = nextTarget;
        lastTotal = -1;
        stableBottom = 0;
      }
    }
    const state = readState(target);
    if (state.height <= 0) {
      await pause(win, interval, options.signal);
      continue;
    }
    if (state.atBottom) {
      stableBottom = state.total === lastTotal ? stableBottom + 1 : 0;
      lastTotal = state.total;
      if (stableBottom >= 4) return state;
    } else {
      stableBottom = 0;
      lastTotal = state.total;
      target.scrollTop = Math.min(state.total - state.height,
        state.top + Math.max(1, Math.floor(state.height * 0.8)));
    }
    await pause(win, interval, options.signal);
  }

  check(options.signal);
  throw new Error('PDF 长时间未滚动到底部，请手动完成。');
}

export function isPdfCoursewareWindow(win: Window): boolean {
  try {
    return PDF_COURSEWARE_PATH.test(win.location.pathname);
  } catch {
    return false;
  }
}

export function isPdfReaderUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return isPlatformUrl(url.href, 'chaoxing') && PDF_READER_PATH.test(url.pathname);
  } catch {
    return false;
  }
}

export function findPdfReaderFrame(doc: Document): HTMLIFrameElement | undefined {
  return Array.from(doc.querySelectorAll<HTMLIFrameElement>('iframe#panView'))
    .find(frame => {
      try {
        const source = frame.getAttribute('src');
        return Boolean(source) && isPdfReaderUrl(new URL(source!, doc.baseURI).href);
      } catch {
        return false;
      }
    });
}

function validScrollRequest(value: unknown): value is PdfScrollRequest {
  return record(value) && value.channel === PDF_READER_CHANNEL && value.kind === 'scroll-to-bottom'
    && typeof value.id === 'string' && /^[\w-]{1,100}$/.test(value.id);
}

function validScrollState(value: unknown): value is PdfScrollState {
  return record(value) && ['top', 'height', 'total'].every(key => Number.isFinite(value[key]))
    && typeof value.atBottom === 'boolean';
}

function validScrollAck(value: unknown): value is PdfScrollAck {
  return record(value) && value.channel === PDF_READER_CHANNEL && value.kind === 'scroll-ack'
    && typeof value.id === 'string';
}

function validScrollResult(value: unknown): value is PdfScrollResult {
  return record(value) && value.channel === PDF_READER_CHANNEL && value.kind === 'scroll-result'
    && typeof value.id === 'string' && typeof value.ok === 'boolean'
    && (value.ok ? validScrollState(value.state) : typeof value.error === 'string');
}

function requestId(win: Window): string {
  return win.crypto?.randomUUID?.()
    ?? `pdf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function scrollResultError(value: string | undefined): Error {
  const detail = value?.trim().slice(0, 300);
  return new Error(detail || 'PDF 阅读器未能响应滚动请求，请手动滚动到底部。');
}

async function scrollPdfFrameViaBridge(frame: HTMLIFrameElement, signal: AbortSignal): Promise<PdfScrollState> {
  const win = frame.ownerDocument.defaultView;
  const child = frame.contentWindow;
  if (!win || !child) throw new Error('PDF 阅读器尚未加载完成。');
  const id = requestId(win);
  const request: PdfScrollRequest = { channel: PDF_READER_CHANNEL, kind: 'scroll-to-bottom', id };
  const expectedSource = frame.getAttribute('src');

  return new Promise((resolve, reject) => {
    let timer = 0;
    let retry = 0;
    let settled = false;
    const finish = (error?: Error, state?: PdfScrollState): void => {
      if (settled) return;
      settled = true;
      win.clearTimeout(timer);
      win.clearInterval(retry);
      win.removeEventListener('message', receive);
      signal.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve(state!);
    };
    const abort = (): void => finish(cancelled());
    const receive = (event: MessageEvent): void => {
      if (event.source !== child || !isPlatformUrl(event.origin, 'chaoxing')) return;
      if (validScrollAck(event.data) && event.data.id === id) {
        win.clearInterval(retry);
        retry = 0;
        return;
      }
      if (!validScrollResult(event.data) || event.data.id !== id) return;
      if (!event.data.ok) {
        finish(scrollResultError(event.data.error));
        return;
      }
      finish(undefined, event.data.state);
    };
    const send = (): void => {
      if (settled) return;
      if (signal.aborted) {
        finish(cancelled());
        return;
      }
      if (!frame.isConnected || frame.getAttribute('src') !== expectedSource) {
        finish(new Error('PDF 阅读页面已切换，已停止自动滚动。'));
        return;
      }
      try {
        // The request contains no page data. The reader validates the sender origin and ancestor.
        child.postMessage(request, '*');
      } catch {
        finish(new Error('PDF 阅读器通信失败，请手动滚动到底部。'));
      }
    };

    win.addEventListener('message', receive);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    timer = win.setTimeout(() => finish(new Error('PDF 阅读器未响应滚动请求，请手动滚动到底部。')), BRIDGE_TIMEOUT_MS);
    retry = win.setInterval(send, BRIDGE_RETRY_MS);
    send();
  });
}

/** Prefer direct same-origin access; use the restricted reader bridge after a cross-origin redirect. */
export async function scrollPdfReaderToBottom(frame: HTMLIFrameElement, signal: AbortSignal): Promise<PdfScrollState> {
  const child = frame.contentWindow;
  if (!child) throw new Error('PDF 阅读器尚未加载完成。');
  let direct: Document | undefined;
  try {
    const value = child.document;
    if (value?.documentElement && isPdfReaderUrl(value.URL)) direct = value;
  } catch {
    // Cross-origin reader documents are scrolled by their own content script bridge.
  }
  if (direct) {
    const state = await scrollPdfDocumentToBottom(direct, { signal });
    let current: Document | undefined;
    try {
      current = child.document;
    } catch {
      // The reader navigated to another origin while scrolling.
    }
    if (current !== direct) throw new Error('PDF 阅读页面已切换，已停止自动滚动。');
    return state;
  }
  return scrollPdfFrameViaBridge(frame, signal);
}

/** Installed in the cross-origin PDF reader frame; it accepts only its Chaoxing parent window. */
export function installPdfReaderBridge(win: Window): () => void {
  if (installed.has(win)) return () => undefined;
  try {
    if (win === win.top || !isPdfReaderUrl(win.location.href)) return () => undefined;
  } catch {
    return () => undefined;
  }
  installed.add(win);

  const tasks = new Map<string, Promise<PdfScrollResult>>();
  const results = new Map<string, PdfScrollResult>();
  const controllers = new Set<AbortController>();
  let disposed = false;

  const abortScrolling = (): void => {
    for (const controller of controllers) controller.abort();
    controllers.clear();
  };
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    abortScrolling();
    win.removeEventListener('message', receive);
    win.removeEventListener('pagehide', abortScrolling);
    tasks.clear();
    results.clear();
  };
  const scroll = (id: string): Promise<PdfScrollResult> => {
    const cached = results.get(id);
    if (cached) return Promise.resolve(cached);
    const existing = tasks.get(id);
    if (existing) return existing;
    const controller = new AbortController();
    controllers.add(controller);
    const task = scrollPdfDocumentToBottom(win.document, { signal: controller.signal })
      .then((state): PdfScrollResult => ({ channel: PDF_READER_CHANNEL, kind: 'scroll-result', id, ok: true, state }))
      .catch((error: unknown): PdfScrollResult => ({
        channel: PDF_READER_CHANNEL,
        kind: 'scroll-result',
        id,
        ok: false,
        error: error instanceof Error ? error.message.slice(0, 300) : 'PDF 未能滚动到底部。',
      }))
      .then(result => {
        if (!disposed) {
          results.set(id, result);
          if (results.size > 32) results.delete(results.keys().next().value!);
        }
        return result;
      })
      .finally(() => {
        controllers.delete(controller);
        tasks.delete(id);
      });
    tasks.set(id, task);
    return task;
  };
  const receive = (event: MessageEvent): void => {
    const source = event.source;
    if (disposed || source !== win.parent || !isPlatformUrl(event.origin, 'chaoxing')) return;
    if (!validScrollRequest(event.data)) return;
    const target = source as Window;
    try {
      const ack: PdfScrollAck = { channel: PDF_READER_CHANNEL, kind: 'scroll-ack', id: event.data.id };
      target.postMessage(ack, event.origin);
    } catch {
      return;
    }
    void scroll(event.data.id).then(result => {
      try {
        target.postMessage(result, event.origin);
      } catch {
        // The parent navigated away before the final response.
      }
    });
  };

  win.addEventListener('message', receive);
  win.addEventListener('pagehide', abortScrolling);
  return dispose;
}
