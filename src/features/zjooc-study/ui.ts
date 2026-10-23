import type { WorkspaceContext, WorkspaceView } from '../workspace-registry';
import type { Settings } from '../toolbox-settings/types';
import type { ZjoocStudyPhase } from './types';

const phaseLabels: Record<ZjoocStudyPhase, string> = {
  disabled: '未启用', unsupported: '等待课程', waiting: '等待页面', running: '学习中',
  confirming: '等待确认', paused: '已暂停', complete: '处理结束',
};

/** The controller owns playback, navigation and completion; this view only exposes public state. */
export function createZjoocStudyView(context: WorkspaceContext): WorkspaceView {
  const controller = context.zjoocStudy;
  if (!controller) throw new Error('Missing Zjooc study controller');
  const listeners = new AbortController();
  const root = document.createElement('section');
  root.className = 'feature-view zjooc-study-view';
  root.setAttribute('aria-label', '浙学章节学习');
  root.innerHTML = `
    <div class="zjooc-heading"><h3 class="section-title">章节学习</h3><span class="phase-badge" data-zjooc-phase></span></div>
    <label class="setting-row zjooc-enable"><span><span class="setting-title">启用自动学习</span><span class="description">自动播放视频，使用平台最高倍速。</span></span><input type="checkbox" role="switch" class="switch" aria-label="启用浙学自动学习" disabled></label>
    <div class="zjooc-progress">
      <p class="zjooc-project"></p><p class="zjooc-chapter"></p><p class="zjooc-resource"></p>
      <p class="zjooc-rate"></p><p class="zjooc-message" role="status" aria-live="polite" aria-atomic="true"></p>
      <div class="zjooc-progress-footer"><p class="zjooc-count"><span data-zjooc-count="confirmed"></span> · <span data-zjooc-count="pending"></span> · <span data-zjooc-count="manual"></span></p><button class="button primary" type="button" data-zjooc-action="start">开始学习</button><button class="button" type="button" data-zjooc-action="stop" hidden>暂停</button></div>
    </div>
    <details class="zjooc-pending" hidden><summary></summary><ul></ul></details>
    <details class="zjooc-skipped" hidden><summary></summary><ul></ul></details>
  `;
  const find = <T extends HTMLElement>(selector: string): T => root.querySelector<T>(selector)!;
  const enable = find<HTMLInputElement>('.zjooc-enable input');
  const phase = find<HTMLElement>('[data-zjooc-phase]');
  const project = find<HTMLElement>('.zjooc-project');
  const chapter = find<HTMLElement>('.zjooc-chapter');
  const resource = find<HTMLElement>('.zjooc-resource');
  const rate = find<HTMLElement>('.zjooc-rate');
  const message = find<HTMLElement>('.zjooc-message');
  const confirmedCount = find<HTMLElement>('[data-zjooc-count="confirmed"]');
  const pendingCount = find<HTMLElement>('[data-zjooc-count="pending"]');
  const manualCount = find<HTMLElement>('[data-zjooc-count="manual"]');
  const start = find<HTMLButtonElement>('[data-zjooc-action="start"]');
  const stop = find<HTMLButtonElement>('[data-zjooc-action="stop"]');
  const pending = find<HTMLDetailsElement>('.zjooc-pending');
  const pendingSummary = find<HTMLElement>('.zjooc-pending summary');
  const pendingList = find<HTMLElement>('.zjooc-pending ul');
  const skipped = find<HTMLDetailsElement>('.zjooc-skipped');
  const skippedSummary = find<HTMLElement>('.zjooc-skipped summary');
  const skippedList = find<HTMLElement>('.zjooc-skipped ul');
  let settings = context.getSettings();
  let state = controller.getState();
  let saving = false;
  let localSaving = false;
  let localError = '';
  let disposed = false;
  let pendingEnableStart = false;
  let enableRequest = 0;
  let renderedPending = '';
  let renderedSkipped = '';

  function startAfterEnable(): void {
    if (!pendingEnableStart || disposed || saving || localSaving) return;
    const current = context.getSettings();
    if (current && !current.enabled) pendingEnableStart = false;
    if (!current?.enabled || !current.features['zjooc-study']) return;
    pendingEnableStart = false;
    controller!.start();
  }

  function renderReasons(list: HTMLElement, reasons: string[]): void {
    list.replaceChildren(...reasons.map(reason => {
      const item = document.createElement('li');
      item.textContent = reason;
      return item;
    }));
  }

  function render(): void {
    if (disposed) return;
    const enabled = Boolean(settings?.enabled && settings.features['zjooc-study']);
    phase.textContent = phaseLabels[state.phase];
    phase.dataset.phase = state.phase;
    enable.checked = Boolean(settings?.features['zjooc-study']);
    enable.disabled = !settings?.enabled || saving || localSaving;
    project.textContent = state.projectTitle;
    project.hidden = !state.projectTitle;
    chapter.textContent = state.chapterTitle || '等待识别当前小节';
    resource.textContent = state.resourceTitle ? `当前任务 · ${state.resourceTitle}` : '';
    resource.hidden = !state.resourceTitle;
    rate.textContent = state.playbackRate === undefined ? '' : `当前倍速 · ${state.playbackRate} 倍`;
    rate.hidden = state.playbackRate === undefined;
    message.textContent = localError || (!settings ? '正在读取工具箱设置…'
      : !settings.enabled ? '工具箱已暂停，请先启用工具箱。'
        : !enabled ? '启用后，从首个未完成内容学习至课程最后一节。' : state.message);
    message.dataset.kind = localError ? 'error' : 'info';
    confirmedCount.textContent = `已确认 ${state.completed} 项`;
    pendingCount.textContent = `待平台确认 ${state.pendingConfirmation.length} 项`;
    manualCount.textContent = `需手动 ${state.skipped.length} 项`;
    start.hidden = state.running;
    start.disabled = !enabled || saving || localSaving || state.phase === 'unsupported';
    start.textContent = state.phase === 'paused' ? '继续学习' : state.phase === 'complete' ? '重新检查' : '开始学习';
    stop.hidden = !state.running;
    pending.hidden = state.pendingConfirmation.length === 0;
    pendingSummary.textContent = `待平台确认 ${state.pendingConfirmation.length} 项`;
    const pendingSignature = JSON.stringify(state.pendingConfirmation);
    if (pendingSignature !== renderedPending) {
      renderedPending = pendingSignature;
      renderReasons(pendingList, state.pendingConfirmation);
    }
    skipped.hidden = state.skipped.length === 0;
    skippedSummary.textContent = `需手动 ${state.skipped.length} 项 · 处理后继续`;
    const signature = JSON.stringify(state.skipped);
    if (signature !== renderedSkipped) {
      renderedSkipped = signature;
      renderReasons(skippedList, state.skipped);
    }
  }

  enable.addEventListener('change', () => {
    if (saving || localSaving || !settings?.enabled) { render(); return; }
    const enabled = enable.checked;
    const request = ++enableRequest;
    pendingEnableStart = false;
    localSaving = true;
    localError = '';
    render();
    void context.saveSettings(current => ({ ...current, features: { ...current.features, 'zjooc-study': enabled } }))
      .then(() => {
        if (disposed || request !== enableRequest) return;
        settings = context.getSettings();
        pendingEnableStart = enabled;
      })
      .catch(() => { localError = '自动学习开关保存失败，请重试。'; })
      .finally(() => { localSaving = false; startAfterEnable(); render(); });
  }, { signal: listeners.signal });
  start.addEventListener('click', () => {
    if (start.disabled || disposed) return;
    enableRequest++;
    pendingEnableStart = false;
    localError = '';
    controller.start(state.phase === 'complete');
  }, { signal: listeners.signal });
  stop.addEventListener('click', () => { enableRequest++; pendingEnableStart = false; localError = ''; controller.stop(); }, { signal: listeners.signal });
  const unsubscribe = controller.subscribe(value => { state = value; render(); });
  render();
  return {
    element: root,
    update(value: Settings | undefined, savingSettings: boolean) {
      settings = value;
      saving = savingSettings;
      if (value && !value.enabled) { enableRequest++; pendingEnableStart = false; }
      startAfterEnable();
      render();
    },
    refresh() { state = controller.getState(); startAfterEnable(); render(); },
    dispose() { disposed = true; enableRequest++; pendingEnableStart = false; unsubscribe(); listeners.abort(); root.remove(); },
  };
}
