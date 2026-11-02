import type { ApplicableAnswer, QuestionSnapshot, QuestionTarget } from '../question-answer/types';

export const EXCHANGE_VERSION = 1;
export const EXCHANGE_MAX_ITEMS = 300;
export const EXCHANGE_MAX_LENGTH = 2_000_000;

export interface AnswerBatch {
  batchId: string;
  items: Array<{ questionId: string; target: QuestionTarget }>;
}

export interface AnswerPack {
  version: 1;
  mode: 'answers';
  batchId: string;
  items: Array<{
    questionId: string;
    status: 'answered' | 'unanswerable';
    answer?: ApplicableAnswer;
  }>;
}

export interface BankEntry {
  question: QuestionSnapshot;
  answer: ApplicableAnswer;
}

export interface BankPack {
  version: 1;
  mode: 'bank';
  items: BankEntry[];
}

export type ExchangePack = AnswerPack | BankPack;

export interface ResolvedExchangeAnswer {
  target: QuestionTarget;
  answer: ApplicableAnswer;
}
