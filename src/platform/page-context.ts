import { isThinkLadderUrl } from '../features/ai-answer/adapters/think-ladder';
import { isSupportedUrl } from '../shared/sites';

export type PageContext = 'homework' | 'think-ladder' | 'generic';

const PAGE_MARKERS = '#fanyaMarking, #submitForm, #realApp, #chatScroll, .questionLi, input[name="workAnswerId"], iframe';
const PAGE_IDS = new Set(['fanyaMarking', 'submitForm', 'realApp', 'chatScroll']);

function isEditorContent(element: Element): boolean {
  return Boolean(element.closest('.edui-editor-iframeholder'));
}

function containsPageMarker(node: Node): boolean {
  if (node.nodeType !== 1) return false;
  const element = node as Element;
  if (isEditorContent(element)) return false;
  return element.matches(PAGE_MARKERS) || Array.from(element.querySelectorAll(PAGE_MARKERS)).some((marker) => !isEditorContent(marker));
}

function changesPageStructure(record: MutationRecord): boolean {
  if (record.target.nodeType === 1 && isEditorContent(record.target as Element)) return false;
  if (record.type === 'childList') {
    return [...record.addedNodes, ...record.removedNodes].some(containsPageMarker);
  }
  if (record.target.nodeType !== 1) return false;
  const target = record.target as Element;
  if (isEditorContent(target)) return false;
  switch (record.attributeName) {
    case 'src': return target.tagName === 'IFRAME';
    case 'action': return target.matches('form#submitForm');
    case 'id': return PAGE_IDS.has(target.id) || PAGE_IDS.has(record.oldValue ?? '');
    case 'class': return target.classList.contains('questionLi') !== (record.oldValue ?? '').split(/\s+/).includes('questionLi');
    case 'name': return target.tagName === 'INPUT' && (target.getAttribute('name') === 'workAnswerId' || record.oldValue === 'workAnswerId');
    default: return false;
  }
}

export function isHomeworkUrl(value: string): boolean {
  if (!isSupportedUrl(value)) return false;
  try {
    return /^\/(?:mooc-ans\/)?(?:mooc2\/)?work(?:\/|$)/i.test(new URL(value).pathname);
  } catch { return false; }
}

/** Known work routes and work-specific markup, including accessible embedded pages. */
export function readPageContext(doc: Document): PageContext {
  const visited = new Set<Document>();
  function inspect(current: Document, depth: number): PageContext {
    if (visited.has(current) || depth > 3) return 'generic';
    visited.add(current);
    const href = current.location?.href ?? current.URL;
    if (isThinkLadderUrl(href)) return 'think-ladder';
    if (isHomeworkUrl(href)) return 'homework';
    if (current.querySelector('#fanyaMarking .questionLi, #submitForm input[name="workAnswerId"]')) return 'homework';
    const workForm = current.querySelector<HTMLFormElement>('form#submitForm');
    if (workForm && isHomeworkUrl(workForm.action)) return 'homework';
    for (const frame of current.querySelectorAll<HTMLIFrameElement>('iframe')) {
      if (isEditorContent(frame)) continue;
      const src = frame.getAttribute('src');
      if (src) {
        try {
          const url = new URL(src, current.baseURI).href;
          if (isThinkLadderUrl(url)) return 'think-ladder';
          if (isHomeworkUrl(url)) return 'homework';
        } catch { /* An unloaded or malformed frame is not a page classification. */ }
      }
      try {
        if (frame.contentDocument) {
          const context = inspect(frame.contentDocument, depth + 1);
          if (context !== 'generic') return context;
        }
      } catch { /* Cross-origin frames are classified by known src routes only. */ }
    }
    return 'generic';
  }
  return inspect(doc, 0);
}

export function pageToolsTitle(context: PageContext): string {
  return context === 'homework' ? '作业' : context === 'think-ladder' ? '思维阶梯' : '页面工具';
}

/** Reclassify late page/frame content; callers decide whether navigation may change. */
export function observePageContext(doc: Document, changed: (context: PageContext) => void): () => void {
  const observers = new Map<Document, MutationObserver>();
  let context = readPageContext(doc);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const schedule = () => {
    if (disposed || timer !== undefined) return;
    timer = setTimeout(() => {
      timer = undefined;
      watchDocuments();
      const next = readPageContext(doc);
      if (next !== context) { context = next; changed(next); }
    }, 120);
  };
  const onLoad = (event: Event) => {
    const target = event.target as Node | null;
    if (target?.nodeType === 1 && (target as Element).tagName === 'IFRAME' && !isEditorContent(target as Element)) schedule();
  };
  function watchDocuments(): void {
    const currentDocuments = new Set<Document>();
    function visit(current: Document, depth: number): void {
      if (depth > 3 || currentDocuments.has(current)) return;
      currentDocuments.add(current);
      if (!observers.has(current)) {
        const observer = new MutationObserver((records) => { if (records.some(changesPageStructure)) schedule(); });
        observer.observe(current, { childList: true, subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ['src', 'action', 'class', 'id', 'name'] });
        observers.set(current, observer);
        current.addEventListener('load', onLoad, true);
      }
      for (const frame of current.querySelectorAll('iframe')) {
        if (isEditorContent(frame)) continue;
        try { if (frame.contentDocument) visit(frame.contentDocument, depth + 1); }
        catch { /* Cross-origin frame changes are observed through src and load. */ }
      }
    }
    visit(doc, 0);
    for (const [current, observer] of observers) {
      if (currentDocuments.has(current)) continue;
      observer.disconnect();
      current.removeEventListener('load', onLoad, true);
      observers.delete(current);
    }
  }
  watchDocuments();
  return () => {
    disposed = true;
    if (timer !== undefined) clearTimeout(timer);
    for (const [current, observer] of observers) {
      observer.disconnect();
      current.removeEventListener('load', onLoad, true);
    }
    observers.clear();
  };
}
