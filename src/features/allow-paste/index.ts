import { installUeditorPaste, isUeditorDocument } from './ueditor';

/** Page-world paste support. No clipboard permission or prototype patching is used. */
export interface AllowPasteController {
  setEnabled(enabled: boolean): void;
  dispose(): void;
}

export interface AllowPasteOptions {
  /** Restore the native context menu in regular editable controls. */
  restoreContextMenu?: boolean;
  onHandled?: () => void;
  onError?: (error: unknown) => void;
}

interface CodeMirrorSelection {
  anchor: unknown;
  head: unknown;
}

interface CodeMirrorEditor {
  getWrapperElement(): HTMLElement;
  getOption(name: string): unknown;
  replaceSelection(text: string, collapse: string, origin: string): void;
  replaceSelections?: (texts: string[], collapse: string, origin: string) => void;
  listSelections?: () => CodeMirrorSelection[];
  getTextArea?: () => HTMLTextAreaElement;
  save?: () => void;
}

const TEXT_INPUT_TYPES = new Set(['text', 'search', 'email', 'url', 'tel', 'number']);
const EVENT_TYPES = ['paste', 'beforeinput', 'keydown', 'keypress', 'keyup', 'contextmenu'] as const;

function parentElement(element: Element): Element | null {
  if (element.parentElement) return element.parentElement;
  const root = element.getRootNode();
  return 'host' in root ? (root as ShadowRoot).host : null;
}

function eventElement(event: Event): Element | null {
  const pathTarget = event.composedPath()[0] ?? event.target;
  if (!pathTarget || !('nodeType' in pathTarget)) return null;
  const node = pathTarget as Node;
  return node.nodeType === 1 ? (node as Element) : node.parentElement;
}

function isEditable(element: Element, document: Document): boolean {
  // Disabled fieldsets and inert ancestors also make a control unavailable.
  if (element.closest('[inert]')) return false;
  const tag = element.tagName.toLowerCase();
  if (tag === 'input') {
    const input = element as HTMLInputElement;
    return TEXT_INPUT_TYPES.has(input.type) && !input.readOnly && !input.matches(':disabled');
  }
  if (tag === 'textarea') {
    const textarea = element as HTMLTextAreaElement;
    return !textarea.readOnly && !textarea.matches(':disabled');
  }
  if (tag === 'button' || tag === 'select' || tag === 'option') return false;

  for (let current: Element | null = element; current; current = parentElement(current)) {
    if (current.hasAttribute('inert')) return false;
    const editable = current.getAttribute('contenteditable')?.toLowerCase();
    if (editable === 'false') return false;
    if (editable === '' || editable === 'true' || editable === 'plaintext-only') return true;
  }
  return document.designMode?.toLowerCase() === 'on';
}

function isPasteShortcut(event: KeyboardEvent): boolean {
  if (event.altKey) return false;
  const key = event.key.toLowerCase();
  if ((event.ctrlKey || event.metaKey) && (key === 'v' || event.code === 'KeyV')) return true;
  return event.shiftKey && !event.ctrlKey && !event.metaKey && (key === 'insert' || event.code === 'Insert');
}

function findCodeMirror(element: Element): Element | null {
  for (let current: Element | null = element; current; current = parentElement(current)) {
    if (current.classList.contains('CodeMirror')) return current;
  }
  return null;
}

function codeMirrorEditor(wrapper: Element): CodeMirrorEditor | null {
  const candidate = (wrapper as Element & { CodeMirror?: Partial<CodeMirrorEditor> }).CodeMirror;
  if (
    !candidate ||
    typeof candidate.getWrapperElement !== 'function' ||
    typeof candidate.getOption !== 'function' ||
    typeof candidate.replaceSelection !== 'function' ||
    candidate.getWrapperElement() !== wrapper
  ) return null;
  if (candidate.getOption('readOnly')) return null;
  if (typeof candidate.getTextArea === 'function') {
    const textarea = candidate.getTextArea();
    if (!textarea || textarea.readOnly || textarea.matches(':disabled') || typeof candidate.save !== 'function') return null;
  }
  return candidate as CodeMirrorEditor;
}

/**
 * Install at document_start in MAIN world, including frames. Starts disabled.
 * Regular controls keep the browser's native paste. CodeMirror 5 receives plain
 * text from the user's trusted paste event through its public editing API.
 */
export function installAllowPaste(win: Window, options: AllowPasteOptions = {}): AllowPasteController {
  let enabled = false;
  let disposed = false;

  const reportError = (error: unknown): void => {
    try { options.onError?.(error); } catch { /* Diagnostics must not affect editing. */ }
  };
  const reportHandled = (): void => {
    try { options.onHandled?.(); } catch (error) { reportError(error); }
  };
  const ueditor = installUeditorPaste(win, { onHandled: reportHandled, onError: reportError });

  const onEvent = (event: Event): void => {
    if (!enabled || disposed) return;
    // The owning parent installs the UEditor adapter after its iframe is ready.
    // Keep its keyboard, selection, paste filtering and menus out of the native path.
    if (isUeditorDocument(win)) return;
    const element = eventElement(event);
    if (!element || !isEditable(element, win.document)) return;

    const codeMirror = findCodeMirror(element);
    if (codeMirror) {
      // Let CodeMirror handle keyboard, beforeinput and context menus itself.
      // Blocking these would detach its hidden textarea from its document model.
      if (event.type !== 'paste' || !event.isTrusted) return;
      let editor: CodeMirrorEditor | null;
      let text: string;
      let selections: CodeMirrorSelection[] | undefined;
      try {
        editor = codeMirrorEditor(codeMirror);
        if (!editor) return;
        text = (event as ClipboardEvent).clipboardData?.getData('text/plain') ?? '';
        if (!text) return;
        selections = editor.listSelections?.();
      } catch (error) {
        reportError(error);
        return;
      }

      // Consume before mutation: a failing adapter must never paste a second
      // time into the hidden native control. No synthetic input is dispatched.
      event.preventDefault();
      event.stopImmediatePropagation();
      try {
        if (selections && selections.length > 1 && editor.replaceSelections) {
          editor.replaceSelections(selections.map(() => text), 'end', 'toolbox-paste');
        } else {
          editor.replaceSelection(text, 'end', 'toolbox-paste');
        }
        editor.save?.();
        reportHandled();
      } catch (error) {
        reportError(error);
      }
      return;
    }

    if (event.type === 'beforeinput') {
      const inputType = (event as InputEvent).inputType;
      if (inputType !== 'insertFromPaste' && inputType !== 'insertFromPasteAsQuotation') return;
    } else if (event.type === 'keydown' || event.type === 'keypress' || event.type === 'keyup') {
      if (!isPasteShortcut(event as KeyboardEvent)) return;
    } else if (event.type === 'contextmenu' && options.restoreContextMenu === false) {
      return;
    }

    // Stop page handlers that cancel paste while preserving the native action.
    event.stopImmediatePropagation();
    reportHandled();
  };

  for (const type of EVENT_TYPES) win.addEventListener(type, onEvent, { capture: true });

  return {
    setEnabled(nextEnabled) {
      if (!disposed) { enabled = nextEnabled; ueditor.setEnabled(nextEnabled); }
    },
    dispose() {
      if (disposed) return;
      enabled = false;
      disposed = true;
      ueditor.dispose();
      for (const type of EVENT_TYPES) win.removeEventListener(type, onEvent, { capture: true });
    },
  };
}
