import { readThinkLadderState } from './adapters/think-ladder';
import type { AnswerSnapshot, AnswerWriteRequest, AnswerWriteResult } from './types';

interface UeditorInstance {
  isReady?: boolean | number;
  iframe?: HTMLIFrameElement;
  body?: HTMLElement;
  container?: HTMLElement;
  getContent(): string;
  setContent(html: string, append?: boolean): void;
  addListener(event: string, listener: () => void): void;
  removeListener?(event: string, listener: () => void): void;
  fireEvent(event: string): void;
  sync?(): void;
}

interface EditorTracker {
  id: number;
  changes: number;
  body: HTMLElement;
  observer: MutationObserver;
  listener: () => void;
}

const trackers = new WeakMap<UeditorInstance, EditorTracker>();
let nextEditorId = 0;

function normalize(value: string): string {
  return value.replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ')
    .replace(/[\u200b-\u200d\ufeff]/g, '').trim();
}

function contentSignature(value: string): string {
  let first = 2166136261;
  let second = 5381;
  for (let index = 0; index < value.length; index += 1) {
    first = Math.imul(first ^ value.charCodeAt(index), 16777619);
    second = Math.imul(second, 33) ^ value.charCodeAt(index);
  }
  return `${value.length}-${(first >>> 0).toString(36)}-${(second >>> 0).toString(36)}`;
}

function rendered(element: Element): boolean {
  for (let current: Element | null = element; current; current = current.parentElement) {
    if (current.hasAttribute('hidden') || current.getAttribute('aria-hidden') === 'true') return false;
    const style = current.ownerDocument.defaultView!.getComputedStyle(current);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
  }
  return true;
}

/**
 * Pick the answer editor among existing UEditor instances only; never instantiate one.
 * Keep the known answer host authoritative. A renamed host is supported only when
 * there is exactly one visible, usable instance in the app; never guess between editors.
 */
function existingEditor(win: Window): UeditorInstance | undefined {
  const doc = win.document;
  const ue = (win as Window & { UE?: { instants?: Record<string, UeditorInstance> } }).UE;
  const host = doc.querySelector('#realApp #textEditor') ?? doc.querySelector('#realApp');
  if (!host || !ue?.instants || typeof ue.instants !== 'object') return undefined;
  const candidates = Object.values(ue.instants).filter((editor) => {
    try {
      return !!editor?.isReady && !!editor.iframe?.isConnected && host.contains(editor.iframe)
        && !!editor.body && editor.iframe.contentDocument?.body === editor.body
        && typeof editor.getContent === 'function' && typeof editor.setContent === 'function'
        && typeof editor.addListener === 'function' && typeof editor.fireEvent === 'function'
        && rendered(editor.iframe);
    } catch {
      return false;
    }
  });
  return candidates.length === 1 ? candidates[0] : undefined;
}

function track(editor: UeditorInstance, win: Window): EditorTracker {
  const previous = trackers.get(editor);
  const body = editor.body!;
  if (previous?.body === body) return previous;
  if (previous) {
    previous.observer.disconnect();
    previous.body.removeEventListener('input', previous.listener);
    editor.removeListener?.('contentchange', previous.listener);
  }
  const tracker = { id: ++nextEditorId, changes: 0, body } as EditorTracker;
  tracker.listener = () => { tracker.changes += 1; };
  const Observer = (win as Window & typeof globalThis).MutationObserver;
  tracker.observer = new Observer(tracker.listener);
  tracker.observer.observe(body, { subtree: true, childList: true, characterData: true, attributes: true });
  body.addEventListener('input', tracker.listener);
  editor.addListener('contentchange', tracker.listener);
  trackers.set(editor, tracker);
  return tracker;
}

function textFromNode(node: Node): string {
  if (node.nodeType === 3) return node.textContent ?? '';
  if (node.nodeType !== 1 && node.nodeType !== 11) return '';
  const element = node as Element;
  if (element.tagName === 'BR') return '\n';
  if (['SCRIPT', 'STYLE'].includes(element.tagName)) return '';
  const text = Array.from(node.childNodes, textFromNode).join('');
  return ['P', 'DIV', 'PRE', 'LI', 'TR'].includes(element.tagName) ? `${text}\n` : text;
}

function snapshot(editor: UeditorInstance, win: Window): AnswerSnapshot {
  const tracker = track(editor, win);
  const html = editor.getContent();
  // takeRecords catches a change followed by undo before the observer callback.
  // Keeping a counter as well as HTML prevents "edit and restore" from passing.
  if (tracker.observer.takeRecords().length) tracker.changes += 1;
  const template = win.document.createElement('template');
  template.innerHTML = html;
  const text = normalize(textFromNode(template.content));
  const hasMedia = !!template.content.querySelector('img, math, svg, video, audio, object, embed, iframe, canvas, table, hr, input, [data-latex], [data-custom]');
  const readOnly = editor.body?.getAttribute('contenteditable') === 'false'
    || editor.body?.getAttribute('aria-readonly') === 'true';
  return {
    ready: !readOnly, text, hasContent: !!text || hasMedia,
    version: `${tracker.id}:${tracker.changes}:${contentSignature(html)}`,
    ...(readOnly ? { error: '当前答题框为只读状态。' } : {}),
  };
}

/** MAIN-world access to an existing UEditor only; never instantiate an editor. */
export function readUeditorAnswer(win: Window): AnswerSnapshot {
  try {
    const editor = existingEditor(win);
    return editor ? snapshot(editor, win)
      : { ready: false, text: '', version: '', hasContent: false, error: '答题编辑器尚未就绪，请稍后重试。' };
  } catch {
    return { ready: false, text: '', version: '', hasContent: false, error: '无法读取答题编辑器。' };
  }
}

function matchesQuestion(win: Window, request: AnswerWriteRequest): boolean {
  const current = readThinkLadderState(win.document);
  return current.state === 'question' && current.question.key === request.question.key
    && current.question.fingerprint === request.question.fingerprint;
}

function plainTextHtml(value: string): string {
  const escaped = value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  return `<p>${escaped.replace(/\r\n?/g, '\n').replace(/\n/g, '<br/>')}</p>`;
}

/** Atomic final guard and model write, followed by a model read-back. Never send. */
export function writeUeditorAnswer(win: Window, request: AnswerWriteRequest): AnswerWriteResult {
  if (!normalize(request.text)) return { ok: false, error: '生成的回答为空，未修改答题框。' };
  if (!matchesQuestion(win, request)) return { ok: false, error: '题目已变化，未填入旧题的回答。' };
  const editor = existingEditor(win);
  if (!editor) return { ok: false, error: '答题编辑器尚未就绪。' };
  let original = '';
  let writing = false;
  try {
    const current = snapshot(editor, win);
    if (!current.ready) return { ok: false, error: current.error };
    if (current.version !== request.expectedVersion) return { ok: false, error: '答题框内容已变化，已保留你的编辑。' };
    original = editor.getContent();
    editor.fireEvent('savescene');
    writing = true;
    // UEditor's public setContent already fires contentchange and selectionchange.
    editor.setContent(plainTextHtml(request.text), false);
    editor.sync?.();
    const result = snapshot(editor, win);
    if (result.text !== normalize(request.text)) throw new Error('readback-mismatch');
    editor.fireEvent('savescene');
    return { ok: true };
  } catch {
    if (writing) {
      try {
        editor.setContent(original, false);
        editor.sync?.();
        editor.fireEvent('savescene');
        return { ok: false, error: '填入未通过校验，已恢复原内容；生成的回答仍可查看。' };
      } catch {
        return { ok: false, error: '编辑器未能完成填入，请检查答题框；生成的回答仍可查看。' };
      }
    }
    return { ok: false, error: '无法读取答题内容，未执行填入。' };
  }
}
