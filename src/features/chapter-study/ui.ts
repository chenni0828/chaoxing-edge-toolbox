import type { WorkspaceContext, WorkspaceView } from '../workspace-registry';
import type { Settings } from '../toolbox-settings/types';
import { STUDY_RATES, type StudyPhase, type StudyPreferences, type StudyTaskType } from './types';

const phaseLabels: Record<StudyPhase, string> = {
  disabled: '未启用', unsupported: '暂不支持', waiting: '等待页面', running: '学习中',
  confirming: '确认完成', paused: '已暂停', complete: '学习结束', error: '需要处理',
};

const taskLabels: Record<StudyTaskType, string> = {
  video: '视频 / 音频', courseware: 'PPT / 文档', 'audio-ppt': '带音频 PPT',
  book: '书籍阅读', hyperlink: '链接阅读', 'chapter-test': '章节测验',
};

/** The view renders public controller state; all playback and navigation belong to the feature controller. */
export function createChapterStudyView(context: WorkspaceContext): WorkspaceView {
  const controller = context.study;
  if (!controller) throw new Error('当前网站不支持学习通章节学习。');
  const study = controller;
  const listeners = new AbortController();
  const { signal } = listeners;
  const root = document.createElement('section');
  root.className = 'feature-view chapter-study-view';
  root.setAttribute('aria-label', '章节学习');
  root.innerHTML = `
    <div class="study-heading"><h3 class="section-title">章节学习</h3><span class="phase-badge study-phase"></span><label class="switch-label study-enable"><span>启用</span><input type="checkbox" role="switch" class="switch" aria-label="启用章节学习" aria-describedby="cx-study-enable-help" disabled></label></div>
    <fieldset class="study-preferences" aria-label="播放设置">
      <div class="study-media-settings"><label class="study-field" for="cx-study-rate"><span>播放倍速</span><select id="cx-study-rate"></select></label><label class="switch-label study-muted"><span>静音播放</span><input type="checkbox" role="switch" class="switch" data-study-muted aria-label="静音播放"></label><label class="switch-label study-muted"><span>自动续播</span><input type="checkbox" role="switch" class="switch" data-study-auto-resume aria-label="自动续播"></label></div>
      <p class="study-rate-warning" id="cx-study-rate-warning" role="status" aria-live="polite" aria-atomic="true" hidden></p>
      <p class="study-preference-feedback" role="status" aria-live="polite" hidden></p>
    </fieldset>
    <div class="study-progress">
      <p class="study-chapter"></p><p class="study-task"></p>
      <p class="study-message" role="status" aria-live="polite" aria-atomic="true"></p>
      <div class="study-progress-footer"><p class="study-count"></p><div class="study-actions"><button class="button primary" type="button" data-study-action="start">开始学习</button><button class="button" type="button" data-study-action="stop" hidden>暂停</button></div></div>
    </div>
    <details class="study-more"><summary>更多设置</summary><div class="study-more-content">
      <div class="study-preference-grid">
        <label class="study-field" for="cx-study-start-mode"><span>学习起点</span><select id="cx-study-start-mode"><option value="first-unfinished">首个未完成任务点</option><option value="current-forward">从当前章节向后</option></select></label>
        <label class="study-field" for="cx-study-video-quiz"><span>视频内题目</span><select id="cx-study-video-quiz" aria-describedby="cx-study-quiz-help"><option value="random">随机作答</option><option value="ignore">忽略</option></select></label>
      </div>
      <p class="study-field-help" id="cx-study-quiz-help">视频内题目设置从下一个视频生效。</p>
      <p class="study-field-help" id="cx-study-enable-help">启用后进入章节详情自动学习，可随时暂停。</p>
      <p class="study-field-help study-boundary">章节测验会跳过；完成情况以平台状态为准。播放受阻时按页面提示处理。</p>
    </div></details>
    <details class="study-skipped" hidden><summary></summary><ul></ul></details>
  `;
  function element<T extends HTMLElement>(selector: string): T {
    const found = root.querySelector<T>(selector);
    if (!found) throw new Error(`Missing study UI element: ${selector}`);
    return found;
  }
  const phase = element<HTMLElement>('.study-phase');
  const enable = element<HTMLInputElement>('.study-enable input');
  const mode = element<HTMLSelectElement>('#cx-study-start-mode');
  const videoQuiz = element<HTMLSelectElement>('#cx-study-video-quiz');
  const rate = element<HTMLSelectElement>('#cx-study-rate');
  const rateWarning = element<HTMLElement>('#cx-study-rate-warning');
  const muted = element<HTMLInputElement>('[data-study-muted]');
  const autoResume = element<HTMLInputElement>('[data-study-auto-resume]');
  const feedback = element<HTMLElement>('.study-preference-feedback');
  const message = element<HTMLElement>('.study-message');
  const chapter = element<HTMLElement>('.study-chapter');
  const task = element<HTMLElement>('.study-task');
  const count = element<HTMLElement>('.study-count');
  const start = element<HTMLButtonElement>('[data-study-action="start"]');
  const stop = element<HTMLButtonElement>('[data-study-action="stop"]');
  const skipped = element<HTMLDetailsElement>('.study-skipped');
  const skippedSummary = element<HTMLElement>('.study-skipped summary');
  const skippedList = element<HTMLUListElement>('.study-skipped ul');
  for (const value of STUDY_RATES) {
    const option = document.createElement('option');
    option.value = String(value);
    option.textContent = `${value} 倍`;
    rate.append(option);
  }
  let settings = context.getSettings();
  let saving = false;
  let preferencesSaving = false;
  let pendingPreferences: StudyPreferences | undefined;
  let state = study.getState();
  let localError = '';
  let preferenceFeedback = '';
  let disposed = false;
  let renderedSkipped = '';

  function render(): void {
    if (disposed) return;
    const enabled = Boolean(settings?.enabled && settings.features['chapter-study']);
    phase.textContent = phaseLabels[state.phase];
    phase.dataset.phase = state.phase;
    enable.checked = Boolean(settings?.features['chapter-study']);
    enable.disabled = !settings?.enabled || saving;
    const preferencesDisabled = !enabled || saving || preferencesSaving;
    const selectedPreferences = pendingPreferences || state.preferences;
    mode.value = state.preferences.startMode;
    mode.disabled = preferencesDisabled || state.running;
    mode.title = state.running ? '暂停后可更改学习起点。' : '';
    videoQuiz.value = state.preferences.videoQuiz;
    videoQuiz.disabled = preferencesDisabled;
    rate.value = String(selectedPreferences.playbackRate);
    rate.disabled = preferencesDisabled;
    rateWarning.hidden = selectedPreferences.playbackRate <= 2;
    rateWarning.textContent = rateWarning.hidden ? '' : '超过 2 倍速有播放失败风险；失败后降至 2 倍，再失败降至 1 倍。'
      + (selectedPreferences.autoResume ? '已开启自动续播。' : '自动续播已关闭，需手动播放。');
    if (rateWarning.hidden) rate.removeAttribute('aria-describedby');
    else rate.setAttribute('aria-describedby', rateWarning.id);
    muted.checked = state.preferences.muted;
    muted.disabled = preferencesDisabled;
    autoResume.checked = selectedPreferences.autoResume;
    autoResume.disabled = preferencesDisabled;
    feedback.textContent = preferencesSaving ? '正在保存学习设置…' : preferenceFeedback;
    feedback.hidden = !feedback.textContent;
    message.textContent = localError || (!settings ? '正在读取工具箱设置…'
      : !settings.enabled ? '工具箱已暂停。请先打开上方“启用工具箱”。'
        : !enabled ? '章节学习已关闭。启用后会按已保存的设置自动学习。' : state.message);
    message.dataset.kind = localError || state.phase === 'error' ? 'error' : 'info';
    chapter.textContent = state.chapterTitle ? `当前章节 · ${state.chapterTitle}` : '等待识别当前章节';
    task.textContent = state.taskType ? `当前任务 · ${taskLabels[state.taskType]}` : '';
    task.hidden = !task.textContent;
    count.textContent = `已完成 ${state.completed} 项 · 已跳过 ${state.skipped.length} 项`;
    start.hidden = state.running;
    start.disabled = !enabled || saving || preferencesSaving || state.phase === 'unsupported';
    start.textContent = state.phase === 'paused' ? '继续学习' : state.phase === 'complete' ? '重新开始' : '开始学习';
    stop.hidden = !state.running;
    stop.disabled = false;
    skipped.hidden = state.skipped.length === 0;
    skippedSummary.textContent = `已跳过 ${state.skipped.length} 项 · 查看原因`;
    const skippedSignature = JSON.stringify(state.skipped);
    if (skippedSignature !== renderedSkipped) {
      renderedSkipped = skippedSignature;
      skippedList.replaceChildren(...state.skipped.map((reason) => {
        const item = document.createElement('li');
        item.textContent = reason;
        return item;
      }));
    }
  }

  async function savePreferences(update: Partial<StudyPreferences>): Promise<void> {
    if (preferencesSaving || disposed) return;
    const next = { ...state.preferences, ...update };
    preferencesSaving = true;
    pendingPreferences = next;
    preferenceFeedback = '';
    localError = '';
    render();
    try {
      await study.updatePreferences(next);
      preferenceFeedback = '学习设置已保存。';
    } catch {
      localError = '学习设置保存失败，已恢复原设置，请重试。';
    } finally {
      preferencesSaving = false;
      pendingPreferences = undefined;
      render();
    }
  }

  enable.addEventListener('change', () => {
    const enabled = enable.checked;
    localError = '';
    void context.saveSettings((current) => ({ ...current, features: { ...current.features, 'chapter-study': enabled } }))
      .catch(() => { localError = '章节学习开关保存失败，请重试。'; render(); });
  }, { signal });
  mode.addEventListener('change', () => { void savePreferences({ startMode: mode.value === 'current-forward' ? 'current-forward' : 'first-unfinished' }); }, { signal });
  videoQuiz.addEventListener('change', () => { void savePreferences({ videoQuiz: videoQuiz.value === 'ignore' ? 'ignore' : 'random' }); }, { signal });
  rate.addEventListener('change', () => { void savePreferences({ playbackRate: Number(rate.value) }); }, { signal });
  muted.addEventListener('change', () => { void savePreferences({ muted: muted.checked }); }, { signal });
  autoResume.addEventListener('change', () => { void savePreferences({ autoResume: autoResume.checked }); }, { signal });
  start.addEventListener('click', () => { localError = ''; study.start(); }, { signal });
  stop.addEventListener('click', () => { localError = ''; study.stop(); }, { signal });
  const unsubscribe = study.subscribe((value) => { state = value; render(); });
  render();
  return {
    element: root,
    update(value: Settings | undefined, pending: boolean) { settings = value; saving = pending; render(); },
    refresh() { state = study.getState(); render(); },
    dispose() { disposed = true; unsubscribe(); listeners.abort(); root.remove(); },
  };
}
