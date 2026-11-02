import { privateStorageReady, type BackgroundRoutes } from '../../core/background-context';
import { sanitizeBankEntry } from '../answer-exchange/protocol';
import type { BankEntry } from '../answer-exchange/types';
import { localBankEntryIdentity } from './matching';
import { LOCAL_QUESTION_BANK_BYTE_LIMIT, LOCAL_QUESTION_BANK_KEY, LOCAL_QUESTION_BANK_LIMIT, type LocalBankSaveResult } from './types';

function cleanEntries(value: unknown): BankEntry[] {
  if (!Array.isArray(value) || value.length > LOCAL_QUESTION_BANK_LIMIT) throw new Error(`本地题库最多保存 ${LOCAL_QUESTION_BANK_LIMIT} 条题目，请分批整理。`);
  const entries = value.map((entry, index) => sanitizeBankEntry(entry, index));
  if (new TextEncoder().encode(JSON.stringify(entries)).byteLength > LOCAL_QUESTION_BANK_BYTE_LIMIT) throw new Error('本地题库超过存储上限，请减少题目数量或答案长度。');
  return entries;
}

export async function readStoredLocalBank(): Promise<BankEntry[]> {
  await privateStorageReady;
  const record = await chrome.storage.local.get(LOCAL_QUESTION_BANK_KEY);
  const value: unknown = record[LOCAL_QUESTION_BANK_KEY];
  if (value === undefined) return [];
  if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1 || !('items' in value)) throw new Error('本地题库数据无法识别，请清空后重新导入。');
  return cleanEntries(value.items);
}

let mutationTail = Promise.resolve();
function mutate<T>(operation: () => Promise<T>): Promise<T> {
  const result = mutationTail.then(operation);
  mutationTail = result.then(() => undefined, () => undefined);
  return result;
}

export function saveStoredLocalBank(value: unknown): Promise<LocalBankSaveResult> {
  return mutate(async () => {
    const incoming = cleanEntries(value);
    const current = await readStoredLocalBank();
    const identities = new Set(current.map(localBankEntryIdentity));
    const merged = [...current];
    for (const entry of incoming) {
      const identity = localBankEntryIdentity(entry);
      if (identities.has(identity)) continue;
      identities.add(identity);
      merged.push(entry);
    }
    const items = cleanEntries(merged);
    await chrome.storage.local.set({ [LOCAL_QUESTION_BANK_KEY]: { version: 1, items } });
    return { added: items.length - current.length, total: items.length };
  });
}

export function clearStoredLocalBank(): Promise<void> {
  return mutate(async () => {
    await privateStorageReady;
    await chrome.storage.local.remove(LOCAL_QUESTION_BANK_KEY);
  });
}

/** Only the extension's isolated top-page client can request this data; nothing crosses the page bridge. */
export const localQuestionBankRoutes: BackgroundRoutes = {
  'toolbox:local-question-bank:read': { access: 'top-page', platforms: ['chaoxing'], handle: async () => readStoredLocalBank() },
  'toolbox:local-question-bank:save': { access: 'top-page', platforms: ['chaoxing'], handle: async message => saveStoredLocalBank(message.entries) },
  'toolbox:local-question-bank:clear': { access: 'top-page', platforms: ['chaoxing'], handle: async () => clearStoredLocalBank() },
};
