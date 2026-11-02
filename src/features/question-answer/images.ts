import type { PreparedQuestion, QuestionSnapshot } from './types';
import { imageAddress } from './adapters/chaoxing';
import { questionOptionsText } from './normalize';

const MAX_IMAGE_BYTES = 2_900_000;
const MAX_TOTAL_CHARACTERS = 12_000_000;

function aborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('图片准备已取消。', 'AbortError');
}
function mediaType(bytes: Uint8Array): string | undefined {
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 13 && bytes[5] === 10 && bytes[6] === 26 && bytes[7] === 10) return 'image/png';
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  const prefix = String.fromCharCode(...bytes.slice(0, 12));
  if (/^GIF8[79]a/.test(prefix)) return 'image/gif';
  if (prefix.startsWith('RIFF') && prefix.slice(8) === 'WEBP') return 'image/webp';
  return undefined;
}
function dataUrl(win: Window, bytes: Uint8Array): string {
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error('题目图片为空或超过大小上限。');
  const type = mediaType(bytes);
  if (!type) throw new Error('题目图片格式不受支持，未发送该题。');
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return `data:${type};base64,${win.btoa(binary)}`;
}
function validateDataUrl(win: Window, value: string): string {
  const match = /^data:image\/(?:png|jpeg|webp|gif);base64,([a-z\d+/=]+)$/i.exec(value);
  if (!match || value.length > 4_000_000) throw new Error('题目图片数据无效或过大。');
  let binary: string;
  try { binary = win.atob(match[1]); } catch { throw new Error('题目图片数据无效。'); }
  return dataUrl(win, Uint8Array.from(binary, char => char.charCodeAt(0)));
}

async function currentImage(win: Window, root: Element, address: string, signal: AbortSignal): Promise<string> {
  aborted(signal);
  const elements = Array.from(root.querySelectorAll<HTMLImageElement>('img')).filter(image => imageAddress(image) === address);
  if (!elements.length) throw new Error('题目图片已变化，请重新扫描。');
  if (address.startsWith('data:')) return validateDataUrl(win, address);
  // An already loaded image can be read without another authenticated request.
  for (const image of elements) {
    if (!image.complete || !image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 20_000_000) continue;
    try {
      const canvas = win.document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d');
      if (!context) continue;
      context.drawImage(image, 0, 0);
      const result = validateDataUrl(win, canvas.toDataURL('image/png'));
      aborted(signal);
      return result;
    } catch { aborted(signal); /* A cross-origin image may taint the canvas. */ }
  }
  const url = new URL(address);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('题目图片地址不受支持。');
  let response: Response;
  try {
    response = await win.fetch(url.href, { signal, credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', cache: 'force-cache' });
  } catch { aborted(signal); throw new Error('无法读取题目图片，请确认图片已加载；未降级为纯文字答题。'); }
  if (!response.ok || Number(response.headers.get('content-length') ?? '0') > MAX_IMAGE_BYTES) throw new Error('题目图片读取失败或超过大小上限。');
  // Enforce the cap while receiving; a missing/incorrect Content-Length is not trusted.
  const reader = response.body?.getReader();
  if (!reader) throw new Error('题目图片响应为空。');
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      aborted(signal);
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > MAX_IMAGE_BYTES) throw new Error('题目图片超过大小上限。');
      chunks.push(next.value);
    }
  } finally { await reader.cancel().catch(() => undefined); }
  aborted(signal);
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return dataUrl(win, bytes);
}

/** All images or an error. Never return a partially illustrated question. */
export async function prepareQuestionImages(win: Window, root: Element, question: QuestionSnapshot, signal: AbortSignal): Promise<PreparedQuestion> {
  if (question.images.length > 16 || new Set(question.images).size !== question.images.length) throw new Error('题目图片数量或编号无效。');
  const images: string[] = [];
  let total = 0;
  for (const address of question.images) {
    const image = await currentImage(win, root, address, signal);
    aborted(signal);
    total += image.length;
    if (total > MAX_TOTAL_CHARACTERS) throw new Error('本题图片总量超过上限，未发送该题。');
    images.push(image);
  }
  aborted(signal);
  return { question, images, suggestionTitle: question.stem, suggestionOptions: questionOptionsText(question) };
}
