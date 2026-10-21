import type { AiAnswerController } from '../ai-answer/types';
import type { ApiStatus } from '../api-settings/types';
import type { StudyController } from '../chapter-study/types';
import { WORKSPACES, getDefaultWorkspace, workspaceStyles } from '../workspace-registry';
import type { ExtractionResponse } from '../../shared/messages';
import type { Settings } from '../../shared/settings';
import type { SettingsSection } from '../../platform/settings-navigation';
import { observePageContext, readPageContext } from '../../platform/page-context';
import { icon } from './icons';
import { TOOLBOX_LAYOUT } from './layout';
import { installFloatingContainer } from './container';
import { normalizeToolboxView, type ToolboxView, type ToolboxViewRequest, type UiSnapshot, type UiUpdate, type UiWriteResult } from './preferences';
import { toolboxStyles } from './styles';

export interface FloatingPanelDependencies {
  getSettings(): Settings | undefined;
  saveSettings(update: (current: Settings) => Settings): Promise<void>;
  extract(): Promise<ExtractionResponse>;
  openSettings(section?: SettingsSection): Promise<void>;
  getApiStatus(): Promise<ApiStatus>;
  ai: AiAnswerController;
  study: StudyController;
  loadUiPreferences(): Promise<UiSnapshot>;
  saveUiPreferences(value: UiUpdate): Promise<UiWriteResult>;
  version: string;
}

export interface FloatingPanelController {
  update(settings: Settings): void;
  updatePreferences(preferences: UiSnapshot): void;
  open(view?: ToolboxViewRequest): void;
  dispose(): void;
}

let activePanel: FloatingPanelController | undefined;

/** Layout/navigation only. Each feature owns its own UI and transient data. */
export function installFloatingPanel(dependencies: FloatingPanelDependencies): FloatingPanelController {
  if (activePanel) return activePanel;
  const listeners = new AbortController();
  const { signal } = listeners;
  const host = document.createElement('div');
  host.id = 'cx-toolbox-root';
  host.dataset.cxToolbox = 'floating';
  for (const [name, value] of Object.entries({
    all: 'initial', position: 'fixed', display: 'block', 'z-index': '2147483646',
    margin: '0', padding: '0', border: '0', transform: 'none', direction: 'ltr',
    'text-align': 'left', 'color-scheme': 'light',
    width: `min(${TOOLBOX_LAYOUT.compactWidth}px, calc(100vw - 24px))`,
    height: 'auto',
  })) host.style.setProperty(name, value, 'important');
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = [toolboxStyles, workspaceStyles].join('\n');
  const root = document.createElement('div');
  root.innerHTML = `
    <section class="panel" role="region" aria-label="学习通工具箱">
      <header class="header" data-drag-handle tabindex="0" aria-label="拖动工具箱，方向键移动，Home 复位位置" title="拖动标题栏 · 方向键移动 · Home 复位">
        <div class="brand">${icon('logo', 18)}<h2 class="header-title">工具箱</h2><span class="header-version"></span></div>
        <span class="drag-grip" aria-hidden="true">${icon('grip', 12)}</span>
        <button class="icon-button" data-action="toggle" type="button" aria-controls="cx-toolbox-workspace" aria-expanded="false" aria-label="展开工具箱" title="展开工具箱">${icon('expand', 14)}</button>
      </header>
      <div class="drawer">
        <div class="toolbox-navigation" role="group" aria-label="工具箱快捷导航">
          <button class="toolbox-action" data-action="paste" type="button" title="允许粘贴" aria-label="切换允许粘贴" aria-pressed="false" disabled>${icon('paste', 16)}</button>
          <nav class="toolbox-tabs" role="tablist" aria-label="工具箱功能">${WORKSPACES.map((workspace) => `<button id="cx-tab-${workspace.id}" class="toolbox-tab" role="tab" aria-controls="cx-view-${workspace.id}" data-view="${workspace.id}" type="button" title="${workspace.title}" aria-label="打开${workspace.title}">${icon(workspace.icon, 16)}<span class="tab-label">${workspace.title}</span></button>`).join('')}</nav>
          <button class="toolbox-action" data-action="settings" type="button" title="全局设置" aria-label="打开全局设置">${icon('settings', 16)}</button>
        </div>
        <div class="body" id="cx-toolbox-workspace" hidden>
          <div class="status-row"><span class="eyebrow" data-status role="status" aria-live="polite">正在读取设置…</span><label class="switch-label"><span>启用工具箱</span><input type="checkbox" role="switch" class="switch" data-setting="enabled" aria-label="启用工具箱" disabled></label></div>
          <div data-workspaces></div>
          <p class="shell-message" role="status" aria-live="polite" hidden></p>
          <footer class="footer"><p class="privacy-note">题目与回答仅保留在本页内存。</p><button class="icon-button" data-action="reset" type="button" title="复位位置" aria-label="复位工具箱位置">${icon('reset')}</button></footer>
        </div>
        <div class="mini"><p class="mini-notice" role="status" aria-live="polite" hidden></p></div>
      </div>
    </section>`;
  shadow.append(style, root);
  const find = <T extends HTMLElement>(selector: string): T => {
    const value = root.querySelector<T>(selector);
    if (!value) throw new Error(`Missing toolbox element: ${selector}`);
    return value;
  };
  const body = find<HTMLElement>('.body');
  const mini = find<HTMLElement>('.mini');
  const header = find<HTMLElement>('.header');
  const drawer = find<HTMLElement>('.drawer');
  const toggle = find<HTMLButtonElement>('[data-action="toggle"]');
  const master = find<HTMLInputElement>('[data-setting="enabled"]');
  const pasteShortcut = find<HTMLButtonElement>('[data-action="paste"]');
  const status = find<HTMLElement>('[data-status]');
  const notice = find<HTMLElement>('.shell-message');
  const miniNotice = find<HTMLElement>('.mini-notice');
  const aiIcon = find<HTMLButtonElement>('[data-view="answer"]');
  find('.header-version').textContent = `v${dependencies.version}`;
  let settings = dependencies.getSettings();
  let minimized = true;
  let pageContext = readPageContext(document);
  let activeView = getDefaultWorkspace(location.href);
  let workspaceSelected = false;
  let saving = false;
  let disposed = false;
  let settingsRevision = 0;
  let observer: MutationObserver | undefined;
  let renderedMinimized: boolean | undefined;
  let renderedView: ToolboxView | undefined;
  let drawerAnimation: Animation | undefined;

  function tell(text: string, error = false): void {
    if (disposed) return;
    notice.textContent = text;
    notice.dataset.kind = error ? 'error' : 'success';
    notice.hidden = !text;
    miniNotice.textContent = text;
    miniNotice.style.color = error ? '#b91c1c' : '#0f766e';
    miniNotice.hidden = !text;
  }

  async function saveSettings(update: (current: Settings) => Settings): Promise<void> {
    if (!settings || saving || disposed) throw new Error('设置暂未就绪，请稍后重试。');
    const previous = settings;
    const startRevision = settingsRevision;
    settings = update(settings);
    saving = true;
    tell('');
    render();
    try {
      await dependencies.saveSettings(update);
      settings = dependencies.getSettings() ?? settings;
      tell('设置已保存。');
    } catch (error) {
      if (settingsRevision === startRevision) settings = previous;
      tell('设置保存失败，已保留原设置。', true);
      throw error;
    } finally { saving = false; render(); }
  }

  const views = WORKSPACES.map((workspace) => ({ id: workspace.id, view: workspace.create({
    getSettings: () => settings, saveSettings, extract: dependencies.extract,
    getApiStatus: dependencies.getApiStatus, openSettings: dependencies.openSettings, ai: dependencies.ai, study: dependencies.study,
  }) }));
  for (const { id, view } of views) {
    view.element.id = `cx-view-${id}`;
    view.element.setAttribute('role', 'tabpanel');
    view.element.setAttribute('aria-labelledby', `cx-tab-${id}`);
    find('[data-workspaces]').append(view.element);
  }
  const container = installFloatingContainer({
    host, surface: find('.panel'), content: drawer,
    handles: [...root.querySelectorAll<HTMLElement>('[data-drag-handle]')],
    persistence: { read: dependencies.loadUiPreferences, write: dependencies.saveUiPreferences },
    onModeChange(value) { minimized = value; render(); },
    onError: message => tell(message, true),
  });

  function render(): void {
    if (disposed) return;
    const modeChanged = renderedMinimized !== undefined && renderedMinimized !== minimized;
    const viewChanged = renderedView !== activeView;
    body.hidden = minimized;
    mini.hidden = !minimized;
    if (renderedMinimized !== minimized) {
      toggle.innerHTML = icon(minimized ? 'expand' : 'minimize', 14);
      toggle.setAttribute('aria-expanded', String(!minimized));
      toggle.setAttribute('aria-label', minimized ? '展开工具箱' : '缩小工具箱');
      toggle.title = minimized ? '展开工具箱' : '缩小为迷你工具栏';
    }
    renderedMinimized = minimized;
    master.checked = Boolean(settings?.enabled);
    master.disabled = !settings || saving;
    pasteShortcut.disabled = !settings?.enabled || saving;
    pasteShortcut.setAttribute('aria-pressed', String(Boolean(settings?.enabled && settings.features['allow-paste'])));
    pasteShortcut.title = settings?.enabled && settings.features['allow-paste'] ? '允许粘贴：已开启' : '允许粘贴：已关闭';
    status.textContent = saving ? '正在保存…' : !settings ? '正在读取设置…' : settings.enabled ? '工具箱已开启' : '工具箱已暂停';
    status.dataset.state = saving ? 'saving' : !settings ? 'loading' : settings.enabled ? 'enabled' : 'paused';
    for (const tab of root.querySelectorAll<HTMLButtonElement>('[data-view]')) {
      const descriptor = WORKSPACES.find((workspace) => workspace.id === tab.dataset.view)!;
      const title = descriptor.titleOnPage?.(pageContext) ?? descriptor.title;
      tab.querySelector<HTMLElement>('.tab-label')!.textContent = title;
      tab.title = title;
      tab.setAttribute('aria-label', `打开${title}`);
      const selected = tab.dataset.view === activeView;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    }
    for (const { id, view } of views) { view.element.hidden = activeView !== id; view.updatePage?.(pageContext); view.update(settings, saving); }
    if (viewChanged) body.scrollTop = 0;
    renderedView = activeView;
    if (modeChanged) {
      drawerAnimation?.cancel();
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches && typeof drawer.animate === 'function') {
        // Animate only the incoming workspace; the shared title never transforms.
        drawerAnimation = drawer.animate([
          { opacity: 0, transform: 'translateY(-6px)' },
          { opacity: 1, transform: 'translateY(0)' },
        ], { duration: 180, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' });
      }
    }
  }

  function open(view?: ToolboxViewRequest, focus = true): void {
    if (disposed) return;
    const requested = normalizeToolboxView(view);
    if (requested) { activeView = requested; workspaceSelected = true; }
    mount();
    render();
    container.setMode(false);
    views.find((workspace) => workspace.id === activeView)?.view.refresh?.();
    if (focus) header.focus({ preventScroll: true });
  }

  function minimize(): void {
    container.setMode(true);
    toggle.focus({ preventScroll: true });
  }

  function togglePaste(): void {
    if (!settings?.enabled || saving) return;
    void saveSettings((current) => ({ ...current, features: { ...current.features, 'allow-paste': !current.features['allow-paste'] } })).catch(() => undefined);
  }
  root.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;
    const target = event.target.closest<HTMLButtonElement>('button');
    if (!target || target.disabled) return;
    const requestedTab = WORKSPACES.find((workspace) => workspace.id === target.dataset.view);
    if (requestedTab) open(requestedTab.id, false);
    if (target.dataset.action === 'toggle') { if (minimized) open(); else minimize(); }
    if (target.dataset.action === 'reset') container.resetPosition();
    if (target.dataset.action === 'paste') togglePaste();
    if (target.dataset.action === 'settings') {
      void dependencies.openSettings('features').catch(() => tell('无法打开全局设置，请重新加载扩展。', true));
    }
  }, { signal });
  master.addEventListener('change', () => {
    const enabled = master.checked;
    void saveSettings((current) => ({ ...current, enabled })).catch(() => undefined);
  }, { signal });
  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !minimized) { event.preventDefault(); event.stopPropagation(); minimize(); }
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.matches('[role="tab"]')) return;
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const current = WORKSPACES.findIndex((workspace) => workspace.id === activeView);
    const direction = event.key === 'ArrowRight' ? 1 : -1;
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? WORKSPACES.length - 1 : (current + direction + WORKSPACES.length) % WORKSPACES.length;
    const view = WORKSPACES[index].id;
    open(view, false);
    root.querySelector<HTMLButtonElement>(`[data-view="${view}"]`)?.focus({ preventScroll: true });
  }, { signal });
  window.addEventListener('popstate', () => {
    pageContext = readPageContext(document);
    if (!workspaceSelected && !dependencies.ai.getState().running && !dependencies.study.getState().running) activeView = getDefaultWorkspace(location.href);
    render();
  }, { signal });
  const unsubscribeAi = dependencies.ai.subscribe((state) => { aiIcon.dataset.running = String(state.running); });
  const unsubscribePage = observePageContext(document, (context) => {
    pageContext = context;
    if (!workspaceSelected && !dependencies.ai.getState().running && !dependencies.study.getState().running) activeView = getDefaultWorkspace(location.href);
    render();
  });

  function mount(): void {
    if (disposed || host.isConnected || !document.body) return;
    document.body.append(host);
    observer?.disconnect();
    render();
    container.layout();
  }
  const controller: FloatingPanelController = {
    update(value) { if (!disposed) { settingsRevision += 1; settings = value; render(); for (const { view } of views) view.refresh?.(); } },
    updatePreferences(value) {
      if (disposed) return;
      container.applySnapshot(value);
    },
    open,
    dispose() {
      if (disposed) return;
      disposed = true;
      listeners.abort();
      observer?.disconnect();
      unsubscribeAi();
      unsubscribePage();
      drawerAnimation?.cancel();
      container.dispose();
      for (const { view } of views) view.dispose();
      host.remove();
      if (activePanel === controller) activePanel = undefined;
    },
  };
  activePanel = controller;
  if (document.body) mount();
  else {
    observer = new MutationObserver(mount);
    observer.observe(document.documentElement ?? document, { childList: true, subtree: true });
    document.addEventListener('DOMContentLoaded', mount, { once: true, signal });
  }
  return controller;
}
