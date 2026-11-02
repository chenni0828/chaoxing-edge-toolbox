import { matchGlyph, pixelsToFeature } from './matching';
import { parseQuestionFont, type ParsedQuestionFont } from './sfnt';
import { resolveKnownFontCorrection } from './compatibility';

export interface QuestionFontStatus { ready: boolean; pending: boolean; error?: string; revision: number; }
export interface QuestionTextRead {
  text: string;
  pending: boolean;
  /** These are source codes from the page font, not recovered visible words. */
  unresolved: Array<{ raw: string; count: number }>;
  recognizedCount: number;
}
interface FontState {
  source: string;
  revision: number;
  parsed?: ParsedQuestionFont;
  map: Map<string, string>;
  failed: Set<string>;
  pending?: Promise<void>;
  error?: string;
}
const states = new WeakMap<Document, FontState>();
let revision = 0;
let familyId = 0;
const missingMessage = '检测到加密文字，但未找到完整的本页字体；请等待页面加载后重新读取。';
const excluded = 'script,style,textarea,input,select,[data-cx-toolbox],#cx-toolbox-root';

function documentFor(node: Node): Document { return node.nodeType === 9 ? node as Document : node.ownerDocument!; }
function protectedElement(node: Node): Element | null {
  const element = node.nodeType === 1 ? node as Element : node.parentElement;
  return element?.closest('.font-cxsecret') ?? null;
}
function sourceFor(doc: Document): string {
  // Only inline, local SFNT data is accepted. Page-supplied URLs never trigger a request.
  const styles = Array.from(doc.querySelectorAll('style')).filter(style => style.textContent?.includes('font-cxsecret'));
  const sources = new Set<string>();
  for (const style of styles) {
    for (const block of (style.textContent ?? '').matchAll(/@font-face\s*\{([^}]+)\}/gi)) {
      if (!/font-family\s*:\s*['"]?font-cxsecret['"]?\s*;/i.test(block[1])) continue;
      const source = /url\(\s*['"]?(data:[^'"\s)]+)['"]?\s*\)/i.exec(block[1])?.[1];
      if (source) sources.add(source);
    }
  }
  return sources.size === 1 ? [...sources][0] : '';
}
function protectedTextNodes(root: Node): Text[] {
  const doc = documentFor(root);
  const nodes: Text[] = [];
  if (root.nodeType === 3) return protectedElement(root) ? [root as Text] : [];
  const walker = doc.createTreeWalker(root, 4);
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (protectedElement(node) && !node.parentElement?.closest(excluded)) nodes.push(node);
  }
  return nodes;
}
function bytesFor(source: string): Uint8Array {
  const match = /^data:(?:application\/(?:font-ttf|x-font-ttf|octet-stream)|font\/(?:ttf|sfnt))(?:;charset=[\w-]+)?;base64,([a-z\d+/=]+)$/i.exec(source);
  if (!match || match[1].length > 2_700_000) throw new Error('本页加密字体格式暂不支持。');
  return Uint8Array.from(atob(match[1]), ch => ch.charCodeAt(0));
}
async function sha256(bytes: Uint8Array): Promise<string | undefined> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return undefined;
  try {
    const digest = await subtle.digest('SHA-256', Uint8Array.from(bytes).buffer);
    return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
  } catch {
    return undefined;
  }
}
function neededCharacters(nodes: Text[], state: FontState): string[] {
  const chars = new Set<string>();
  for (const node of nodes) {
    for (const char of node.data) {
      if (state.parsed?.glyphs.has(char.codePointAt(0)!) && !state.map.has(char) && !state.failed.has(char)) chars.add(char);
    }
  }
  return [...chars];
}

async function decode(doc: Document, state: FontState, bytes: Uint8Array, chars: string[], fontSha256?: string): Promise<void> {
  if (!chars.length) return;
  const win = doc.defaultView as (Window & typeof globalThis) | null;
  if (!win?.FontFace || !doc.fonts?.add) throw new Error('当前页面无法进行本地字体识别，请刷新页面后重试。');
  if (chars.length > 1024) throw new Error('本页加密字符过多，请分批读取题目。');
  const family = `cx-toolbox-font-${++familyId}`;
  const face = new win.FontFace(family, Uint8Array.from(bytes).buffer);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const canvas = doc.createElement('canvas');
  canvas.width = 640; canvas.height = 640;
  const deadline = Date.now() + 12_000;
  try {
    await Promise.race([
      face.load(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('本地字体加载超时，请重新读取。')), 6000); }),
    ]);
    doc.fonts.add(face);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('当前页面无法进行本地字体识别。');
    for (let index = 0; index < chars.length; index += 1) {
      if (states.get(doc) !== state || sourceFor(doc) !== state.source) throw new Error('页面字体已变化，请重新读取题目。');
      if (Date.now() > deadline) throw new Error('本地字体识别超时，请重新读取。');
      const char = chars[index];
      const correction = resolveKnownFontCorrection(fontSha256, char.codePointAt(0)!);
      if (correction) {
        state.map.set(char, correction);
        continue;
      }
      const glyph = state.parsed!.glyphs.get(char.codePointAt(0)!)!;
      ctx.clearRect(0, 0, 640, 640);
      ctx.fillStyle = '#fff'; ctx.font = `360px "${family}"`; ctx.textBaseline = 'alphabetic';
      ctx.fillText(char, 128, 500);
      const bits = pixelsToFeature(ctx.getImageData(0, 0, 640, 640).data, 640, 640);
      const matched = bits && matchGlyph({ bits, bounds: glyph.bounds.map(value => Math.round(value * 1000 / state.parsed!.unitsPerEm)) });
      if (matched?.character) state.map.set(char, matched.character);
      else state.failed.add(char);
      if (index % 8 === 7) await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    doc.fonts?.delete(face);
    canvas.width = 0; canvas.height = 0;
  }
}

async function preparePass(doc: Document, retryFailed: boolean, followPending: boolean): Promise<void> {
  const nodes = protectedTextNodes(doc);
  if (!nodes.length) return;
  const source = sourceFor(doc);
  let state = states.get(doc);
  if (!state || state.source !== source) {
    state = { source, revision: ++revision, map: new Map(), failed: new Set() };
    states.set(doc, state);
  }
  if (state.pending) {
    await state.pending;
    // A caller that joined an existing pass may collect newly arrived questions
    // once. It must not retry the same failed glyphs or recurse on a settled task.
    if (followPending) await preparePass(doc, false, false);
    return;
  }
  const current = state;
  if (!source) { current.error = missingMessage; return; }
  if (!retryFailed && current.error) return;
  if (retryFailed) current.failed.clear();
  current.error = undefined;
  // Defer synchronous parsing until pending is assigned. Cleanup belongs to this
  // exact task so an immediate parser failure cannot leave a settled promise cached.
  const task = Promise.resolve().then(async () => {
    try {
      const bytes = bytesFor(source);
      current.parsed ??= parseQuestionFont(bytes);
      const chars = neededCharacters(nodes, current);
      if (chars.length) await decode(doc, current, bytes, chars, await sha256(bytes));
    } catch {
      // Keep provider inputs closed; neither font data nor source URLs are shown in errors.
      current.error = '本页字体未能可靠识别；请重新读取，或在原页面核对受影响题目。';
    }
  });
  current.pending = task;
  try { await task; }
  finally {
    if (current.pending === task) { current.pending = undefined; current.revision = ++revision; }
  }
}

/** One explicit read retries failed glyphs once; concurrent callers share that pass. */
export async function prepareQuestionFont(doc: Document): Promise<void> {
  await preparePass(doc, true, true);
}

export function fontStatus(root: Node): QuestionFontStatus {
  const nodes = protectedTextNodes(root);
  if (!nodes.length) return { ready: true, pending: false, revision: 0 };
  const doc = documentFor(root); const state = states.get(doc);
  if (!state || sourceFor(doc) !== state.source) return { ready: false, pending: true, error: '正在准备本页加密文字，请稍候重新读取。', revision: state?.revision ?? 0 };
  if (state.pending) return { ready: false, pending: true, error: '正在识别本页加密文字。', revision: state.revision };
  if (!state.source || state.error || !state.parsed) return { ready: false, pending: false, error: state.error ?? missingMessage, revision: state.revision };
  for (const node of nodes) {
    for (const char of node.data) {
      if (state.failed.has(char)) return { ready: false, pending: false, error: '本题含未识别文字，可交给 AI 参考现有内容作答。', revision: state.revision };
      if (state.parsed.glyphs.has(char.codePointAt(0)!) && !state.map.has(char)) return { ready: false, pending: true, error: '本题加密文字尚未识别完成，请重新读取。', revision: state.revision };
    }
  }
  return { ready: true, pending: false, revision: state.revision };
}

/** Preserve decoded text while retaining only explicitly labelled unresolved source codes. */
export function readQuestionTextDetails(node: Node): QuestionTextRead {
  if (node.nodeType !== 3) {
    const children = Array.from(node.childNodes, readQuestionTextDetails);
    return { text: children.map(child => child.text).join(''), pending: children.some(child => child.pending),
      unresolved: children.flatMap(child => child.unresolved), recognizedCount: children.reduce((sum, child) => sum + child.recognizedCount, 0) };
  }
  const text = node.textContent ?? '';
  if (!protectedElement(node)) return { text, pending: false, unresolved: [], recognizedCount: Array.from(text).filter(char => !/\s/u.test(char)).length };
  const doc = documentFor(node);
  const state = states.get(doc);
  const current = state && state.source === sourceFor(doc);
  const parsed = current ? state.parsed : undefined;
  const result: QuestionTextRead = { text: '', pending: !current || Boolean(state.pending), unresolved: [], recognizedCount: 0 };
  let raw = '';
  const flush = () => {
    if (!raw) return;
    const count = Array.from(raw).length;
    result.unresolved.push({ raw, count });
    result.text += `〔此处 ${count} 字未识别〕`;
    raw = '';
  };
  for (const char of text) {
    const mapped = parsed ? state?.map.get(char) : undefined;
    const encrypted = parsed ? parsed.glyphs.has(char.codePointAt(0)!) : !/\s/u.test(char);
    if (!mapped && encrypted) {
      raw += char;
      if (parsed && !state?.failed.has(char) && !state?.error) result.pending = true;
    } else {
      flush();
      result.text += mapped ?? char;
      if (!/\s/u.test(char)) result.recognizedCount += 1;
    }
  }
  flush();
  return result;
}

/** Text-only facade shared with extraction/copy features. */
export function readQuestionText(node: Node): string { return readQuestionTextDetails(node).text; }
