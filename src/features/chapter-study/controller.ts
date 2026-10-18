import { observeChapterPage, readChapterPage, type ChapterPageSnapshot } from './adapters/chapter';
import {
  defaultStudyPreferences, normalizeStudyPreferences,
  type StudyController, type StudyPreferences, type StudyRuntime, type StudySession, type StudyState, type StudyTarget, type StudyTaskOutcome,
} from './types';

export interface ChapterTestHandlerContext { runId: string; signal: AbortSignal; preferences: StudyPreferences }
export type ChapterTestHandler = (target: StudyTarget, context: ChapterTestHandlerContext) => Promise<StudyTaskOutcome>;
export interface StudyDependencies {
  document: Document;
  isEnabled(): boolean;
  runtime: StudyRuntime;
  chapterTestHandler?: ChapterTestHandler;
}
interface Worker {
  abort: AbortController;
  runId: string;
  chapterId: string;
  frameKey: string;
  stage: 'loading' | 'navigation' | 'card' | 'scan' | 'task' | 'confirming';
  expectedChapterId?: string;
}

class Attention extends Error {}

function targetIdentity(target: StudyTarget): string {
  return `${target.frameId}:${target.documentId ?? ''}:${target.documentKey}:${target.key}`;
}

function interrupted(): Error { return new DOMException('章节学习已取消。', 'AbortError'); }

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(interrupted()); return; }
    const timer = setTimeout(() => { signal.removeEventListener('abort', aborted); resolve(); }, ms);
    const aborted = () => { clearTimeout(timer); reject(interrupted()); };
    signal.addEventListener('abort', aborted, { once: true });
  });
}

/** One tab owns the queue; frame workers only execute explicitly addressed tasks. */
export function createStudyController({ document: doc, isEnabled, runtime, chapterTestHandler }: StudyDependencies): StudyController {
  const handleChapterTest: ChapterTestHandler = chapterTestHandler ?? (async () => ({ status: 'skipped', message: '章节测验需手动完成。' }));
  const listeners = new Set<(state: StudyState) => void>();
  let preferences = defaultStudyPreferences();
  let state: StudyState = { phase: 'disabled', running: false, message: '章节学习已关闭。', chapterTitle: '', completed: 0, skipped: [], preferences };
  let session: StudySession | undefined;
  let worker: Worker | undefined;
  let disposed = false;
  let pageHidden = false;
  let initialized = false;
  let enabled = isEnabled();
  let preferenceRevision = 0;
  let writes = Promise.resolve();
  let evaluation = 0;
  let explicitResume = false;
  let resumeCurrent = false;
  let freshStart = false;
  let locallyPaused = false;

  function emit(update: Partial<StudyState>): void {
    if (disposed) return;
    state = { ...state, ...update, preferences: { ...preferences }, completed: session?.completed ?? 0, skipped: [...(session?.skipped ?? [])] };
    for (const listener of listeners) listener(getState());
  }

  function getState(): StudyState { return { ...state, preferences: { ...state.preferences }, skipped: [...state.skipped] }; }

  function persist(): Promise<void> {
    if (!session) return Promise.resolve();
    const copy = { ...session, visited: [...session.visited], skipped: [...session.skipped] };
    writes = writes.catch(() => {}).then(() => runtime.writeSession(copy));
    return writes;
  }

  function cancelWorker(): void {
    if (!worker) return;
    const previous = worker;
    worker = undefined;
    previous.abort.abort();
    runtime.cancel(previous.runId);
  }

  function assertCurrent(current: Worker, checkFrame = true): ChapterPageSnapshot {
    if (disposed || pageHidden || worker !== current || current.abort.signal.aborted || !isEnabled()) throw interrupted();
    const page = readChapterPage(doc);
    if (!page || page.courseKey !== session?.courseKey) throw interrupted();
    if (current.stage !== 'navigation' && page.currentChapterId !== current.chapterId) throw interrupted();
    if (checkFrame && ['scan', 'task'].includes(current.stage) && page.frameKey !== current.frameKey) throw interrupted();
    return page;
  }

  async function waitForPage(current: Worker, predicate: (page: ChapterPageSnapshot) => boolean, timeout = 12000): Promise<ChapterPageSnapshot> {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const page = assertCurrent(current, false);
      if (page.settled && predicate(page)) return page;
      await delay(100, current.abort.signal);
    }
    throw new Attention('章节或卡片没有加载完成，请检查页面后继续。');
  }

  function newSession(page: ChapterPageSnapshot): StudySession {
    return { courseKey: page.courseKey, runId: crypto.randomUUID(), anchorId: page.currentChapterId, startMode: preferences.startMode,
      visited: [], skipped: [], completed: 0, paused: false };
  }

  function rangeStart(page: ChapterPageSnapshot): number {
    if ((session?.startMode ?? preferences.startMode) === 'current-forward') {
      const first = page.chapters.findIndex(chapter => chapter.id === session?.anchorId);
      if (first < 0) throw new Attention('当前目录缺少本轮起点，请清除目录搜索或恢复完整目录后继续。');
      return first;
    }
    return 0;
  }

  function nextChapter(page: ChapterPageSnapshot, afterId?: string): string | undefined {
    let first = rangeStart(page);
    if (afterId) {
      const after = page.chapters.findIndex(chapter => chapter.id === afterId);
      if (after < 0) throw new Attention('当前章节不在目录中，请恢复完整目录后继续。');
      first = Math.max(first, after + 1);
    }
    return page.chapters.slice(first).find(chapter => !chapter.completed && !session?.visited.includes(chapter.id))?.id;
  }

  async function navigate(current: Worker, chapterId: string): Promise<ChapterPageSnapshot> {
    if (!session) throw interrupted();
    current.stage = 'navigation';
    current.expectedChapterId = chapterId;
    session.expectedChapterId = chapterId;
    await persist();
    assertCurrent(current, false);
    const result = await runtime.page({ action: 'navigate', chapterId, runId: current.runId }, current.abort.signal);
    assertCurrent(current, false);
    if (!result.ok) throw new Attention(result.error || '无法切换章节，请手动切换后继续。');
    const page = await waitForPage(current, value => value.currentChapterId === chapterId);
    current.chapterId = chapterId;
    current.frameKey = page.frameKey;
    current.expectedChapterId = undefined;
    session.expectedChapterId = undefined;
    await persist();
    return page;
  }

  async function selectCard(current: Worker, index: number): Promise<ChapterPageSnapshot> {
    let page = assertCurrent(current, false);
    if (page.activeCardIndex !== index) {
      current.stage = 'card';
      const result = await runtime.page({ action: 'card', cardIndex: index, runId: current.runId }, current.abort.signal);
      assertCurrent(current, false);
      if (!result.ok) throw new Attention(result.error || '无法切换章节卡片，请检查页面后继续。');
      page = await waitForPage(current, value => value.activeCardIndex === index);
    }
    current.frameKey = page.frameKey;
    current.stage = 'scan';
    return page;
  }

  function recordSkip(message: string): void {
    const bounded = message.slice(0, 500);
    if (session && !session.skipped.includes(bounded)) session.skipped.push(bounded);
  }

  async function runCard(current: Worker, title: string): Promise<boolean> {
    const signal = current.abort.signal;
    const done = new Set<string>();
    let deadline = Date.now() + 15000;
    let emptyReady = 0;
    let skippedQuiz = false;
    while (true) {
      current.stage = 'scan';
      assertCurrent(current);
      const scan = await runtime.scan(signal);
      assertCurrent(current);
      const playerWarning = scan.warnings.find(message => /倍速|播放器/.test(message));
      const targets = scan.targets.filter(target => !done.has(targetIdentity(target)));
      if (!targets.length) {
        if (scan.cardReady) {
          emptyReady += 1;
          if (emptyReady >= 2) return skippedQuiz;
        } else if (Date.now() >= deadline) {
          throw new Attention(scan.warnings[0] || '无法读取当前卡片内容，请确认页面已加载且可以访问。');
        }
        await delay(250, signal);
        continue;
      }
      emptyReady = 0;
      deadline = Date.now() + 15000;
      for (const target of targets) {
        assertCurrent(current);
        if (target.type === 'chapter-test') {
          current.stage = 'task';
          emit({ phase: 'running', running: true, message: '正在检查章节测验处理方式。', taskType: target.type });
          const outcome = await handleChapterTest(target, { runId: current.runId, signal, preferences: { ...preferences } });
          assertCurrent(current);
          deadline = Date.now() + 15000;
          const live = await runtime.scan(signal);
          assertCurrent(current);
          if (!live.targets.some(value => targetIdentity(value) === targetIdentity(target))) { current.stage = 'scan'; break; }
          if (outcome.status === 'attention') throw new Attention(outcome.message || '当前章节测验需要手动处理。');
          if (outcome.status === 'skipped') {
            skippedQuiz = true;
            recordSkip(`${title}：${target.title || '章节测验'}（需手动完成）`);
            emit({ message: '已记录章节测验，继续处理其他学习内容。', taskType: target.type });
          }
          done.add(targetIdentity(target));
          current.stage = 'scan';
          continue;
        }
        if (!target.isTaskPoint) { done.add(targetIdentity(target)); continue; }
        current.stage = 'task';
        emit({ phase: 'running', running: true,
          message: `正在学习：${target.title || title}${playerWarning ? `；${playerWarning}` : ''}`, taskType: target.type });
        const outcome = await runtime.runTask(target, current.runId, { ...preferences }, signal);
        assertCurrent(current);
        deadline = Date.now() + 15000;
        // A response from a replaced frame/document cannot complete its replacement.
        const live = await runtime.scan(signal);
        assertCurrent(current);
        if (!live.targets.some(value => targetIdentity(value) === targetIdentity(target))) {
          current.stage = 'scan';
          break;
        }
        if (outcome.status === 'attention') throw new Attention(outcome.message || '当前任务需要手动处理。');
        if (outcome.status === 'skipped') throw new Attention(outcome.message || '当前任务未执行，请手动处理后继续。');
        if (outcome.chapterIncomplete) {
          // The reference script skips a failed video and moves on; record it so
          // the chapter is not reported as complete and no green-check wait starts.
          skippedQuiz = true;
          recordSkip(`${title}：${target.title || '音视频'}（${outcome.message}）`);
        }
        done.add(targetIdentity(target));
        current.stage = 'scan';
      }
    }
  }

  async function runChapter(current: Worker): Promise<void> {
    const page = await waitForPage(current, () => true);
    current.chapterId = page.currentChapterId;
    current.frameKey = page.frameKey;
    const chapter = page.chapters.find(value => value.id === current.chapterId);
    emit({ chapterTitle: page.chapterTitle, phase: 'waiting', running: true, message: '正在读取章节卡片。', taskType: undefined });
    if (chapter?.completed) return;
    if (page.cardCount !== page.cards.length) throw new Attention('章节卡片目录尚未完整加载，请等待或刷新页面后继续。');
    let skippedQuiz = false;
    for (const card of page.cards) {
      await selectCard(current, card.index);
      skippedQuiz = await runCard(current, page.chapterTitle) || skippedQuiz;
    }
    current.stage = 'confirming';
    emit({ phase: 'confirming', running: true, message: '等待平台目录绿勾确认章节完成。', taskType: undefined });
    const refreshed = await runtime.page({ action: 'refresh', runId: current.runId }, current.abort.signal);
    assertCurrent(current, false);
    if (!refreshed.ok) throw new Attention(refreshed.error || '无法刷新平台目录，请手动刷新后继续。');
    const completed = () => assertCurrent(current, false).chapters.find(value => value.id === current.chapterId)?.completed === true;
    if (!completed() && !skippedQuiz) {
      const deadline = Date.now() + 30000;
      while (!completed() && Date.now() < deadline) await delay(200, current.abort.signal);
      if (!completed()) throw new Attention('等待 30 秒后目录仍未出现绿勾，已暂停。请检查未完成任务后继续。');
    }
    if (!session) throw interrupted();
    if (!session.visited.includes(current.chapterId)) {
      session.visited.push(current.chapterId);
      if (completed()) session.completed += 1;
    }
    await persist();
  }

  async function finish(current: Worker): Promise<void> {
    assertCurrent(current, false);
    if (!session) throw interrupted();
    session.finished = true;
    session.paused = false;
    session.expectedChapterId = undefined;
    await persist();
    assertCurrent(current, false);
    emit({ phase: 'complete', running: false, taskType: undefined,
      message: session.skipped.length ? '本轮学习已结束，跳过的任务仍需手动处理。' : '本轮学习已结束，已完成章节均以平台绿勾确认。' });
  }

  async function drive(current: Worker, initial: ChapterPageSnapshot, isNew: boolean, takeCurrent: boolean): Promise<void> {
    try {
      await runtime.configure({ ...preferences });
      assertCurrent(current, false);
      let page = initial;
      let selected: string | undefined;
      if (session?.expectedChapterId && session.expectedChapterId !== page.currentChapterId) selected = session.expectedChapterId;
      else if (takeCurrent || !isNew) {
        const chapter = page.chapters.find(value => value.id === page.currentChapterId);
        selected = !chapter?.completed && !session?.visited.includes(page.currentChapterId)
          ? page.currentChapterId : nextChapter(page, page.currentChapterId);
      } else selected = nextChapter(page);
      while (selected) {
        assertCurrent(current, false);
        if (page.chapters.findIndex(chapter => chapter.id === selected) < rangeStart(page)) {
          throw new Attention('当前章节位于本轮学习起点之前，已暂停。请返回范围内章节，或更改学习起点后重新开始。');
        }
        if (page.currentChapterId !== selected) page = await navigate(current, selected);
        else if (session?.expectedChapterId) { session.expectedChapterId = undefined; await persist(); }
        current.chapterId = selected;
        current.frameKey = page.frameKey;
        current.stage = 'loading';
        await runChapter(current);
        page = assertCurrent(current, false);
        selected = nextChapter(page, current.chapterId);
      }
      await finish(current);
    } catch (error) {
      if (worker !== current || current.abort.signal.aborted || disposed || pageHidden) return;
      if (error instanceof Error && error.name === 'AbortError') {
        worker = undefined;
        resumeCurrent = true;
        void evaluate();
        return;
      }
      runtime.cancel(current.runId);
      current.abort.abort();
      if (session) { session.paused = true; session.expectedChapterId = undefined; void persist().catch(() => {}); }
      emit({ phase: 'paused', running: false, taskType: undefined,
        message: error instanceof Error ? error.message : '章节学习遇到错误，已暂停。' });
    } finally {
      if (worker === current) worker = undefined;
    }
  }

  async function evaluate(): Promise<void> {
    const revision = ++evaluation;
    if (disposed || pageHidden || !initialized || worker) return;
    if (!isEnabled()) { emit({ phase: 'disabled', running: false, message: '章节学习已关闭。', taskType: undefined }); return; }
    const page = readChapterPage(doc);
    if (!page) { emit({ phase: 'unsupported', running: false, message: '请打开课程章节详情页，等待目录加载。', taskType: undefined }); return; }
    emit({ chapterTitle: page.chapterTitle });
    let isNew = false;
    if (!session || session.courseKey !== page.courseKey || freshStart) {
      const restored = freshStart ? undefined : await runtime.readSession(page.courseKey);
      if (disposed || pageHidden || revision !== evaluation || worker || !isEnabled()) return;
      session = restored?.courseKey === page.courseKey ? { ...restored, visited: [...restored.visited], skipped: [...restored.skipped] } : newSession(page);
      session.startMode ??= preferences.startMode;
      isNew = !restored;
      freshStart = false;
    }
    if (explicitResume) { session.paused = false; session.finished = false; locallyPaused = false; explicitResume = false; }
    if (locallyPaused) session.paused = true;
    if (session.paused) { emit({ phase: 'paused', running: false, message: '章节学习已暂停，点击继续可恢复。', taskType: undefined }); return; }
    if (session.finished) { emit({ phase: 'complete', running: false, message: '本轮学习已结束。', taskType: undefined }); return; }
    session.runId = crypto.randomUUID();
    await persist();
    if (disposed || pageHidden || revision !== evaluation || worker || !isEnabled()) return;
    const latest = readChapterPage(doc);
    if (!latest || latest.courseKey !== page.courseKey || latest.currentChapterId !== page.currentChapterId || latest.frameKey !== page.frameKey) {
      resumeCurrent = true;
      void evaluate();
      return;
    }
    const current: Worker = { abort: new AbortController(), runId: session.runId, chapterId: latest.currentChapterId, frameKey: latest.frameKey, stage: 'loading' };
    worker = current;
    const takeCurrent = resumeCurrent;
    resumeCurrent = false;
    emit({ phase: 'waiting', running: true, message: '正在准备章节学习。', taskType: undefined });
    void drive(current, latest, isNew, takeCurrent);
  }

  function domChanged(): void {
    if (disposed || pageHidden) return;
    const page = readChapterPage(doc);
    if (worker && !page) {
      cancelWorker();
      resumeCurrent = true;
    }
    if (worker && page) {
      const manualChapter = page.currentChapterId !== worker.chapterId
        && !(worker.stage === 'navigation' && page.currentChapterId === worker.expectedChapterId);
      const replacedCard = ['scan', 'task'].includes(worker.stage) && page.frameKey !== worker.frameKey;
      if (manualChapter || replacedCard || page.courseKey !== session?.courseKey) {
        cancelWorker();
        if (session) { session.expectedChapterId = undefined; session.finished = false; void persist().catch(() => {}); }
        resumeCurrent = true;
      }
    }
    if (!worker) void evaluate().catch(failedToInitialize);
  }

  function failedToInitialize(error: unknown): void {
    evaluation += 1;
    cancelWorker();
    locallyPaused = true;
    if (session) { session.paused = true; session.expectedChapterId = undefined; void persist().catch(() => {}); }
    emit({ phase: 'error', running: false, message: error instanceof Error ? error.message : '无法读取章节学习设置。', taskType: undefined });
  }

  const unobserve = observeChapterPage(doc, domChanged);
  const unsubscribePreferences = runtime.subscribePreferences(next => {
    preferenceRevision += 1;
    preferences = normalizeStudyPreferences(next);
    emit({});
    if (isEnabled()) void runtime.configure({ ...preferences }).catch(failedToInitialize);
  });
  const preferenceStart = preferenceRevision;
  void runtime.readPreferences().then(next => {
    if (disposed) return;
    if (preferenceRevision === preferenceStart) preferences = normalizeStudyPreferences(next);
    initialized = true;
    emit({});
    return evaluate();
  }).catch(failedToInitialize);

  const pagehide = () => { pageHidden = true; evaluation += 1; cancelWorker(); };
  const pageshow = (event: PageTransitionEvent) => {
    const restoring = pageHidden || event.persisted;
    pageHidden = false;
    if (restoring && session) resumeCurrent = true;
    void evaluate().catch(failedToInitialize);
  };
  doc.defaultView?.addEventListener('pagehide', pagehide);
  doc.defaultView?.addEventListener('pageshow', pageshow);

  return {
    getState,
    subscribe(listener) { listeners.add(listener); listener(getState()); return () => { listeners.delete(listener); }; },
    start() {
      if (disposed || !isEnabled()) return;
      if (session && (session.finished || session.startMode !== preferences.startMode)) freshStart = true;
      locallyPaused = false;
      explicitResume = true;
      resumeCurrent = Boolean(session && !freshStart);
      cancelWorker();
      void evaluate().catch(failedToInitialize);
    },
    stop() {
      evaluation += 1;
      locallyPaused = true;
      cancelWorker();
      if (session) { session.paused = true; session.expectedChapterId = undefined; void persist().catch(failedToInitialize); }
      explicitResume = false;
      emit({ phase: isEnabled() ? 'paused' : 'disabled', running: false, message: '章节学习已暂停。', taskType: undefined });
    },
    settingsChanged() {
      const next = isEnabled();
      evaluation += 1;
      if (!next) { cancelWorker(); emit({ phase: 'disabled', running: false, message: '章节学习已关闭。', taskType: undefined }); }
      else {
        if (!enabled) {
          explicitResume = true;
          locallyPaused = false;
          if (session && (session.finished || session.startMode !== preferences.startMode)) freshStart = true;
        }
        void evaluate().catch(failedToInitialize);
      }
      enabled = next;
    },
    async updatePreferences(next) {
      const normalized = normalizeStudyPreferences(next);
      await runtime.writePreferences(normalized);
      if (disposed) return;
      preferenceRevision += 1;
      preferences = normalized;
      emit({});
      if (isEnabled()) await runtime.configure({ ...preferences });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      evaluation += 1;
      cancelWorker();
      unobserve();
      unsubscribePreferences();
      doc.defaultView?.removeEventListener('pagehide', pagehide);
      doc.defaultView?.removeEventListener('pageshow', pageshow);
      listeners.clear();
    },
  };
}
