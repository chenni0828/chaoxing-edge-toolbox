import { readUiPreferences, resetUiPreferences, writeUiPreferences } from './client';
import { defaultUiPreferences, type UiPreferences } from './preferences';

export function mountAppearanceSettings(root: HTMLElement): () => void {
  root.innerHTML = `<div class="card">
    <div class="section-heading"><h2>悬浮框设置</h2><p>位置和缩小状态会自动记忆。思维阶梯默认打开“答题”，其他页面打开对应辅助页：作业、思维阶梯或页面工具；手动切换仅保留在本页。</p></div>
    <div class="settings-form">
      <div class="field"><label for="floating-state">显示状态</label><select id="floating-state" disabled><option value="minimized">缩小为迷你工具栏</option><option value="expanded">展开工作区</option></select><p class="field-help">迷你工具栏上排可拖动，下排图标可快速切换功能。</p></div>
      <div class="button-row"><button class="secondary reset-position" type="button" disabled>复位位置</button><button class="text-button reset-floating" type="button" disabled>重置全部悬浮框偏好</button></div>
      <p class="field-help">复位位置保留显示状态；重置全部仅恢复悬浮框默认值，不影响本页工作区、API 或功能开关。AI 作答刷新后保持暂停。</p>
    </div></div>
    <div class="feedback" role="status" aria-live="polite" aria-atomic="true" hidden></div>
    <button class="secondary retry-button" type="button" hidden>重新读取设置</button>`;
  const state = root.querySelector<HTMLSelectElement>('#floating-state')!;
  const position = root.querySelector<HTMLButtonElement>('.reset-position')!;
  const reset = root.querySelector<HTMLButtonElement>('.reset-floating')!;
  const feedback = root.querySelector<HTMLElement>('.feedback')!;
  const retry = root.querySelector<HTMLButtonElement>('.retry-button')!;
  let preferences: UiPreferences | undefined;
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
    if (preferences) {
      state.value = preferences.minimized ? 'minimized' : 'expanded';
    }
    for (const control of [state, position, reset]) control.disabled = !preferences || busy;
    retry.disabled = busy;
  }
  async function load(): Promise<void> {
    if (busy || disposed) return;
    busy = true;
    render();
    try {
      preferences = await readUiPreferences();
      retry.hidden = true;
    } catch {
      if (!preferences) retry.hidden = false;
      tell('悬浮框偏好读取失败，请重试。', true);
    } finally { busy = false; render(); }
  }
  async function change(update: (current: UiPreferences) => UiPreferences, message: string): Promise<void> {
    if (busy || !preferences || disposed) { render(); return; }
    busy = true;
    render();
    try {
      // Read immediately before changing one field, preserving recent page drags.
      const latest = await readUiPreferences();
      const next = update(latest);
      await writeUiPreferences(next);
      preferences = next;
      tell(message);
    } catch { tell('保存失败，原偏好已保留，请重试。', true); }
    finally { busy = false; render(); }
  }
  state.addEventListener('change', () => {
    const minimized = state.value === 'minimized';
    void change(current => ({ ...current, minimized }), '悬浮框显示状态已保存。');
  });
  position.addEventListener('click', () => {
    const defaults = defaultUiPreferences();
    void change(current => ({ ...current, x: defaults.x, y: defaults.y }), '悬浮框位置已复位。');
  });
  reset.addEventListener('click', () => {
    if (reset.disabled || disposed) return;
    busy = true;
    render();
    void (async () => {
      try {
        await resetUiPreferences();
        preferences = await readUiPreferences();
        tell('全部悬浮框偏好已恢复默认。API 和功能开关已保留。');
      } catch { tell('重置失败，请重新读取偏好后重试。', true); }
      finally { busy = false; render(); }
    })();
  });
  const onFocus = () => { void load(); };
  window.addEventListener('focus', onFocus);
  retry.addEventListener('click', () => void load());
  void load();
  return () => { disposed = true; window.removeEventListener('focus', onFocus); };
}
