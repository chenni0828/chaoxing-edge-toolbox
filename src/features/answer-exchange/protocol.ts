import { normalizeAnswer } from '../question-answer/normalize';
import { isApplicableAnswer, isQuestionSnapshot } from '../question-answer/protocol';
import type { ApplicableAnswer, QuestionOption, QuestionSnapshot, QuestionTarget } from '../question-answer/types';
import {
  EXCHANGE_MAX_ITEMS, EXCHANGE_MAX_LENGTH, EXCHANGE_VERSION,
  type AnswerBatch, type AnswerPack, type BankEntry, type ExchangePack, type ResolvedExchangeAnswer,
} from './types';

const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const only = (value: Record<string, unknown>, keys: readonly string[]): boolean => Object.keys(value).every(key => keys.includes(key));
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value);
const questionKeys = ['kind', 'stem', 'options', 'fields', 'children', 'images', 'program'];
const internalQuestionKeys = [...questionKeys, 'key', 'fingerprint', 'number', 'supported', 'reason', 'textRecognition', 'markdown'];

function uniqueIds(values: Array<{ id: string }>): boolean {
  return values.every(value => identifier(value.id)) && new Set(values.map(value => value.id)).size === values.length;
}

function completeOptions(options: QuestionOption[]): boolean {
  return options.length >= 2 && uniqueIds(options)
    && options.every(option => option.text.trim().length > 0 && only(option as unknown as Record<string, unknown>, ['id', 'label', 'text']));
}

function validQuestionStructure(question: QuestionSnapshot): boolean {
  if (!question.stem.trim() || !uniqueIds(question.fields) || !uniqueIds(question.children)) return false;
  if (!question.fields.every(field => only(field as unknown as Record<string, unknown>, ['id', 'options']))
      || !question.children.every(child => only(child as unknown as Record<string, unknown>, ['id', 'stem', 'options']))) return false;
  if (['single', 'multiple', 'judgement'].includes(question.kind)) {
    return completeOptions(question.options) && !question.fields.length && !question.children.length
      && (question.kind !== 'judgement' || question.options.length === 2);
  }
  if (question.kind === 'completion') {
    return !question.options.length && !question.children.length && question.fields.length > 0
      && question.fields.every(field => field.options === undefined || field.options.length === 0);
  }
  if (question.kind === 'line') {
    return !question.options.length && !question.children.length && question.fields.length > 0
      && question.fields.every(field => Boolean(field.options && completeOptions(field.options)));
  }
  if (question.kind === 'fill' || question.kind === 'reader') {
    return !question.options.length && !question.fields.length && question.children.length > 0
      && question.children.every(child => completeOptions(child.options));
  }
  if (question.kind === 'program') {
    return !question.options.length && !question.fields.length && !question.children.length
      && Boolean(question.program?.language.trim());
  }
  return false;
}

/** The first exchange format deliberately requires complete, plain-text questions. */
export function canExportQuestion(question: QuestionSnapshot): boolean {
  return isQuestionSnapshot(question) && question.supported && !question.textRecognition
    && !question.images.length && validQuestionStructure(question);
}

export function createAnswerBatch(targets: QuestionTarget[], batchId: string = crypto.randomUUID()): AnswerBatch {
  if (!identifier(batchId)) throw new Error('导出批次编号无效，请重新复制提示词。');
  const available = targets.filter(target => canExportQuestion(target.question));
  if (!available.length) throw new Error('没有可导出的完整纯文本题目；图片、缺字和暂不支持的题目请手动处理。');
  if (available.length > EXCHANGE_MAX_ITEMS) throw new Error(`每批最多导出 ${EXCHANGE_MAX_ITEMS} 题，请分批处理。`);
  return { batchId, items: available.map((target, index) => ({ questionId: `q-${index + 1}`, target: structuredClone(target) })) };
}

function answerObject(value: unknown): value is ApplicableAnswer {
  return isApplicableAnswer(value) && Object.keys(value).length === 1;
}

/** Clean internal entries before persistence; page metadata never becomes part of a bank record. */
export function sanitizeBankEntry(value: unknown, index = 0): BankEntry {
  if (!object(value) || !only(value, ['question', 'answer']) || !object(value.question)
      || !only(value.question, internalQuestionKeys)) throw new Error(`题库第 ${index + 1} 条结构无效。`);
  const raw = value.question;
  if (raw.textRecognition !== undefined || (raw.supported !== undefined && raw.supported !== true)) {
    throw new Error(`题库第 ${index + 1} 条包含缺字或不支持的题目，未导入。`);
  }
  const question = {
    key: `bank-entry:${index + 1}`, fingerprint: `bank-entry:${index + 1}`, number: `${index + 1}`,
    kind: raw.kind, stem: raw.stem, options: raw.options, fields: raw.fields,
    children: raw.children, images: raw.images, supported: true,
    ...(raw.program !== undefined ? { program: raw.program } : {}),
  };
  if (!isQuestionSnapshot(question) || !canExportQuestion(question)) {
    throw new Error(`题库第 ${index + 1} 条题目不完整、超出限制或包含图片，未导入。`);
  }
  if (!answerObject(value.answer)) throw new Error(`题库第 ${index + 1} 条答案结构无效。`);
  const answer = normalizeAnswer(question, value.answer);
  if (!answer) throw new Error(`题库第 ${index + 1} 条答案无法完整且唯一地对应题目。`);
  return { question: structuredClone(question), answer };
}

export function parseExchangePack(text: string): ExchangePack {
  if (text.length > EXCHANGE_MAX_LENGTH) throw new Error('导入内容过长，请分批导入。');
  const source = text.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i, '$1').trim();
  let raw: unknown;
  try { raw = JSON.parse(source); } catch { throw new Error('内容不是完整的 JSON，请复制 AI 返回的完整结果。'); }
  if (!object(raw) || raw.version !== EXCHANGE_VERSION || !Array.isArray(raw.items)
      || raw.items.length > EXCHANGE_MAX_ITEMS) throw new Error('导入格式、版本或题目数量不符合要求。');
  if (raw.mode === 'answers') {
    if (!only(raw, ['version', 'mode', 'batchId', 'items']) || !identifier(raw.batchId)) throw new Error('答案包缺少有效批次编号或包含未知字段。');
    const ids = new Set<string>();
    const items = raw.items.map((entry, index): AnswerPack['items'][number] => {
      if (!object(entry) || !only(entry, ['questionId', 'status', 'answer']) || !identifier(entry.questionId)) {
        throw new Error(`答案包第 ${index + 1} 条题目标识或结构无效。`);
      }
      if (ids.has(entry.questionId)) throw new Error('答案包包含重复题目编号，未导入。');
      ids.add(entry.questionId);
      if (entry.status === 'unanswerable' && !('answer' in entry)) return { questionId: entry.questionId, status: 'unanswerable' };
      if (entry.status !== 'answered' || !answerObject(entry.answer)) throw new Error(`答案包第 ${index + 1} 条答案状态或结构无效。`);
      return { questionId: entry.questionId, status: 'answered', answer: structuredClone(entry.answer) };
    });
    return { version: EXCHANGE_VERSION, mode: 'answers', batchId: raw.batchId, items };
  }
  if (raw.mode === 'bank') {
    if (!only(raw, ['version', 'mode', 'items']) || !raw.items.length) throw new Error('题库格式无效或没有题目。');
    const items = raw.items.map((entry, index) => {
      if (!object(entry) || !object(entry.question) || !only(entry.question, questionKeys)) {
        throw new Error(`题库第 ${index + 1} 条含有未知题目字段，请按题库提示词重新生成。`);
      }
      return sanitizeBankEntry(entry, index);
    });
    return { version: EXCHANGE_VERSION, mode: 'bank', items };
  }
  throw new Error('无法识别导入模式，请使用插件提供的提示词生成答案或题库。');
}

export function resolveAnswerPack(pack: AnswerPack, batch: AnswerBatch): ResolvedExchangeAnswer[] {
  if (pack.batchId !== batch.batchId) throw new Error('答案包与本次导出批次不一致，请使用对应的提示词结果。');
  const known = new Map(batch.items.map(item => [item.questionId, item.target]));
  const seen = new Set<string>();
  const result: ResolvedExchangeAnswer[] = [];
  for (const item of pack.items) {
    const target = known.get(item.questionId);
    if (!target || seen.has(item.questionId)) throw new Error('答案包包含未知或重复题目编号，未导入。');
    seen.add(item.questionId);
    if (item.status === 'unanswerable') continue;
    if (!canExportQuestion(target.question)) throw new Error('原题内容已不可用，请重新读取并复制提示词。');
    const answer = normalizeAnswer(target.question, item.answer);
    if (!answer) throw new Error(`题目 ${item.questionId} 的答案未通过题型、选项或填写数量核对。`);
    result.push({ target: structuredClone(target), answer });
  }
  return result;
}
