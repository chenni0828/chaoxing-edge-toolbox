import { AI_GENERATION_PORT } from '../api-settings/types';
import type { CurrentQuestion } from './types';

/** The content side never receives a key, model endpoint or arbitrary-fetch capability. */
export function generateAnswer(question: CurrentQuestion, signal: AbortSignal, onProgress: (text: string) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error('已取消生成。')); return; }
    let port: chrome.runtime.Port;
    let settled = false;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    const timeout = setTimeout(() => finish(undefined, '模型请求超时，请手动重试。'), 100000);
    function finish(text?: string, error?: string): void {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (heartbeat) clearInterval(heartbeat);
      signal.removeEventListener('abort', cancel);
      try { port?.disconnect(); } catch { /* The worker may have disconnected already. */ }
      if (error) reject(new Error(error));
      else resolve(text ?? '');
    }
    function cancel(): void { finish(undefined, '已取消生成。'); }
    signal.addEventListener('abort', cancel, { once: true });
    try {
      port = chrome.runtime.connect({ name: AI_GENERATION_PORT });
      port.onMessage.addListener((message: { type?: string; text?: string; error?: string }) => {
        if (settled) return;
        if (message.type === 'progress' && typeof message.text === 'string') onProgress(message.text);
        else if (message.type === 'result' && typeof message.text === 'string') finish(message.text);
        else if (message.type === 'error') finish(undefined, message.error ?? '模型生成失败，请手动重试。');
      });
      port.onDisconnect.addListener(() => {
        void chrome.runtime.lastError;
        if (!settled) finish(undefined, '生成连接已中断，请手动重试。');
      });
      port.postMessage({ type: 'generate', question });
      heartbeat = setInterval(() => {
        try { port.postMessage({ type: 'heartbeat' }); } catch { finish(undefined, '生成连接已中断。'); }
      }, 15000);
    } catch { finish(undefined, '扩展连接不可用，请刷新页面后重试。'); }
  });
}
