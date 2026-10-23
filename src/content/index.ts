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
import { createStudyFrameClient } from '../features/chapter-study/client';
import { createStudyController } from '../features/chapter-study/controller';
import type { StudyController } from '../features/chapter-study/types';
import { getDocumentPlatform } from '../shared/sites';
import { isFeatureSupported } from '../features/catalog';
import { createZjoocStudyController } from '../features/zjooc-study/controller';
import { createZjoocStudyClient } from '../features/zjooc-study/client';
import type { ZjoocStudyController } from '../features/zjooc-study/types';

function install(): void {
  const identified = getDocumentPlatform(window);
  if (!identified || (identified.id === 'zjooc' && window !== window.top)) return;
  const platform = identified;
  let settings = { ...defaultSettings(), enabled: false };
  let loaded = false;
  let revision = 0;
  let storageEvents = 0;
  let status: PageStatus = { ready: false, enabled: false, activeFeatures: [], errors: [] };
  let floatingPanel: FloatingPanelController | undefined;
  let ai: AiAnswerController | undefined;
  let study: StudyController | undefined;
  let zjoocStudy: ZjoocStudyController | undefined;

  function apply(next: Settings): void {
    const aiChanged = settings.enabled !== next.enabled || settings.features['ai-answer'] !== next.features['ai-answer'];
    settings = next;
    loaded = true;
    revision += 1;
    status = { ready: platform.id === 'zjooc', enabled: settings.enabled,
      activeFeatures: platform.id === 'zjooc' && isFeatureEnabled(settings, 'zjooc-study') ? ['zjooc-study'] : [], errors: [] };
    bridge?.send(bridgeMessage({ kind: 'apply', revision, settings }));
    if (aiChanged) ai?.settingsChanged();
    studyClient?.settingsChanged();
    study?.settingsChanged();
    zjoocStudy?.settingsChanged();
    floatingPanel?.update(settings);
  }

  const bridge = platform.id === 'chaoxing' ? connectIsolatedBridge(window, (message) => {
    studyClient?.receive(message);
    if (message.kind === 'editor-result') editorClient?.receive(message);
    else if (message.kind === 'ready' && loaded) bridge?.send(bridgeMessage({ kind: 'apply', revision, settings }));
    else if (message.kind === 'applied' && message.revision === revision && loaded) {
      const active = message.activeFeatures.filter(id => isFeatureSupported(id, platform.id));
      if (isFeatureEnabled(settings, 'question-extract')) active.push('question-extract');
      if (isFeatureEnabled(settings, 'ai-answer')) active.push('ai-answer');
      status = { ready: true, enabled: settings.enabled, activeFeatures: active, errors: message.errors };
    }
  }) : undefined;
  const editorClient = bridge ? createEditorClient(bridge) : undefined;
  const studyClient = bridge ? createStudyFrameClient(bridge, () => loaded ? settings : undefined) : undefined;
  subscribeSettings((next) => { storageEvents += 1; apply(next); });
  const startEvents = storageEvents;
  const initialSettings = readSettings().then((next) => {
    if (storageEvents === startEvents) apply(next);
  }).catch(() => { status.errors = ['无法读取设置，请重新加载扩展并刷新页面。']; });
  if (platform.id === 'chaoxing') installQuestionExtraction(() => loaded ? settings : undefined, initialSettings);

  if (window === window.top) {
    if (platform.id === 'chaoxing' && studyClient && editorClient) {
      study = createStudyController({ document, isEnabled: () => loaded && isFeatureEnabled(settings, 'chapter-study'), runtime: studyClient.runtime });
      ai = createAiAnswerController({
        document,
        isEnabled: () => loaded && isFeatureEnabled(settings, 'ai-answer'),
        apiConfigured: async () => { const value = await getApiStatus(); return value.configured && value.authorized; },
        readAnswer: editorClient.readAnswer,
        writeAnswer: editorClient.writeAnswer,
        generate: generateAnswer,
      });
    } else if (platform.id === 'zjooc') {
      zjoocStudy = createZjoocStudyController({ document, isEnabled: () => loaded && isFeatureEnabled(settings, 'zjooc-study'), runtime: createZjoocStudyClient() });
    }
    floatingPanel = installFloatingPanel({
      platform,
      getSettings: () => loaded ? settings : undefined,
      saveSettings: async (update) => {
        const current = await readSettings();
        const next = update(current);
        await writeSettings(next);
        const stored = await readSettings();
        if (JSON.stringify(settings) !== JSON.stringify(stored)) apply(stored);
      },
      extract: async () => {
        await initialSettings;
        if (platform.id !== 'chaoxing' || !loaded || !isFeatureEnabled(settings, 'question-extract')) return { ok: false, error: '请在学习通开启工具箱和题目提取功能。' };
        return requestExtension<ExtractionResponse>(COLLECT_QUESTIONS);
      },
      openSettings,
      getApiStatus,
      ai,
      study,
      zjoocStudy,
      loadUiPreferences: readUiPreferences,
      saveUiPreferences: writeUiPreferences,
      version: chrome.runtime.getManifest().version,
    });
    if (platform.id === 'chaoxing') subscribeApiStatus(() => { ai?.settingsChanged(); floatingPanel?.update(settings); });
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
}

install();
