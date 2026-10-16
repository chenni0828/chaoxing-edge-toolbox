import type { Settings } from '../toolbox-settings/types';

export interface AllowPasteViewDependencies {
  saveSettings(update: (current: Settings) => Settings): Promise<void>;
}

/** The feature owns its switch; the page workspace decides where to display it. */
export function createAllowPasteView(dependencies: AllowPasteViewDependencies) {
  const root = document.createElement('div');
  root.className = 'setting-row';
  root.innerHTML = `<div><h3 class="setting-title">允许粘贴</h3><p class="description">恢复输入框、富文本与代码编辑器的粘贴。</p></div><input type="checkbox" role="switch" class="switch" aria-label="允许粘贴" disabled>`;
  const input = root.querySelector<HTMLInputElement>('input')!;
  const onChange = () => {
    const enabled = input.checked;
    void dependencies.saveSettings((current) => ({ ...current, features: { ...current.features, 'allow-paste': enabled } }))
      .catch(() => undefined);
  };
  input.addEventListener('change', onChange);
  return {
    element: root,
    update(settings: Settings | undefined, saving: boolean): void {
      input.checked = Boolean(settings?.features['allow-paste']);
      input.disabled = !settings?.enabled || saving;
    },
    dispose(): void { input.removeEventListener('change', onChange); },
  };
}
