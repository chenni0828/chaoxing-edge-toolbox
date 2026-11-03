import { extractQuestions } from './extract';
import { prepareQuestionFont } from '../question-font';
import { EXTRACTION_PORT, type FrameExtraction } from '../../shared/messages';
import { isFeatureEnabled, type Settings } from '../../shared/settings';

/** Register extraction for this document. Frames never mount their own toolbox. */
export function installQuestionExtraction(getSettings: () => Settings | undefined, ready: Promise<void>): void {
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== EXTRACTION_PORT || (port.sender?.id && port.sender.id !== chrome.runtime.id)) return;
    let responded = false;
    let connected = true;
    const frameKey = crypto.randomUUID();
    port.onDisconnect.addListener(() => { void chrome.runtime.lastError; connected = false; });
    port.onMessage.addListener((message) => {
      if (message?.type !== 'toolbox:extract-questions' || responded) return;
      responded = true;
      void ready.then(async () => {
        let result: FrameExtraction;
        const settings = getSettings();
        try {
          if (settings && isFeatureEnabled(settings, 'question-extract')) {
            if (connected) port.postMessage({ type: 'toolbox:frame-pending', frameKey });
            await prepareQuestionFont(document);
          }
          if (!connected) return;
          const currentSettings = getSettings();
          result = !currentSettings || !isFeatureEnabled(currentSettings, 'question-extract')
            ? { type: 'toolbox:frame-result', frameKey, questions: [], error: '题目提取尚未启用。' }
            : { type: 'toolbox:frame-result', frameKey, questions: extractQuestions(document) };
        } catch {
          result = { type: 'toolbox:frame-result', frameKey, questions: [], error: '该页面结构暂不支持，未提取该框架。' };
        }
        if (connected) { try { port.postMessage(result); } catch { /* The caller closed its toolbox. */ } }
      });
    });
  });
}
