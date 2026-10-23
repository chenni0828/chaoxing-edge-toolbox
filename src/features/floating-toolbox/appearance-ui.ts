import { readUiPreferences, resetUiPreferences, subscribeUiPreferences, writeUiPreferences } from './client';
import type { UiPreferencePatch, UiSnapshot, UiUpdate } from './preferences';

export function mountAppearanceSettings(root: HTMLElement): () => void {
  root.innerHTML = `<div class="card appearance-card">
    <div class="section-heading appearance-heading"><div><h2>悬浮框</h2><p>位置与显示状态在学习页面间同步。</p></div><span class="appearance-save-badge">自动保存</span></div>
    <div class="appearance-content">
      <div class="field appearance-mode"><div><label class="control-title" for="floating-state">显示状态</label><p id="floating-state-help" class="field-help">收起更轻巧，展开即可操作。</p></div><select id="floating-state" aria-describedby="floating-state-help" disabled><option value="minimized">收起为迷你工具栏</option><option value="expanded">展开工作区</option></select></div>
      <section class="preference-actions" aria-labelledby="floating-reset-title">
        <h3 id="floating-reset-title">恢复偏好</h3>
        <div class="preference-action"><div><p class="control-title">默认位置</p><p id="floating-position-help" class="field-help">移回页面右侧，保留当前显示状态。</p></div><button class="secondary reset-position" type="button" aria-describedby="floating-position-help" disabled>复位位置</button></div>
        <div class="preference-action"><div><p class="control-title">全部悬浮框偏好</p><p id="floating-reset-help" class="field-help">恢复位置与显示状态，保留 API 和功能开关。</p></div><button class="text-button reset-floating" type="button" aria-describedby="floating-reset-help" disabled>恢复默认</button></div>
      </section>
      <details class="appearance-help"><summary>使用提示</summary><div><p>拖动标题栏调整位置，点击展开按钮查看操作；标题栏支持方向键移动和 Home 复位。</p><p>工具箱会按当前网站显示可用功能。安装或更新后，请重新加载扩展并刷新学习页面。</p></div></details>
    </div></div>
    <div class="feedback" role="status" aria-live="polite" aria-atomic="true" hidden></div>
    <button class="secondary retry-button" type="button" hidden>重新读取设置</button>`;
  const state = root.querySelector<HTMLSelectElement>('#floating-state')!;
  const position = root.querySelector<HTMLButtonElement>('.reset-position')!;
  const reset = root.querySelector<HTMLButtonElement>('.reset-floating')!;
  const feedback = root.querySelector<HTMLElement>('.feedback')!;
  const retry = root.querySelector<HTMLButtonElement>('.retry-button')!;
  let snapshot: UiSnapshot | undefined;
  const sourceId = `options:${crypto.randomUUID()}`;
  let operationId = 0;
  let busy = false;
  let disposed = false;

  function tell(message: string, error = false): void {
    if (disposed) return;
    feedback.textContent = message;
    feedback.dataset.kind = error ? 'error' : 'success';
    feedback.hidden = false;
  }
  function render(): void {
    if (disposed) return;
    if (snapshot) {
      state.value = snapshot.preferences.minimized ? 'minimized' : 'expanded';
    }
    for (const control of [state, position, reset]) control.disabled = !snapshot || busy;
    retry.disabled = busy;
  }
  async function load(): Promise<void> {
    if (busy || disposed) return;
    busy = true;
    render();
    try {
      const latest = await readUiPreferences();
      if (disposed) return;
      applySnapshot(latest);
      retry.hidden = true;
    } catch {
      if (disposed) return;
      if (!snapshot) retry.hidden = false;
      tell('悬浮框偏好读取失败，请重试。', true);
    } finally { busy = false; render(); }
  }
  function applySnapshot(latest: UiSnapshot): void {
    if (disposed || (snapshot && latest.revision < snapshot.revision)) return;
    snapshot = latest;
    render();
  }
  async function change(patch: UiPreferencePatch | undefined, resetMode: UiUpdate['reset'], message: string): Promise<void> {
    if (busy || !snapshot || disposed) { render(); return; }
    const update: UiUpdate = { sourceId, operationId: ++operationId, baseRevision: snapshot.revision, ...(patch ? { patch } : {}) };
    busy = true;
    render();
    try {
      const result = resetMode
        ? await resetUiPreferences({ ...update, reset: resetMode })
        : await writeUiPreferences(update);
      if (disposed) return;
      applySnapshot(result.snapshot);
      tell(result.applied ? message : '悬浮框偏好已在其他页面复位，请基于最新状态重新操作。', !result.applied);
    } catch { tell('保存失败，原偏好已保留，请重试。', true); }
    finally { busy = false; render(); }
  }
  state.addEventListener('change', () => {
    const minimized = state.value === 'minimized';
    void change({ minimized }, undefined, '悬浮框显示状态已保存。');
  });
  position.addEventListener('click', () => {
    void change(undefined, 'position', '悬浮框位置已复位。');
  });
  reset.addEventListener('click', () => {
    void change(undefined, 'all', '全部悬浮框偏好已恢复默认。API 和功能开关已保留。');
  });
  const onFocus = () => { void load(); };
  const unsubscribe = subscribeUiPreferences(applySnapshot);
  window.addEventListener('focus', onFocus);
  retry.addEventListener('click', () => void load());
  void load();
  return () => { disposed = true; unsubscribe(); window.removeEventListener('focus', onFocus); };
}
