/**
 * 章节详情页的任务动作：媒体播放、课件翻页、书籍与链接阅读。
 * 只依赖平台公开的 DOM 结构与播放器接口，无法继续时保留人工处理。
 */
import type { DiscoveredStudyTask, StudyPageWindow } from './discovery';
import { StudyTaskScope } from './task-scope';
import type { StudyPreferences, StudyTaskOutcome } from './types';

const attention = (message: string): StudyTaskOutcome => ({ status: 'attention', message });
const acted = (message: string): StudyTaskOutcome => ({ status: 'acted', message });
const FACE_MESSAGE = '检测到人脸识别，请手动进行识别后脚本才会继续运行。';

/**
 * 按 URL 定位学习顶层页面（而不是按 frame 嵌套），人脸检查统一在该文档上执行，
 * 因此视频自身 frame 内的遮罩节点不会被误判。
 */
function resolveStudyTop(win: Window): Window {
  let current: Window = win;
  for (let depth = 0; depth < 10; depth += 1) {
    try {
      if (current.location.href.includes('/mycourse/studentstudy')) return current;
      if (current.parent === current) break;
      current = current.parent;
    } catch { break; }
  }
  try { return win.top ?? win; } catch { return win; }
}

function studyTopDocument(win: Window): Document | undefined {
  try { return resolveStudyTop(win).document; } catch { return undefined; }
}

/** 只有带 src 的人脸二维码才算正在识别。 */
function hasFaceRecognition(win: Window): boolean {
  const doc = studyTopDocument(win);
  if (!doc) return false;
  return Array.from(doc.querySelectorAll('#fcqrimg')).some(image => Boolean(image.getAttribute('src')));
}

/** 新遮罩只要内联 display 不是 none 就算正在识别。 */
function hasNewFaceRecognition(win: Window): boolean {
  const doc = studyTopDocument(win);
  if (!doc) return false;
  return Array.from(doc.querySelectorAll<HTMLElement>('.chapterVideoFaceMaskDiv'))
    .some(mask => mask.style.display !== 'none');
}

/** 每 3 秒轮询一次人脸状态，直到识别结束。 */
async function waitForFaceState(scope: StudyTaskScope, active: () => boolean, message: string): Promise<void> {
  let notified = false;
  for (;;) {
    await scope.wait(3000);
    if (!active()) return;
    if (!notified) {
      notified = true;
      console.warn(message);
    }
  }
}

/** 只匹配播放器自身的中文错误文案，不读取 media.error。 */
function mediaLoadError(doc: Document): boolean {
  const error = doc.querySelector('.vjs-modal-dialog-content')?.textContent ?? '';
  return ['视频文件损坏', '网络错误导致视频下载中途失败', '视频因格式不支持', '网络的问题无法加载']
    .some(message => error.includes(message));
}

/** Prefer the player's own element over hidden preloads or auxiliary audio nodes. */
export function findStudyMedia(doc: Document): HTMLMediaElement | null {
  return doc.querySelector<HTMLMediaElement>('#video video, #audio audio, video.vjs-tech, audio.vjs-tech')
    ?? doc.querySelector<HTMLMediaElement>('video,audio');
}

/** Click the platform's own speed entry so the control bar stays in sync. */
function clickRateControl(doc: Document, rate: number): boolean {
  const match = Array.from(doc.querySelectorAll<HTMLElement>('.speedList [rate]'))
    .find(entry => Math.abs(Number.parseFloat(entry.getAttribute('rate') ?? '') - rate) < 0.01);
  if (!match) return false;
  const list = match.closest<HTMLElement>('.speedList');
  const bar = list?.closest<HTMLElement>('.controlsBar') ?? doc.querySelector<HTMLElement>('.controlsBar');
  if (bar) bar.style.display = 'block';
  if (list) list.style.display = 'block';
  match.click();
  return true;
}

/** Prefer the platform control; fall back to the media element when it is absent or ignored. */
async function applyStudyRate(doc: Document, media: HTMLMediaElement, rate: number, wait: (ms: number) => Promise<void>): Promise<void> {
  if (Math.abs(media.playbackRate - rate) < 0.01) return;
  if (clickRateControl(doc, rate)) {
    await wait(120);
    if (Math.abs(media.playbackRate - rate) < 0.01) return;
  }
  media.playbackRate = rate;
}

/** 运行期间保持平台控制栏可见。 */
function fixedVideoProgress(doc: Document): HTMLElement | null {
  const bar = doc.querySelector<HTMLElement>('.vjs-control-bar');
  if (bar) bar.style.opacity = '1';
  return bar;
}

/** 每 200ms 轮询一次媒体元素，最长等待 3 分钟。 */
async function waitForStudyMedia(scope: StudyTaskScope, doc: Document): Promise<HTMLMediaElement | undefined> {
  const deadline = Date.now() + 3 * 60 * 1000;
  while (Date.now() < deadline) {
    const media = findStudyMedia(doc);
    if (media) return media;
    await scope.wait(200);
  }
  return undefined;
}

/** 视频内题目使用独立循环，与播放流程解耦，每 3 秒执行一次。 */
async function runVideoQuizLoop(scope: StudyTaskScope, doc: Document): Promise<void> {
  for (;;) {
    if (doc.querySelector('#videoquiz-submit')) {
      const options = Array.from(doc.querySelectorAll<HTMLElement>('.ans-videoquiz-opt label'));
      options[Math.floor(Math.random() * options.length)]?.click();
      doc.querySelector<HTMLElement>('#videoquiz-submit')?.click();
      await scope.wait(3000);
      doc.querySelector('#video .ans-videoquiz')?.remove();
      for (const component of doc.querySelectorAll<HTMLElement>('.x-component-default')) {
        component.style.display = 'none';
      }
    }
    await scope.wait(3000);
  }
}

type MediaPlayResult = { ok: true } | { ok: false; message: string };

/** 播放被浏览器拦截时，把拒绝原因转成可操作提示。 */
async function playWithAutoplayResult(media: HTMLMediaElement): Promise<MediaPlayResult> {
  try {
    await media.play();
    return { ok: true };
  } catch (error) {
    const text = String(error);
    // 浏览器自动播放的提示文案因语言而异，额外用 error name 兜底。
    if (text.includes("failed because the user didn't interact with the document first") || text.includes('NotAllowedError')) {
      return { ok: false, message: '播放音视频失败：浏览器要求先与页面交互。请先点击一次页面上的任意位置（或播放按钮），再点击“继续学习”，后续无需重复点击。' };
    }
    if (text.includes('The element has no supported sources')) {
      return { ok: false, message: '当前视频因格式或编码问题无法播放，请手动处理。' };
    }
    return { ok: false, message: '播放视频时发生未知错误，请手动检查播放器。' };
  }
}

/**
 * 音视频任务：等待媒体、应用倍速与静音、监听暂停与结束。
 * 任务 scope 负责取消与计时器清理，文档卸载时也能安全退出。
 */
async function runMedia(entry: DiscoveredStudyTask, scope: StudyTaskScope, preferences: () => StudyPreferences): Promise<StudyTaskOutcome> {
  const doc = entry.owner.document;
  const media = await waitForStudyMedia(scope, doc);
  if (!media) return attention('3 分钟内没有找到可播放的音视频，请刷新或手动处理。');
  if (!doc.querySelector('#video,#audio')) return attention('视频检测不到，请尝试刷新或者手动切换下一章。');
  const activeMedia = media;
  const originalRate = activeMedia.playbackRate;
  const originalMuted = activeMedia.muted;
  let appliedRate = preferences().playbackRate;
  const appliedMuted = preferences().muted;
  const bar = doc.querySelector<HTMLElement>('.vjs-control-bar');
  const previousOpacity = bar?.style.opacity;
  const speedList = doc.querySelector<HTMLElement>('.speedList');
  const controlsBar = speedList?.closest<HTMLElement>('.controlsBar') ?? doc.querySelector<HTMLElement>('.controlsBar');
  const previousSpeedDisplay = speedList?.style.display;
  const previousControlsDisplay = controlsBar?.style.display;
  // 单个视频的弹题策略在开始时就固定，修改从下一个视频生效。
  const quizPolicy = preferences().videoQuiz;

  return new Promise<StudyTaskOutcome>((resolve, reject) => {
    let settled = false;
    let cleaned = false;
    const timers: { reload?: number; start?: number; skip?: number } = {};

    function cleanup(): void {
      if (cleaned) return;
      cleaned = true;
      if (timers.reload !== undefined) entry.owner.clearInterval(timers.reload);
      if (timers.start !== undefined) entry.owner.clearTimeout(timers.start);
      if (timers.skip !== undefined) entry.owner.clearTimeout(timers.skip);
      activeMedia.removeEventListener('pause', playFunction);
      activeMedia.removeEventListener('ended', onEnded);
      scope.signal.removeEventListener('abort', cancelled);
      // Remove the pause listener before pausing so cleanup cannot schedule a new play.
      if (!activeMedia.ended) {
        try { activeMedia.pause(); } catch { /* The document may already be unloading. */ }
      }
      if (bar && bar.style.opacity === '1') bar.style.opacity = previousOpacity ?? '';
      if (speedList && speedList.style.display === 'block') speedList.style.display = previousSpeedDisplay ?? '';
      if (controlsBar && controlsBar.style.display === 'block') controlsBar.style.display = previousControlsDisplay ?? '';
      if (activeMedia.playbackRate === appliedRate) activeMedia.playbackRate = originalRate;
      if (activeMedia.muted === appliedMuted) activeMedia.muted = originalMuted;
    }

    function finish(outcome: StudyTaskOutcome): void {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(outcome);
    }

    function cancelled(): void {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new DOMException('音视频播放已取消。', 'AbortError'));
    }

    function onEnded(): void {
      finish(acted('音视频播放结束，等待目录绿勾确认。'));
    }

    async function playFunction(): Promise<void> {
      if (settled || scope.signal.aborted) return;
      const face = hasFaceRecognition(entry.owner) || hasNewFaceRecognition(entry.owner);
      // 普通暂停遵循“自动续播”开关；人脸校验结束后总是继续，
      // 避免校验完成后播放被永久卡住。
      if (!preferences().autoResume && !face) return;
      try {
        if (hasFaceRecognition(entry.owner)) await waitForFaceState(scope, () => hasFaceRecognition(entry.owner), FACE_MESSAGE);
        if (hasNewFaceRecognition(entry.owner)) await waitForFaceState(scope, () => hasNewFaceRecognition(entry.owner), FACE_MESSAGE);
        if (activeMedia.ended === false) {
          await scope.wait(1000);
          if (settled || scope.signal.aborted) return;
          activeMedia.play().catch(() => undefined);
          appliedRate = preferences().playbackRate;
          activeMedia.playbackRate = appliedRate;
        }
      } catch { /* Cancelled while waiting for the face check or the resume delay. */ }
    }

    if (scope.signal.aborted) {
      cancelled();
      return;
    }
    activeMedia.addEventListener('pause', playFunction);
    activeMedia.addEventListener('ended', onEnded);
    scope.signal.addEventListener('abort', cancelled, { once: true });
    // Install cleanup before the speed menu's asynchronous initialization can be cancelled.
    scope.add(cleanup);
    const initialize = async (): Promise<void> => {
      await applyStudyRate(doc, activeMedia, appliedRate, ms => scope.wait(ms));
      scope.check();
      if (settled) return;
      fixedVideoProgress(doc);
      if (quizPolicy === 'random') void runVideoQuizLoop(scope, doc).catch(() => undefined);
      // “静音播放”直接映射到媒体元素的 muted 标志。
      activeMedia.muted = appliedMuted;
      // 每个音视频任务都从 0 开始播放，再在下一次调度时启动。
      activeMedia.currentTime = 0;

      timers.reload = entry.owner.setInterval(() => {
        if (settled || timers.skip !== undefined || !mediaLoadError(doc)) return;
        console.error('检测到视频加载失败，即将跳过视频。');
        timers.skip = entry.owner.setTimeout(() => {
          finish({ status: 'acted', chapterIncomplete: true, message: '检测到音视频加载失败，已跳过并继续。' });
        }, 3000);
      }, 3000);

      timers.start = entry.owner.setTimeout(() => {
        void playWithAutoplayResult(activeMedia).then((result) => {
          if (settled) return;
          if (!result.ok) {
            finish({ status: 'attention', message: result.message });
            return;
          }
          appliedRate = preferences().playbackRate;
          activeMedia.playbackRate = appliedRate;
        });
      }, 200);
    };
    void initialize().catch(error => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    });
  });
}

async function runCourseware(win: StudyPageWindow, scope: StudyTaskScope): Promise<StudyTaskOutcome> {
  if (typeof win.finishJob !== 'function') return attention('当前课件缺少 finishJob 接口，请手动完成阅读。');
  scope.check();
  win.finishJob();
  await scope.wait(3000);
  return acted('已调用课件阅读接口，等待目录绿勾确认。');
}

async function runAudioPpt(win: StudyPageWindow, scope: StudyTaskScope): Promise<StudyTaskOutcome> {
  if (typeof win.swiperNext !== 'function') return attention('带音频 PPT 缺少翻页接口，请手动完成阅读。');
  const slides = win.document.querySelectorAll('.swiper-container .swiper-slide').length;
  if (!slides) return attention('带音频 PPT 尚未加载幻灯片，请稍后重试。');
  for (const audio of win.document.querySelectorAll('audio')) {
    const previousMuted = audio.muted;
    const mute = (): void => { audio.muted = true; };
    scope.on(audio, 'play', mute);
    if (!audio.paused) mute();
    scope.add(() => { if (audio.muted) audio.muted = previousMuted; });
  }
  for (let index = 0; index < slides; index += 1) {
    scope.check();
    win.swiperNext();
    await scope.wait(1000);
  }
  await scope.wait(3000);
  return acted('带音频 PPT 已按页翻阅，等待目录绿勾确认。');
}

async function readTimedBook(win: StudyPageWindow, scope: StudyTaskScope): Promise<StudyTaskOutcome> {
  const initialDocument = win.document;
  const checkDocument = (): void => {
    scope.check();
    if (win.document !== initialDocument) throw new DOMException('阅读子页面已变更。', 'AbortError');
  };
  if (!win.document.querySelector('#reader')) {
    if (typeof win.readweb?.goto !== 'function' || win.epage === undefined) return attention('书籍缺少末页跳转接口，请手动阅读。');
    await scope.wait(5000);
    checkDocument();
    win.readweb.goto(win.epage);
    return acted('已跳转书籍末页，等待目录绿勾确认。');
  }
  if (typeof win.require !== 'function') return attention('长时阅读模块尚未就绪，请稍后重试。');
  let reader: { goPage?: unknown } | undefined;
  win.require(['reader'], value => {
    if (!scope.signal.aborted && value && (typeof value === 'object' || typeof value === 'function')) reader = value as { goPage?: unknown };
  });
  const deadline = Date.now() + 30000;
  while ((!reader || !win.document.querySelector('.readerPager')) && Date.now() < deadline) await scope.wait(200);
  const jumper = win.document.querySelector<HTMLInputElement>('#pagejump');
  if (!reader?.goPage || !jumper) return attention('长时阅读翻页接口未准备好，请手动完成。');
  const parsed = Number.parseInt(new URL(win.location.href).searchParams.get('timing') || '60', 10);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 86400) return attention('长时阅读的 timing 参数无效，已保留人工处理。');
  const interval = (parsed + 3) * 1000;
  await scope.wait(3000);
  for (const page of ['5', '7']) {
    await scope.wait(interval);
    checkDocument();
    jumper.value = page;
    const EventClass = win.document.defaultView?.Event ?? Event;
    jumper.dispatchEvent(new EventClass('change'));
  }
  await scope.wait(interval);
  const pager = Array.from(win.document.querySelectorAll<HTMLElement>('.readerPager')).find(element => element.style.zIndex === '101');
  if (!pager) return attention('已完成阅读等待，但没有找到结束阅读按钮，请手动确认。');
  checkDocument();
  pager.click();
  return acted('长时阅读已按原页面流程跳页，等待目录绿勾确认。');
}

async function runBook(entry: DiscoveredStudyTask, scope: StudyTaskScope): Promise<StudyTaskOutcome> {
  let win = entry.owner;
  if (entry.element?.tagName === 'IFRAME') {
    try {
      const child = (entry.element as HTMLIFrameElement).contentWindow as StudyPageWindow | null;
      if (!child || !child.document) return attention('阅读子页面尚未加载，请稍后重试。');
      win = child;
    } catch { return attention('阅读子页面跨域，无法关联并操作该任务，请手动阅读。'); }
  }
  return readTimedBook(win, scope);
}

async function runHyperlink(entry: DiscoveredStudyTask, scope: StudyTaskScope): Promise<StudyTaskOutcome> {
  const link = entry.element as HTMLElement | undefined;
  if (!link) return attention('没有找到链接阅读入口。');
  scope.check();
  const original = link.onclick;
  try {
    link.onclick = () => false;
    link.click();
  } finally { link.onclick = original; }
  await scope.wait(3000);
  return acted('已触发链接阅读，等待目录绿勾确认。');
}

export async function runStudyTask(entry: DiscoveredStudyTask, scope: StudyTaskScope, preferences: () => StudyPreferences): Promise<StudyTaskOutcome> {
  scope.check();
  switch (entry.task.type) {
    case 'video': return runMedia(entry, scope, preferences);
    case 'courseware': return runCourseware(entry.owner, scope);
    case 'audio-ppt': return runAudioPpt(entry.owner, scope);
    case 'book': return runBook(entry, scope);
    case 'hyperlink': return runHyperlink(entry, scope);
    case 'chapter-test': return { status: 'skipped', message: '章节测验暂不处理；若阻止目录出现绿勾，请手动完成。' };
  }
}
