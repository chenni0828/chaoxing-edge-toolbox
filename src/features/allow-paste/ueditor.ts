interface Ueditor {
  isReady?: boolean | number;
  iframe?: HTMLIFrameElement;
  body?: HTMLElement;
  selection?: { getRange(): { startContainer: Node; endContainer: Node } };
  addListener(type: string, listener: () => void): void;
  removeListener(type: string, listener: () => void): void;
  queryCommandState(command: string): number;
  execCommand(command: string, html: string): unknown;
  sync(): void;
}

interface PasteCallbacks {
  onHandled(): void;
  onError(error: unknown): void;
}

function instances(win: Window): Ueditor[] {
  const registry = (win as Window & { UE?: { instants?: Record<string, Ueditor> } }).UE?.instants;
  return registry && typeof registry === 'object' ? Object.values(registry).filter((editor) =>
    editor && typeof editor.addListener === 'function' && typeof editor.removeListener === 'function'
    && typeof editor.execCommand === 'function' && typeof editor.queryCommandState === 'function'
    && typeof editor.sync === 'function') : [];
}

/** Let the owning editor handle keyboard, beforeinput and menus, even before ready. */
export function isUeditorDocument(win: Window): boolean {
  try {
    const frame = win.frameElement;
    if (!frame) return false;
    if (frame.matches('.edui-editor-iframeholder > iframe')) return true;
    const owner = frame.ownerDocument.defaultView;
    return Boolean(owner && instances(owner).some((editor) => editor.iframe === frame));
  } catch {
    return false;
  }
}

function plainTextHtml(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n').map((line) =>
    line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
      .replace(/^ +| {2,}| +$/g, (spaces) => '&nbsp;'.repeat(spaces.length))).join('<br/>');
}

function editableTarget(event: Event, body: HTMLElement): boolean {
  const target = event.composedPath()[0] ?? event.target;
  if (!target || !('nodeType' in target)) return false;
  const node = target as Node;
  const element = node.nodeType === 1 ? node as Element : node.parentElement;
  if (!element || !body.contains(element) || element.closest('input, textarea, select, button')) return false;
  for (let current: Element | null = element; current; current = current.parentElement) {
    if (current.hasAttribute('inert') || current.getAttribute('aria-readonly') === 'true'
      || current.getAttribute('contenteditable')?.toLowerCase() === 'false') return false;
    if (current === body) break;
  }
  const editable = body.getAttribute('contenteditable')?.toLowerCase();
  return editable === '' || editable === 'true' || editable === 'plaintext-only'
    || body.ownerDocument.designMode?.toLowerCase() === 'on';
}

interface Binding {
  view?: Window;
  onPaste(event: Event): void;
  onReady(): void;
  onDestroy(): void;
}

/** Own frame listeners from the stable parent document, not a rewritten iframe. */
export function installUeditorPaste(win: Window, callbacks: PasteCallbacks): {
  setEnabled(enabled: boolean): void;
  dispose(): void;
} {
  const bindings = new Map<Ueditor, Binding>();
  let enabled = false;
  let disposed = false;
  let observer: MutationObserver | undefined;
  let scheduled: number | undefined;

  function unbind(binding: Binding): void {
    binding.view?.removeEventListener('paste', binding.onPaste, true);
    binding.view = undefined;
  }

  function remove(editor: Ueditor, binding: Binding): void {
    unbind(binding);
    // A destroyed instance may already have removed its public methods.
    editor.removeListener?.('ready', binding.onReady);
    editor.removeListener?.('destroy', binding.onDestroy);
    bindings.delete(editor);
  }

  function bind(editor: Ueditor, binding: Binding): void {
    unbind(binding);
    if (!enabled || disposed || !editor.isReady) return;
    try {
      const frame = editor.iframe;
      if (!frame?.isConnected || frame.ownerDocument !== win.document || !editor.body
        || frame.contentDocument?.body !== editor.body || !editor.selection?.getRange) return;
      binding.view = frame.contentWindow ?? undefined;
      // Always reattach: document.open() may clear listeners without replacing Window.
      binding.view?.addEventListener('paste', binding.onPaste, true);
    } catch { /* An inaccessible or rebuilding frame is not an editable candidate. */ }
  }

  function makeBinding(editor: Ueditor): Binding {
    const binding: Binding = {
      onPaste(event) {
        if (!enabled || disposed || !event.isTrusted || event.defaultPrevented) return;
        try {
          const frame = editor.iframe;
          const body = editor.body;
          if (!editor.isReady || !frame?.isConnected || frame.ownerDocument !== win.document
            || frame.contentWindow !== binding.view || frame.contentDocument?.body !== body
            || !body || !editableTarget(event, body) || editor.queryCommandState('inserthtml') === -1) return;
          const selection = binding.view?.getSelection();
          if (!selection?.rangeCount) return;
          const nativeRange = selection.getRangeAt(0);
          if (!body.contains(nativeRange.startContainer) || !body.contains(nativeRange.endContainer)) return;
          const range = editor.selection?.getRange();
          if (!range || !body.contains(range.startContainer) || !body.contains(range.endContainer)) return;
          const text = (event as ClipboardEvent).clipboardData?.getData('text/plain');
          if (!text) return;
          const html = plainTextHtml(text);
          // Consume once before mutation. Never fall back to a second native insertion.
          event.preventDefault();
          event.stopImmediatePropagation();
          editor.execCommand('inserthtml', html);
          editor.sync();
          callbacks.onHandled();
        } catch {
          callbacks.onError(new Error('UEditor 粘贴未能完成，请检查答题框后重试。'));
        }
      },
      onReady() { bind(editor, binding); },
      onDestroy() { remove(editor, binding); },
    };
    return binding;
  }

  function scan(): void {
    scheduled = undefined;
    if (!enabled || disposed) return;
    const editors = new Set(instances(win));
    for (const [editor, binding] of bindings) {
      if (!editors.has(editor) || (editor.iframe && !editor.iframe.isConnected)) remove(editor, binding);
    }
    for (const editor of editors) {
      if (editor.iframe && !editor.iframe.isConnected) continue;
      let binding = bindings.get(editor);
      if (!binding) {
        binding = makeBinding(editor);
        bindings.set(editor, binding);
        editor.addListener('ready', binding.onReady);
        editor.addListener('destroy', binding.onDestroy);
      }
      bind(editor, binding);
    }
  }

  function schedule(): void {
    if (enabled && !disposed && scheduled === undefined) scheduled = win.setTimeout(scan, 0);
  }

  function onLoad(event: Event): void {
    if ((event.target as Element | null)?.tagName === 'IFRAME') schedule();
  }

  function stop(): void {
    observer?.disconnect();
    observer = undefined;
    if (scheduled !== undefined) win.clearTimeout(scheduled);
    scheduled = undefined;
    win.document.removeEventListener('load', onLoad, true);
    win.document.removeEventListener('DOMContentLoaded', schedule);
    for (const [editor, binding] of bindings) remove(editor, binding);
  }

  return {
    setEnabled(value) {
      if (disposed || enabled === value) return;
      enabled = value;
      if (!enabled) { stop(); return; }
      const Observer = (win as Window & typeof globalThis).MutationObserver;
      observer = new Observer((records) => {
        // Editor typing is inside its document; only outer editor/frame changes matter.
        const relevant = (node: Node) => node.nodeType === 1 && ((node as Element).matches('iframe, .edui-editor')
          || Boolean((node as Element).querySelector('iframe, .edui-editor')));
        if (records.some((record) => record.type === 'attributes'
          ? (record.target as Element).tagName === 'IFRAME'
          : [...record.addedNodes, ...record.removedNodes].some(relevant))) schedule();
      });
      observer.observe(win.document, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
      win.document.addEventListener('load', onLoad, true);
      win.document.addEventListener('DOMContentLoaded', schedule);
      scan();
    },
    dispose() { if (disposed) return; enabled = false; disposed = true; stop(); },
  };
}
