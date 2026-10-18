import type { FeatureController } from '../../core/feature-manager';
import { discoverStudyTasks, readStudyDocumentKey, type StudyPageWindow } from './discovery';
import { findStudyMedia, runStudyTask } from './jobs';
import { installStudyRateHook } from './rate-hook';
import { StudyTaskScope } from './task-scope';
import { defaultStudyPreferences, normalizeStudyPreferences, type StudyPageRequest, type StudyPageResult } from './types';

interface ActiveStudyTask {
  runId: string;
  taskKey: string;
  type: string;
  scope: StudyTaskScope;
  result: Promise<StudyPageResult>;
}
interface InstalledStudyPage extends FeatureController { handle(request: StudyPageRequest): Promise<StudyPageResult> }
const pages = new WeakMap<Window, InstalledStudyPage>();

function chapterId(element: Element): string {
  const owner = element.closest('.posCatalog_select');
  const direct = owner?.id.match(/^cur([\w-]+)$/)?.[1];
  if (direct) return direct;
  const click = element.getAttribute('onclick') ?? '';
  return click.match(/getTeacherAjax\s*\(\s*['"][^'"]+['"]\s*,\s*['"][^'"]+['"]\s*,\s*['"]([\w-]+)['"]/)?.[1] ?? '';
}

async function pageAction(win: Window, request: Extract<StudyPageRequest, { action: 'navigate' | 'card' | 'refresh' }>, scope: StudyTaskScope): Promise<StudyPageResult> {
  if (win !== win.top) return { ok: false, error: '章节切换必须由课程顶层页面执行。' };
  const doc = win.document;
  if (request.action === 'navigate') {
    const chapter = Array.from(doc.querySelectorAll<HTMLElement>('.posCatalog_name'))
      .find(element => chapterId(element) === request.chapterId);
    if (!chapter) return { ok: false, error: '目录中没有找到目标章节，请刷新课程页面。' };
    if (chapter.closest('.posCatalog_select')?.matches('[disabled], .locked, .lock')) return { ok: false, error: '目标章节尚未解锁，请先手动完成前置要求。' };
    chapter.click();
  } else if (request.action === 'card') {
    const cards = Array.from(doc.querySelectorAll<HTMLElement>('#prev_tab .prev_ul li'));
    if (!Number.isSafeInteger(request.cardIndex) || request.cardIndex < 0 || request.cardIndex >= cards.length) {
      return { ok: false, error: '当前章节没有对应的小节标签。' };
    }
    if (cards[request.cardIndex].classList.contains('active')) return { ok: true };
    const before = doc.querySelector<HTMLIFrameElement>('iframe#iframe, iframe[info="card"]');
    if (!before) return { ok: false, error: '未找到章节内容框架，无法确认小节切换。' };
    const beforeSrc = before.getAttribute('src');
    let loaded = false;
    // Iframe load does not bubble; capture it on the owning document.
    const loadCapture = (event: Event): void => {
      const frame = event.target as HTMLIFrameElement | null;
      if (frame?.matches?.('iframe#iframe, iframe[info="card"]')) loaded = true;
    };
    doc.addEventListener('load', loadCapture, true);
    scope.add(() => doc.removeEventListener('load', loadCapture, true));
    scope.check();
    cards[request.cardIndex].click();
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      await scope.wait(100);
      const current = doc.querySelector<HTMLIFrameElement>('iframe#iframe, iframe[info="card"]');
      if (loaded && current && (current !== before || current.getAttribute('src') !== beforeSrc)) return { ok: true };
    }
    return { ok: false, error: '小节切换未完成加载，已暂停以避免操作上一小节。' };
  } else {
    const page = win as Window & { onReadComplete?: () => void; onReadComplete1?: () => void };
    const refresh = page.onReadComplete ?? page.onReadComplete1;
    if (typeof refresh !== 'function') return { ok: false, error: '页面缺少目录状态刷新接口，请手动刷新后确认绿勾。' };
    refresh.call(win);
  }
  return { ok: true };
}

/** Starts disabled and never starts learning merely because this module is imported. */
export function installChapterStudy(window: Window): FeatureController {
  const existing = pages.get(window);
  if (existing) return existing;
  const win = window as StudyPageWindow;
  const documentId = win.crypto?.randomUUID?.() ?? `study-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const documentKey = (): string => readStudyDocumentKey(win, documentId);
  let enabled = false;
  let disposed = false;
  let preferences = defaultStudyPreferences();
  let active: ActiveStudyTask | undefined;
  let navigation: { runId?: string; scope: StudyTaskScope } | undefined;
  let hookRunId: string | undefined;
  const cancelledRuns = new Set<string>();
  const rateHook = installStudyRateHook(win);
  // Initialize before the platform player even at 1x: its limit can also be 1x,
  // and a later user rate change cannot remove an already-installed listener.
  const cancel = (runId?: string): void => {
    if (runId) {
      cancelledRuns.add(runId);
      if (cancelledRuns.size > 100) cancelledRuns.delete(cancelledRuns.values().next().value!);
    }
    if (!runId || active?.runId === runId) {
      active?.scope.cancel();
      active = undefined;
    }
    if (!runId || navigation?.runId === undefined || navigation.runId === runId) {
      navigation?.scope.cancel();
      navigation = undefined;
    }
  };
  const onHide = (): void => { cancel(); rateHook.setEnabled(false); };
  const onShow = (): void => { if (enabled && !disposed) rateHook.setEnabled(true); };
  win.addEventListener('pagehide', onHide);
  win.addEventListener('pageshow', onShow);

  const controller: InstalledStudyPage = {
    setEnabled(nextEnabled) {
      if (disposed) return;
      enabled = nextEnabled;
      if (!enabled) cancel();
      rateHook.setEnabled(enabled);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      enabled = false;
      cancel();
      rateHook.dispose();
      win.removeEventListener('pagehide', onHide);
      win.removeEventListener('pageshow', onShow);
      pages.delete(win);
    },
    async handle(request) {
      if (disposed) return { ok: false, error: '章节学习控制器已经释放，请刷新页面。' };
      if (request.action === 'configure') {
        const next = normalizeStudyPreferences(request.preferences);
        const mutedChanged = preferences.muted !== next.muted;
        const rateChanged = preferences.playbackRate !== next.playbackRate;
        preferences = next;
        // 运行期间更改倍速或静音，立即应用到正在播放的媒体。
        if (active?.type === 'video') {
          const media = findStudyMedia(win.document);
          if (media) {
            if (mutedChanged) media.muted = preferences.muted;
            if (rateChanged) media.playbackRate = preferences.playbackRate;
          }
        }
        rateHook.setEnabled(enabled);
        return { ok: true };
      }
      if (request.action === 'inspect') {
        const discovery = discoverStudyTasks(win, documentKey());
        const snapshot = { documentKey: discovery.documentKey, tasks: discovery.tasks, cardReady: discovery.cardReady,
          chapterId: discovery.chapterId, attachmentJobIds: discovery.attachmentJobIds, warning: discovery.warning };
        const warning = [snapshot.warning, rateHook.warning()].filter(Boolean).join(' ');
        return { ok: true, snapshot: { ...snapshot, ...(warning ? { warning } : {}) } };
      }
      if (request.action === 'cancel') {
        cancel(request.runId);
        if (hookRunId === request.runId) rateHook.setEnabled(false);
        return { ok: true };
      }
      if (!enabled) return { ok: false, error: '请先开启工具箱和章节学习功能。' };
      if (request.action !== 'run') {
        if (request.runId && cancelledRuns.has(request.runId)) return { ok: false, error: '本轮章节操作已取消。' };
        cancel();
        const key = documentKey();
        const actionScope = new StudyTaskScope(win, () => !disposed && enabled && (request.action !== 'card' || key === documentKey()));
        const pending = { runId: request.runId, scope: actionScope };
        navigation = pending;
        hookRunId = request.runId;
        try { return await pageAction(win, request, actionScope); }
        finally { actionScope.close(); if (navigation === pending) navigation = undefined; }
      }
      if (request.documentKey !== documentKey()) return { ok: false, error: '任务页面已变更，已阻止过期操作。' };
      if (cancelledRuns.has(request.runId)) return { ok: false, outcome: { status: 'skipped', message: '本次学习已取消。' } };
      if (active?.runId === request.runId && active.taskKey === request.taskKey) return active.result;
      if (active) return { ok: false, error: '本页面还有任务未结束，请先暂停后重试。' };
      const entry = discoverStudyTasks(win, documentKey()).entries.find(item => item.task.key === request.taskKey);
      if (!entry) return { ok: true, outcome: { status: 'skipped', message: '任务已完成或已从当前页面移除，等待目录确认。' } };
      if (!entry.task.isTaskPoint && entry.task.type !== 'chapter-test' && request.verifiedJobId !== entry.task.jobId) {
        return { ok: false, error: '子页面尚未获得当前章节任务点清单的确认，已阻止执行。' };
      }
      preferences = normalizeStudyPreferences(request.preferences);
      hookRunId = request.runId;
      rateHook.setEnabled(true);
      const scope = new StudyTaskScope(win, () => !disposed && enabled && documentKey() === request.documentKey
        && (!entry.element || entry.element.isConnected));
      const pending: ActiveStudyTask = { runId: request.runId, taskKey: request.taskKey, type: entry.task.type, scope, result: Promise.resolve({ ok: true }) };
      active = pending;
      pending.result = (async (): Promise<StudyPageResult> => {
        try {
          return { ok: true, outcome: await runStudyTask(entry, scope, () => preferences) };
        } catch (error) {
          if (scope.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
            return { ok: true, outcome: { status: 'skipped', message: '本次学习已取消，未继续播放或翻页。' } };
          }
          return { ok: true, outcome: { status: 'attention', message: '页面接口执行失败，已暂停，请手动检查当前任务。' } };
        } finally {
          scope.close();
          if (active === pending) active = undefined;
        }
      })();
      return pending.result;
    },
  };
  pages.set(win, controller);
  return controller;
}

export async function handleStudyPageRequest(win: Window, request: StudyPageRequest): Promise<StudyPageResult> {
  if (!pages.has(win)) installChapterStudy(win);
  try { return await pages.get(win)!.handle(request); }
  catch { return { ok: false, error: '无法读取当前学习页面，请刷新后重试。' }; }
}
