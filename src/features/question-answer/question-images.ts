import { QUESTION_MARKDOWN_LIMIT, type QuestionSnapshot } from './types';

const MAX_IMAGES = 16;
const MAX_DATA_LENGTH = 4_000_000;
const MAX_TOTAL_DATA_LENGTH = 12_000_000;

function rasterDataUrl(value: string, doc: Document): boolean {
  if (value.length > MAX_DATA_LENGTH) return false;
  const match = /^data:image\/(png|jpeg|webp|gif);base64,([a-z\d+/]+={0,2})$/i.exec(value);
  if (!match || match[2].length % 4 !== 0) return false;
  let header: string;
  try { header = (doc.defaultView?.atob.bind(doc.defaultView) ?? atob)(match[2].slice(0, 32)); }
  catch { return false; }
  switch (match[1].toLowerCase()) {
    case 'png': return header.startsWith('\x89PNG\r\n\x1a\n');
    case 'jpeg': return header.charCodeAt(0) === 0xff && header.charCodeAt(1) === 0xd8 && header.charCodeAt(2) === 0xff;
    case 'gif': return /^GIF8[79]a/.test(header);
    case 'webp': return header.startsWith('RIFF') && header.slice(8, 12) === 'WEBP';
    default: return false;
  }
}

function safeImageSource(address: string, doc: Document): string | undefined {
  const value = address.trim();
  if (/^data:/i.test(value)) return rasterDataUrl(value, doc) ? value : undefined;
  if (value.length > 4096) return;
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password) return;
    // Remote images are rendered as images only; known SVG destinations are excluded as well.
    if (/\.svgz?(?:\/|$)/i.test(decodeURIComponent(url.pathname))) return;
    for (const name of ['format', 'type', 'mime']) {
      if (/^(?:image\/)?svgz?(?:\+xml)?$/i.test(url.searchParams.get(name) ?? '')) return;
    }
    return url.href;
  } catch { return; }
}

/** Only the extractor's image-link syntax is read, never HTML or executable Markdown. */
function markdownImageSources(markdown: string | undefined): string[] {
  if (!markdown || markdown.length > QUESTION_MARKDOWN_LIMIT) return [];
  const result: string[] = [];
  let fence = '';
  for (const line of markdown.split('\n')) {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length && /^\s{0,3}[`~]+\s*$/.test(line)) fence = '';
      continue;
    }
    if (fence) continue;
    const withoutCode = line.replace(/(`+).*?\1/g, '');
    for (const match of withoutCode.matchAll(/(?<!\\)!\[(?:\\.|[^\]\\])*\]\(\s*(?:<([^<>\r\n]+)>|([^\s()<>]+))\s*\)/g)) {
      const value = match[1] ?? match[2];
      if (!result.includes(value)) result.push(value);
      if (result.length > MAX_IMAGES) return result;
    }
  }
  return result;
}

/** Present question-owned images without reading controls, fetching in code, or rendering source HTML. */
export function createQuestionImages(question: QuestionSnapshot, doc: Document = document): HTMLElement | undefined {
  const sources = question.images.length ? question.images : markdownImageSources(question.markdown);
  if (!sources.length) return;
  const root = doc.createElement('section');
  root.className = 'answer-question-images';
  root.setAttribute('aria-label', '题目图片');
  let totalDataLength = 0;
  sources.slice(0, MAX_IMAGES).forEach((address, index) => {
    const label = `[图片${index + 1}]`;
    const figure = doc.createElement('figure');
    figure.className = 'answer-question-image';
    const caption = doc.createElement('figcaption');
    caption.className = 'answer-image-caption';
    caption.textContent = label;
    const failure = doc.createElement('p');
    failure.className = 'answer-image-error';
    failure.setAttribute('role', 'status');
    failure.textContent = '图片无法显示，请在原页面查看。';
    const source = safeImageSource(address, doc);
    if (source && /^data:/i.test(source)) totalDataLength += source.length;
    if (!source || totalDataLength > MAX_TOTAL_DATA_LENGTH) {
      failure.textContent = '图片地址、格式或大小不受支持，请在原页面查看。';
      figure.append(caption, failure);
    } else {
      const image = doc.createElement('img');
      image.alt = label;
      image.loading = 'lazy';
      image.referrerPolicy = 'no-referrer';
      image.decoding = 'async';
      failure.hidden = true;
      image.addEventListener('error', () => { image.hidden = true; failure.hidden = false; }, { once: true });
      image.src = source;
      figure.append(caption, image, failure);
    }
    root.append(figure);
  });
  if (sources.length > MAX_IMAGES) {
    const remainder = doc.createElement('p');
    remainder.className = 'answer-image-error';
    remainder.textContent = '仅预览前 16 张图片，其余请在原页面查看。';
    root.append(remainder);
  }
  return root;
}
