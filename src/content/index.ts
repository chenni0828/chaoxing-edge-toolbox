import { requestExtension } from '../core/extension-rpc';
import { createAiAnswerController } from '../features/ai-answer/controller';
import { generateAnswer } from '../features/ai-answer/client';
import { createEditorClient } from '../features/ai-answer/editor-client';
import type { AiAnswerController } from '../features/ai-answer/types';
import { getApiStatus, subscribeApiStatus } from '../features/api-settings/client';
import { installFloatingPanel, type FloatingPanelController } from '../features/floating-toolbox';
import { readUiPreferences, writeUiPreferences, subscribeUiPreferences } from '../features/floating-toolbox/client';
import { normalizeToolboxView } from '../features/floating-toolbox/preferences';
import { installQuestionExtraction } from '../features/question-extract/content';
import { openSettings } from '../platform/settings-navigation';
import { readSettings, subscribeSettings, writeSettings } from '../platform/storage';
import { bridgeMessage, connectIsolatedBridge } from '../shared/bridge';
import { COLLECT_QUESTIONS, OPEN_PANEL, type ExtractionResponse, type PageStatus } from '../shared/messages';
import { defaultSettings, isFeatureEnabled, type Settings } from '../shared/settings';

let settings = { ...defaultSettings(), enabled: false };
let loaded = false;
let revision = 0;
let storageEvents = 0;
let status: PageStatus = { ready: false, enabled: false, activeFeatures: [], errors: [] };
let floatingPanel: FloatingPanelController | undefined;
let ai: AiAnswerController | undefined;

function apply(next: Settings): void {
  const aiChanged = settings.enabled !== next.enabled || settings.features['ai-answer'] !== next.features['ai-answer'];
  settings = next;
  loaded = true;
  revision += 1;
  status = { ready: false, enabled: settings.enabled, activeFeatures: [], errors: [] };
  bridge.send(bridgeMessage({ kind: 'apply', revision, settings }));
  if (aiChanged) ai?.settingsChanged();
  floatingPanel?.update(settings);
}

const bridge = connectIsolatedBridge(window, (message) => {
  if (message.kind === 'editor-result') editorClient.receive(message);
  else if (message.kind === 'ready' && loaded) bridge.send(bridgeMessage({ kind: 'apply', revision, settings }));
  else if (message.kind === 'applied' && message.revision === revision && loaded) {
    const active = [...message.activeFeatures];
    if (isFeatureEnabled(settings, 'question-extract')) active.push('question-extract');
    if (isFeatureEnabled(settings, 'ai-answer')) active.push('ai-answer');
    status = { ready: true, enabled: settings.enabled, activeFeatures: active, errors: message.errors };
  }
});
const editorClient = createEditorClient(bridge);
subscribeSettings((next) => { storageEvents += 1; apply(next); });
const startEvents = storageEvents;
const initialSettings = readSettings().then((next) => {
  if (storageEvents === startEvents) apply(next);
}).catch(() => { status.errors = ['无法读取设置，请重新加载扩展并刷新页面。']; });
installQuestionExtraction(() => loaded ? settings : undefined, initialSettings);

if (window === window.top) {
  ai = createAiAnswerController({
    document,
    isEnabled: () => loaded && isFeatureEnabled(settings, 'ai-answer'),
    apiConfigured: async () => { const value = await getApiStatus(); return value.configured && value.authorized; },
    readAnswer: editorClient.readAnswer,
    writeAnswer: editorClient.writeAnswer,
    generate: generateAnswer,
  });
  floatingPanel = installFloatingPanel({
    getSettings: () => loaded ? settings : undefined,
    saveSettings: async (update) => {
      const current = await readSettings();
      const next = update(current);
      await writeSettings(next);
      if (JSON.stringify(settings) !== JSON.stringify(next)) apply(next);
    },
    extract: async () => {
      await initialSettings;
      if (!loaded || !isFeatureEnabled(settings, 'question-extract')) return { ok: false, error: '请先开启工具箱和题目提取功能。' };
      return requestExtension<ExtractionResponse>(COLLECT_QUESTIONS);
    },
    openSettings,
    getApiStatus,
    ai,
    loadUiPreferences: readUiPreferences,
    saveUiPreferences: writeUiPreferences,
    version: chrome.runtime.getManifest().version,
  });
  subscribeApiStatus(() => { ai?.settingsChanged(); floatingPanel?.update(settings); });
  subscribeUiPreferences((preferences) => floatingPanel?.updatePreferences?.(preferences));
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return;
  if (message?.type === 'toolbox:get-status') sendResponse(status);
  else if (message?.type === OPEN_PANEL && floatingPanel) {
    floatingPanel.open(normalizeToolboxView(message.view));
    sendResponse({ ok: true });
  }
});
