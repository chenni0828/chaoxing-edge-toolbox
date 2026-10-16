import { formatQuestions, type ExtractedQuestion } from './extract';
import { EXTRACTION_PORT, type ExtractionResponse, type FrameExtraction } from '../../shared/messages';

export function mergeFrameQuestions(frames: FrameExtraction[]): ExtractedQuestion[] {
  const seen = new Set<string>();
  const result: ExtractedQuestion[] = [];
  for (const frame of frames) {
    for (const question of frame.questions) {
      // Same question can be present in a wrapper and an inner editor frame.
      const signature = `${question.number}\n${question.type}\n${question.markdown}`;
      if (!seen.has(signature)) { seen.add(signature); result.push(question); }
    }
  }
  // Keep visible order within a document; numeric ordering also makes frame responses stable.
  return result.sort((a, b) => {
    const left = Number.parseInt(a.number, 10);
    const right = Number.parseInt(b.number, 10);
    return Number.isFinite(left) && Number.isFinite(right) ? left - right : 0;
  });
}

export async function extractFromTab(tabId: number): Promise<ExtractionResponse> {
  return new Promise((resolve) => {
    const frames = new Map<string, FrameExtraction>();
    let finished = false;
    let port: chrome.runtime.Port;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try { port?.disconnect(); } catch { /* Tab already navigated. */ }
      if (frames.size === 0) {
        resolve({ ok: false, error: '页面尚未连接。安装或重载扩展后，请刷新学习通页面再试。' });
        return;
      }
      const responses = [...frames.values()];
      const questions = mergeFrameQuestions(responses);
      const warnings = [...new Set(responses.flatMap((frame) => frame.error ? [frame.error] : []))];
      if (!questions.length && !warnings.length) warnings.push('没有识别到题目。请打开具体作业或题目页面，等待内容加载后再提取。');
      resolve({ ok: true, questions, markdown: formatQuestions(questions), frameCount: frames.size, warnings });
    };
    // Bounded snapshot; no background worker, navigation permission or persistent connection.
    const timer = setTimeout(finish, 900);
    try {
      port = chrome.tabs.connect(tabId, { name: EXTRACTION_PORT });
      port.onMessage.addListener((message: FrameExtraction) => {
        if (message?.type === 'toolbox:frame-result' && typeof message.frameKey === 'string' && Array.isArray(message.questions)) {
          frames.set(message.frameKey, message);
        }
      });
      port.onDisconnect.addListener(() => {
        // Read lastError even when the top page has no injected frame.
        void chrome.runtime.lastError;
        // Other receivers may still be live; collect until the fixed snapshot deadline.
      });
      port.postMessage({ type: 'toolbox:extract-questions' });
    } catch { finish(); }
  });
}
