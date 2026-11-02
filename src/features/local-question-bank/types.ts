import type { ApplicableAnswer } from '../question-answer/types';

export const LOCAL_QUESTION_BANK_KEY = 'toolbox.local-question-bank.v1';
export const LOCAL_QUESTION_BANK_LIMIT = 2000;
export const LOCAL_QUESTION_BANK_BYTE_LIMIT = 6_000_000;

export interface LocalBankMatch {
  status: 'matched' | 'missing' | 'conflict';
  answer?: ApplicableAnswer;
  message: string;
}

export interface LocalBankSaveResult { added: number; total: number }
