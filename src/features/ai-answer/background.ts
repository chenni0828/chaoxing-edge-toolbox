import { isSupportedContent } from '../../core/background-context';
import { requireApiConfig } from '../api-settings/background';
import { requestChatCompletion } from '../api-settings/model-client';
import { AI_GENERATION_PORT } from '../api-settings/types';
import { readStoredSettings } from '../toolbox-settings/background';
import { buildAnswerMessages } from './prompt';
import { isThinkLadderUrl } from './adapters/think-ladder';
import type { CurrentQuestion } from './types';

function isQuestion(value: unknown): value is CurrentQuestion {
  if (!value || typeof value !== 'object') return false;
  const question = value as CurrentQuestion;
  return question.type === '简答题' && typeof question.key === 'string' && question.key.length < 1000
    && typeof question.fingerprint === 'string' && question.fingerprint.length < 1000
    && typeof question.stem === 'string' && question.stem.trim().length > 0 && question.stem.length < 16000
    && typeof question.assessment === 'string' && question.assessment.length < 4000
    && Array.isArray(question.knowledgePoints) && question.knowledgePoints.length < 100
    && question.knowledgePoints.every((point) => typeof point === 'string' && point.length < 200);
}

const activeTabs = new Map<number, AbortController>();

export function installAiGenerationBroker(): void {
  chrome.tabs.onRemoved.addListener((tabId) => { activeTabs.get(tabId)?.abort(); activeTabs.delete(tabId); });
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== AI_GENERATION_PORT) return;
    const sender = port.sender;
    if (!sender || !isSupportedContent(sender) || sender.frameId !== 0 || !isThinkLadderUrl(sender.url ?? '') || sender.tab?.id === undefined) {
      port.disconnect();
      return;
    }
    const tabId = sender.tab.id;
    let started = false;
    const abort = new AbortController();
    let connected = true;
    const send = (message: Record<string, unknown>) => {
      if (connected) { try { port.postMessage(message); } catch { abort.abort(); } }
    };
    port.onDisconnect.addListener(() => { connected = false; abort.abort(); });
    port.onMessage.addListener((message: { type?: string; question?: unknown }) => {
      if (message?.type !== 'generate' || started) return;
      started = true;
      if (!isQuestion(message.question)) { send({ type: 'error', error: '当前题目格式无效，未请求 API。' }); return; }
      const question = message.question;
      void (async () => {
        try {
          if (activeTabs.has(tabId)) throw new Error('当前标签页已有生成任务，请先暂停后重试。');
          activeTabs.set(tabId, abort);
          const settings = await readStoredSettings();
          if (!settings.enabled || !settings.features['ai-answer']) throw new Error('AI 作答已关闭，请先开启功能。');
          const config = await requireApiConfig();
          if (abort.signal.aborted) return;
          const answer = await requestChatCompletion(config, buildAnswerMessages(question), abort.signal, (text) => send({ type: 'progress', text }));
          if (!abort.signal.aborted) send({ type: 'result', text: answer });
        } catch (error) {
          if (!abort.signal.aborted) send({ type: 'error', error: error instanceof Error ? error.message : '生成失败，请手动重试。' });
        } finally {
          if (activeTabs.get(tabId) === abort) activeTabs.delete(tabId);
        }
      })();
    });
  });
}
