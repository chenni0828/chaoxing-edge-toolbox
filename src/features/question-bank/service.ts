import { normalizeAnswer, questionOptionsText } from '../question-answer/normalize';
import type { AnswerResult, PreparedQuestion, QuestionSnapshot } from '../question-answer/types';
import { QUESTION_BANK_ENDPOINT, validateQuestionBankConfig, type QuestionBankConfig } from './types';

export class QuestionBankError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'QuestionBankError'; }
}

function record(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }

function redact(value: string, secret: string): string {
  let text = value;
  for (const token of [secret, encodeURIComponent(secret)]) if (token) text = text.split(token).join('[已隐藏]');
  return text;
}

function imageTokens(value: string, images: string[]): string {
  const replacements = images.map((url, index) => ({ url, placeholder: `[图片${index + 1}]` })).sort((left, right) => right.url.length - left.url.length);
  for (const { url, placeholder } of replacements) value = value.split(url).join(placeholder);
  return value;
}

function canonicalQuestion(question: QuestionSnapshot): QuestionSnapshot {
  const options = (values: QuestionSnapshot['options']) => values.map(option => ({ ...option, text: imageTokens(option.text, question.images) }));
  return { ...question, stem: imageTokens(question.stem, question.images), options: options(question.options),
    fields: question.fields.map(field => ({ ...field, ...(field.options ? { options: options(field.options) } : {}) })),
    children: question.children.map(child => ({ ...child, stem: imageTokens(child.stem, question.images), options: options(child.options) })),
  };
}

function redactAnswer(value: unknown, token: string, images: string[], depth = 0): unknown {
  if (depth > 8) throw new QuestionBankError('format', '言溪题库答案结构过深，已停止处理。');
  if (typeof value === 'string') return imageTokens(redact(value, token), images);
  if (Array.isArray(value)) return value.map(item => redactAnswer(item, token, images, depth + 1));
  if (record(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [redact(key, token), redactAnswer(item, token, images, depth + 1)]));
  return value;
}

function tags(value: unknown, token: string): AnswerResult['tags'] {
  if (!Array.isArray(value)) return undefined;
  return value.slice(0, 12).flatMap((item) => {
    if (typeof item === 'string') return [{ text: redact(item, token).slice(0, 120) }];
    if (!record(item) || typeof item.text !== 'string') return [];
    return [{ text: redact(item.text, token).slice(0, 120),
      ...(typeof item.title === 'string' ? { title: redact(item.title, token).slice(0, 240) } : {}),
      ...(typeof item.color === 'string' && /^#[\da-f]{3}(?:[\da-f]{3})?$/i.test(item.color) ? { color: item.color } : {}),
    }];
  });
}

/** Parses the question bank v2 response; code=0 carries a hint, never an answer. */
export function parseQuestionBankResponse(prepared: PreparedQuestion, value: unknown, token = ''): AnswerResult {
  if (!record(value) || !Number.isSafeInteger(value.code) || !record(value.data)) {
    throw new QuestionBankError('format', '言溪题库响应格式无效，已暂停；请检查配置后手动重试。');
  }
  const data = value.data;
  if (data.answer !== undefined && data.answer !== null && typeof data.answer !== 'string'
      && !(Array.isArray(data.answer) && data.answer.every(item => typeof item === 'string')) && !record(data.answer)) {
    throw new QuestionBankError('format', '言溪题库答案格式无效，已暂停。');
  }
  const extraTags = tags(data.tags, token);
  if (value.code === 0) {
    const hint = typeof data.answer === 'string' ? redact(data.answer, token).slice(0, 600) : '言溪题库未返回可用答案。';
    return { status: 'no-answer', source: 'bank', text: '', message: hint || '言溪题库未返回可用答案。', tags: extraTags };
  }
  if (typeof data.question !== 'string' || !data.question.trim() || data.question.length > 32000) {
    throw new QuestionBankError('format', '言溪题库答案缺少有效题目字段，已暂停，未把服务提示当作答案。');
  }
  const raw = data.answer ?? '';
  const safe = redactAnswer(raw, token, prepared.question.images);
  const text = (typeof safe === 'string' ? safe : JSON.stringify(safe)).slice(0, 32000);
  const answer = normalizeAnswer(canonicalQuestion(prepared.question), safe);
  return { status: answer ? 'answer' : 'no-answer', source: data.ai ? 'bank-ai' : 'bank', text, ...(answer ? { answer } : {}),
    tags: extraTags, ...(!answer ? { message: '言溪题库未返回可可靠填入的答案。' } : {}) };
}

async function readResponse(response: Response): Promise<unknown> {
  const maximum = 256 * 1024;
  if (Number(response.headers.get('content-length')) > maximum) throw new QuestionBankError('format', '言溪题库响应过大，已停止处理。');
  if (!response.body) throw new QuestionBankError('format', '言溪题库返回了空响应。');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let content = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (value) size += value.byteLength;
      if (size > maximum) throw new QuestionBankError('format', '言溪题库响应过大，已停止处理。');
      content += decoder.decode(value, { stream: !done });
      if (done) break;
    }
    try { return JSON.parse(content); } catch { throw new QuestionBankError('format', '言溪题库未返回有效 JSON，已暂停。'); }
  } finally {
    try { await reader.cancel(); } catch { /* Cancellation may already have closed the response. */ }
    reader.releaseLock();
  }
}

/** Background-only call: a fixed endpoint, private token, no cookie or redirect forwarding. */
export async function queryQuestionBank(config: QuestionBankConfig, prepared: PreparedQuestion, signal: AbortSignal): Promise<AnswerResult> {
  validateQuestionBankConfig(config);
  if (signal.aborted) throw new QuestionBankError('cancelled', '已取消题库查询。');
  const abort = new AbortController();
  const cancel = () => abort.abort();
  signal.addEventListener('abort', cancel, { once: true });
  if (signal.aborted) cancel();
  let timedOut = false;
  const totalTimer = setTimeout(() => { timedOut = true; abort.abort(); }, 90000);
  const headerTimer = setTimeout(() => { timedOut = true; abort.abort(); }, 25000);
  try {
    const question = prepared.question;
    const response = await fetch(QUESTION_BANK_ENDPOINT, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ token: config.token, title: question.stem,
        options: questionOptionsText(question), type: question.kind,
        images: prepared.images, v: '2', suggestion_title: prepared.suggestionTitle, suggestion_options: prepared.suggestionOptions }),
      signal: abort.signal, credentials: 'omit', cache: 'no-store', redirect: 'manual', referrerPolicy: 'no-referrer',
    });
    clearTimeout(headerTimer);
    if (response.type === 'opaqueredirect' || response.status >= 300 && response.status < 400) throw new QuestionBankError('redirect', '言溪题库发生重定向，已停止且不会转发 Token。');
    if (response.status === 401 || response.status === 403) throw new QuestionBankError('auth', '言溪题库鉴权失败，请检查 Token。');
    if (response.status === 429) throw new QuestionBankError('rate-limit', '言溪题库限流或额度不足，请检查后手动重试。');
    if (!response.ok) throw new QuestionBankError('http', `言溪题库请求失败（HTTP ${response.status}），已暂停。`);
    const result = parseQuestionBankResponse(prepared, await readResponse(response), config.token);
    if (signal.aborted) throw new QuestionBankError('cancelled', '已取消题库查询。');
    return result;
  } catch (error) {
    if (error instanceof QuestionBankError) throw error;
    if (signal.aborted) throw new QuestionBankError('cancelled', '已取消题库查询。');
    if (timedOut) throw new QuestionBankError('timeout', '言溪题库请求超时，已暂停；不会自动重试。');
    throw new QuestionBankError('network', '言溪题库网络请求失败，已暂停；请检查网络和域名权限。');
  } finally {
    clearTimeout(totalTimer); clearTimeout(headerTimer); signal.removeEventListener('abort', cancel);
  }
}
