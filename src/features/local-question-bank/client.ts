import { requestExtension } from '../../core/extension-rpc';
import type { BankEntry } from '../answer-exchange/types';
import type { LocalBankSaveResult } from './types';

export const readLocalBank = (): Promise<BankEntry[]> => requestExtension('toolbox:local-question-bank:read');
export const saveLocalBank = (entries: BankEntry[]): Promise<LocalBankSaveResult> => requestExtension('toolbox:local-question-bank:save', { entries });
export const clearLocalBank = (): Promise<void> => requestExtension('toolbox:local-question-bank:clear');
