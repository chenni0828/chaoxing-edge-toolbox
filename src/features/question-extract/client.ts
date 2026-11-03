import { formatQuestions, type ExtractedQuestion } from './extract';
import { EXTRACTION_PORT, type ExtractionResponse, type FrameExtraction, type FrameExtractionPending } from '../../shared/messages';

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
    const pending = new Set<string>();
    let discovered = false;
    let finished = false;
    let port: chrome.runtime.Port;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      clearTimeout(deadline);
      try { port?.disconnect(); } catch { /* Tab already navigated. */ }
      if (frames.size === 0) {
        resolve({ ok: false, error: pending.size ? '题目字体或页面读取超时，请等待加载后重新提取。'
          : '页面尚未连接。安装或重载扩展后，请刷新学习通页面再试。' });
        return;
      }
      const responses = [...frames.values()];
      const questions = mergeFrameQuestions(responses);
      const warnings = [...new Set(responses.flatMap((frame) => [
        ...(frame.error ? [frame.error] : []), ...frame.questions.flatMap(question => question.warning ? [question.warning] : []),
      ]))];
      if (pending.size) warnings.push('部分页面的字体或题目读取超时，请等待页面加载后重新提取。');
      if (!questions.length && !warnings.length) warnings.push('没有识别到题目。请打开具体作业或题目页面，等待内容加载后再提取。');
      resolve({ ok: true, questions, markdown: formatQuestions(questions), frameCount: frames.size, warnings });
    };
    // Allow announced font preparation to finish without delaying ordinary extraction.
    const timer = setTimeout(() => { discovered = true; if (!pending.size) finish(); }, 900);
    const deadline = setTimeout(finish, 15000);
    try {
      port = chrome.tabs.connect(tabId, { name: EXTRACTION_PORT });
      port.onMessage.addListener((message: FrameExtraction | FrameExtractionPending) => {
        if (finished || typeof message?.frameKey !== 'string' || message.frameKey.length > 100) return;
        if (message.type === 'toolbox:frame-pending') {
          if (!frames.has(message.frameKey)) pending.add(message.frameKey);
          return;
        }
        if (message?.type === 'toolbox:frame-result' && typeof message.frameKey === 'string' && Array.isArray(message.questions)) {
          frames.set(message.frameKey, message);
          pending.delete(message.frameKey);
          if (discovered && !pending.size) finish();
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
