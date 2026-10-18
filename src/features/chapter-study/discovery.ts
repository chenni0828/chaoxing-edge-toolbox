import type { StudyFrameSnapshot, StudyTask, StudyTaskType } from './types';

export interface StudyPageWindow extends Window {
  attachments?: unknown;
  mArg?: { attachments?: unknown };
  finishJob?: () => void;
  swiperNext?: () => void;
  require?: (modules: string[], callback: (reader: unknown) => void) => void;
  readweb?: { goto?: (page: unknown) => void };
  epage?: unknown;
}

type Metadata = Record<string, unknown>;
interface Attachment { job?: unknown; isPassed?: unknown; jobid?: unknown; property?: Metadata }
export interface DiscoveredStudyTask { task: StudyTask; owner: StudyPageWindow; element?: Element }
export interface StudyDiscovery extends StudyFrameSnapshot { entries: DiscoveredStudyTask[] }

function record(value: unknown): Metadata | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Metadata : undefined;
}

function textId(value: unknown): string {
  return (typeof value === 'string' || typeof value === 'number') && String(value).length <= 500 ? String(value) : '';
}

function truth(value: unknown): boolean { return value === true || value === 1 || value === '1' || value === 'true'; }

function readData(element: Element | null): Metadata | undefined {
  if (!element) return undefined;
  const value = element.getAttribute('data');
  if (!value || value.length > 50000) return undefined;
  try { return record(JSON.parse(value)); } catch { return undefined; }
}

function attachmentList(win: StudyPageWindow): Attachment[] {
  try {
    const value = win.attachments ?? win.mArg?.attachments;
    return Array.isArray(value) ? value.filter(item => Boolean(record(item))) as Attachment[] : [];
  } catch { return []; }
}

function ancestry(win: StudyPageWindow): StudyPageWindow[] {
  const windows: StudyPageWindow[] = [win];
  let current = win;
  for (let depth = 0; depth < 8; depth += 1) {
    try {
      if (current.parent === current) break;
      const parent = current.parent as StudyPageWindow;
      void parent.document;
      windows.push(parent);
      current = parent;
    } catch { break; }
  }
  return windows;
}

function metadata(win: StudyPageWindow, element?: Element): Metadata[] {
  const values: Metadata[] = [];
  if (element) {
    const direct = readData(element);
    if (direct) values.push(direct);
  }
  for (const owner of ancestry(win)) {
    try {
      const value = readData(owner.frameElement);
      if (value) values.push(value);
    } catch { /* Cross-origin parents cannot supply trusted attachment metadata. */ }
  }
  return values;
}

function localJobId(win: StudyPageWindow): string {
  try {
    const params = new URL(win.location.href).searchParams;
    return params.get('jobid') ?? params.get('_jobid') ?? '';
  } catch { return ''; }
}

function titleFor(property: Metadata | undefined, type: StudyTaskType): string {
  const fallback: Record<StudyTaskType, string> = {
    video: '音视频', courseware: '课件 / 书籍', 'audio-ppt': '带音频 PPT', book: '长时阅读',
    hyperlink: '链接阅读', 'chapter-test': '章节测验（暂不处理）',
  };
  const title = property?.name ?? property?.title ?? property?.bookname;
  return typeof title === 'string' && title.trim() ? title.trim().slice(0, 300) : fallback[type];
}

function matchTask(win: StudyPageWindow, type: StudyTaskType, element?: Element): StudyTask | undefined {
  const data = metadata(win, element);
  const jobId = data.map(item => textId(item.jobid ?? item._jobid)).find(Boolean) || localJobId(win);
  const lists = ancestry(win).flatMap(attachmentList);
  const attachment = jobId ? lists.find(item => textId(item.jobid ?? item.property?._jobid) === jobId) : undefined;
  if (attachment) {
    if (truth(attachment.isPassed) || !truth(attachment.job)) {
      if (type !== 'chapter-test') return undefined;
    }
    if (type === 'chapter-test' && truth(attachment.isPassed)) return undefined;
    return { key: `${jobId}:${type}`, type, title: titleFor(attachment.property, type), jobId,
      isTaskPoint: truth(attachment.job) };
  }
  // A URL alone does not establish that an uncompleted task point exists.
  const explicit = data.find(item => textId(item.jobid ?? item._jobid) === jobId
    && (truth(item.job) || truth(item.isJob) || truth(item.isTaskPoint)) && !truth(item.isPassed));
  if (jobId && explicit) return { key: `${jobId}:${type}`, type, title: titleFor(explicit, type), jobId, isTaskPoint: true };
  if (type === 'chapter-test') return { key: `${jobId || 'chapter-test'}:${type}`, type,
    title: titleFor(undefined, type), jobId, isTaskPoint: false };
  if (jobId && !data.some(item => textId(item.jobid ?? item._jobid) === jobId && truth(item.isPassed))) {
    return { key: `${jobId}:${type}`, type, title: titleFor(data[0], type), jobId, isTaskPoint: false };
  }
  return undefined;
}

function parentOwnsReader(win: StudyPageWindow): boolean {
  try {
    const frame = win.frameElement;
    return Boolean(frame?.matches('iframe[name="bookifame"][src*="timing"]')
      && (win.parent as StudyPageWindow).document.querySelector('iframe[name="bookifame"][src*="timing"]') === frame);
  } catch { return false; }
}

function owningChapterId(win: StudyPageWindow): string | undefined {
  for (const owner of ancestry(win)) {
    const url = new URL(owner.location.href);
    if (/\/knowledge\/cards/.test(url.pathname)) {
      return url.searchParams.get('knowledgeid') ?? url.searchParams.get('knowledgeId') ?? undefined;
    }
  }
  const local = new URL(win.location.href).searchParams;
  return local.get('knowledgeid') ?? local.get('knowledgeId')
    ?? win.document.querySelector<HTMLInputElement>('#curChapterId')?.value ?? undefined;
}

export function readStudyDocumentKey(win: Window, documentId: string): string {
  const doc = win.document;
  const chapter = doc.querySelector<HTMLInputElement>('#curChapterId')?.value ?? '';
  const identity = `${win.location.href}|${chapter}`;
  let hash = 2166136261;
  for (let index = 0; index < identity.length; index += 1) hash = Math.imul(hash ^ identity.charCodeAt(index), 16777619);
  return `${documentId}:${(hash >>> 0).toString(36)}`;
}

/** Inspect this document only. Parent/child reader ownership prevents duplicate page jumps. */
export function discoverStudyTasks(win: StudyPageWindow, documentKey: string): StudyDiscovery {
  const doc = win.document;
  const entries: DiscoveredStudyTask[] = [];
  const warnings: string[] = [];
  const candidates: Array<{ type: StudyTaskType; element: Element }> = [];
  const video = doc.querySelector('#video,#audio');
  const test = doc.querySelector('.TiMu');
  const courseware = doc.querySelector('#img.imglook');
  const audioPpt = doc.querySelector('.swiper-container');
  const timedReader = doc.querySelector('iframe[name="bookifame"][src*="timing"]');
  const hyperlink = doc.querySelector('#hyperlink');
  const isReader = /\/readsvr\/book\/mooc/.test(win.location.pathname);
  let readerLoading = false;
  if (video) candidates.push({ type: 'video', element: video });
  else if (test) {
    if (!doc.querySelector('.testTit_status_complete')) candidates.push({ type: 'chapter-test', element: test });
  } else if (courseware) candidates.push({ type: 'courseware', element: courseware });
  else if (timedReader) {
    try {
      const child = (timedReader as HTMLIFrameElement).contentWindow;
      if (child && /\/readsvr\/book\/mooc/.test(child.document.location.pathname)) {
        candidates.push({ type: 'book', element: timedReader });
      } else readerLoading = true;
    } catch {
      // Cross-origin readers are discovered by their own MAIN controller.
      warnings.push('阅读子页面跨域，将由子页面任务标识与当前章节任务点清单核验。');
    }
  }
  else if (audioPpt) candidates.push({ type: 'audio-ppt', element: audioPpt });
  else if (hyperlink) candidates.push({ type: 'hyperlink', element: hyperlink });
  else if (isReader && !parentOwnsReader(win)) candidates.push({ type: 'book', element: doc.documentElement });

  for (const candidate of candidates) {
    const task = matchTask(win, candidate.type, candidate.element);
    if (task) {
      entries.push({ task, owner: win, element: candidate.element });
      if (!task.isTaskPoint && task.type !== 'chapter-test') warnings.push('子页面任务需由当前章节任务点清单核验，未经核验不会执行。');
    }
    else {
      const data = metadata(win, candidate.element);
      const jobId = data.map(item => textId(item.jobid ?? item._jobid)).find(Boolean) || localJobId(win);
      const attached = ancestry(win).flatMap(attachmentList).find(item => textId(item.jobid ?? item.property?._jobid) === jobId);
      if (!attached) warnings.push(`已发现${titleFor(undefined, candidate.type)}，但无法关联未完成任务点，已保留人工处理。`);
    }
  }
  const lists = attachmentList(win);
  const isCard = /\/knowledge\/cards/.test(win.location.pathname);
  return { documentKey, tasks: entries.map(entry => entry.task), entries,
    chapterId: owningChapterId(win),
    ...(isCard ? { attachmentJobIds: lists.filter(item => truth(item.job) && !truth(item.isPassed))
      .map(item => textId(item.jobid ?? item.property?._jobid)).filter(Boolean) } : {}),
    cardReady: isCard && !readerLoading && doc.readyState !== 'loading' && (lists.length > 0 || Boolean(doc.body)),
    ...(warnings.length ? { warning: warnings.join(' ') } : {}) };
}
