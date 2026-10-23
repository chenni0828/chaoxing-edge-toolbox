import { isPlatformUrl } from '../../../shared/sites';

export function isChapterStudyUrl(value: string): boolean {
  if (!isPlatformUrl(value, 'chaoxing')) return false;
  return /^\/(?:mooc-ans\/)?mycourse\/studentstudy\/?$/i.test(new URL(value).pathname);
}

export interface ChapterEntry {
  id: string;
  title: string;
  completed: boolean;
  unfinishedCount?: number;
}

export interface ChapterCard {
  index: number;
  active: boolean;
}

export interface ChapterPageSnapshot {
  courseKey: string;
  currentChapterId: string;
  chapterTitle: string;
  chapters: ChapterEntry[];
  cards: ChapterCard[];
  cardCount: number;
  activeCardIndex: number;
  frameKey: string;
  settled: boolean;
}

const frameKeys = new WeakMap<Element, number>();
let nextFrameKey = 0;

function field(doc: Document, selector: string): string {
  return doc.querySelector<HTMLInputElement>(selector)?.value.trim() ?? '';
}

function chapterId(element: Element | null | undefined): string {
  return element?.id.startsWith('cur') ? element.id.slice(3) : '';
}

/** Read only platform-owned navigation. A zero task count never implies completion. */
export function readChapterPage(doc: Document): ChapterPageSnapshot | undefined {
  const tree = doc.querySelector('#coursetree');
  const frame = doc.querySelector<HTMLIFrameElement>('iframe#iframe[info="card"], iframe#iframe');
  const courseId = field(doc, '#curCourseId');
  const clazzId = field(doc, '#curClazzId');
  if (!tree || !frame || !courseId || !clazzId) return undefined;
  const chapters = Array.from(tree.querySelectorAll<HTMLElement>('.posCatalog_select')).flatMap((element): ChapterEntry[] => {
    const name = element.querySelector<HTMLElement>(':scope > .posCatalog_name');
    const id = chapterId(element);
    if (!name || !id) return [];
    const rawCount = element.querySelector<HTMLInputElement>(':scope > .jobUnfinishCount')?.value
      ?? element.querySelector(':scope > .catalog_points_yi .orangeNew, :scope > .catalog_points_er .orangeNew')?.textContent;
    const count = rawCount?.trim() ? Number(rawCount.trim()) : NaN;
    return [{
      id,
      title: (name.getAttribute('title')?.trim() || name.textContent?.trim() || '未命名章节').slice(0, 300),
      completed: Boolean(element.querySelector(':scope > .icon_Completed')),
      ...(Number.isFinite(count) && count >= 0 ? { unfinishedCount: count } : {}),
    }];
  });
  if (!chapters.length) return undefined;
  const contentId = field(doc, '#curChapterId') || field(doc, '#chapterIdid') || field(doc, '#chapterId');
  const activeId = chapterId(tree.querySelector('.posCatalog_select.posCatalog_active'));
  const currentChapterId = activeId || contentId;
  if (!currentChapterId || !chapters.some(chapter => chapter.id === currentChapterId)) return undefined;
  const tabs = Array.from(doc.querySelectorAll<HTMLElement>('#prev_tab .prev_ul li'));
  const activeCardIndex = Math.max(0, tabs.findIndex(tab => tab.classList.contains('active')));
  const cards = tabs.length
    ? tabs.map((_tab, index) => ({ index, active: index === activeCardIndex }))
    : [{ index: 0, active: true }];
  const declaredCount = Number(field(doc, '#cardcount'));
  const cardCount = Math.max(cards.length, Number.isInteger(declaredCount) && declaredCount > 0 ? declaredCount : 1);
  let identity = frameKeys.get(frame);
  if (identity === undefined) { identity = ++nextFrameKey; frameKeys.set(frame, identity); }
  return {
    courseKey: `${courseId}:${clazzId}`,
    currentChapterId,
    chapterTitle: chapters.find(chapter => chapter.id === currentChapterId)?.title || doc.querySelector('.prev_title')?.textContent?.trim() || '当前章节',
    chapters,
    cards,
    cardCount,
    activeCardIndex,
    frameKey: `${identity}:${activeCardIndex}:${contentId}:${frame.getAttribute('src') ?? ''}`,
    settled: !contentId || !activeId || contentId === activeId,
  };
}

function signature(snapshot: ChapterPageSnapshot | undefined): string {
  return snapshot ? JSON.stringify(snapshot) : '';
}

/** Observe the stable document: the platform replaces the whole coursetree. */
export function observeChapterPage(doc: Document, changed: () => void): () => void {
  const win = doc.defaultView;
  if (!win) return () => {};
  let previous = signature(readChapterPage(doc));
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let forced = false;
  const schedule = (force = false) => {
    forced ||= force;
    if (disposed || timer !== undefined) return;
    timer = setTimeout(() => {
      timer = undefined;
      if (disposed) return;
      const next = signature(readChapterPage(doc));
      const notify = forced || next !== previous;
      forced = false;
      previous = next;
      if (notify) changed();
    }, 40);
  };
  const observer = new win.MutationObserver(() => schedule());
  observer.observe(doc, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'src', 'value', 'id'] });
  const loaded = (event: Event) => {
    const target = event.target as Element | null;
    if (target?.tagName === 'IFRAME' && target.id === 'iframe') schedule(true);
  };
  const ready = () => schedule(true);
  doc.addEventListener('load', loaded, true);
  doc.addEventListener('DOMContentLoaded', ready);
  return () => {
    disposed = true;
    observer.disconnect();
    if (timer !== undefined) clearTimeout(timer);
    doc.removeEventListener('load', loaded, true);
    doc.removeEventListener('DOMContentLoaded', ready);
  };
}
