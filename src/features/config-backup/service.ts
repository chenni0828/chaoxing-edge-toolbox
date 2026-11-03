import { API_SETTINGS_KEY, normalizeApiConfig, validateApiConfig, apiOrigin } from '../api-settings/types';
import { QUESTION_BANK_SETTINGS_KEY, QUESTION_BANK_ORIGIN, normalizeQuestionBankConfig, validateQuestionBankConfig } from '../question-bank/types';
import { BACKUP_FORMAT, backupOrigins, validateConfigBackup, type ConfigBackup } from './format';

interface BackupDependencies {
  read(): Promise<Record<string, unknown>>;
  write(values: Record<string, unknown>): Promise<void>;
  authorized(origins: string[]): Promise<boolean>;
  release(origin: string): Promise<void>;
  now?(): Date;
}

export function createConfigBackupService(deps: BackupDependencies) {
  return {
    async export(): Promise<ConfigBackup> {
      const record = await deps.read();
      const api = normalizeApiConfig(record[API_SETTINGS_KEY]);
      const questionBank = normalizeQuestionBankConfig(record[QUESTION_BANK_SETTINGS_KEY]);
      const backup: ConfigBackup = { format: BACKUP_FORMAT, version: 1, exportedAt: (deps.now?.() ?? new Date()).toISOString() };
      if (api.endpoint || api.apiKey || api.model) {
        try { validateApiConfig(api); } catch { throw new Error('已保存的 API 配置不完整，请先检查后重新导出。'); }
        backup.api = api;
      }
      if (questionBank.token) {
        try { validateQuestionBankConfig(questionBank); } catch { throw new Error('已保存的题库配置无效，请先检查后重新导出。'); }
        backup.questionBank = questionBank;
      }
      if (!backup.api && !backup.questionBank) throw new Error('尚无已保存的 API 或言溪题库配置可以导出。');
      return backup;
    },
    async restore(value: unknown): Promise<void> {
      const backup = validateConfigBackup(value);
      if (!await deps.authorized(backupOrigins(backup))) throw new Error('未获得备份所需的域名权限，已有配置未修改。');
      const previous = await deps.read();
      const values: Record<string, unknown> = {};
      if (backup.api) values[API_SETTINGS_KEY] = backup.api;
      if (backup.questionBank) values[QUESTION_BANK_SETTINGS_KEY] = backup.questionBank;
      await deps.write(values);
      if (!backup.api) return;
      // Permissions may be shared with the bank. Release only after the full restore commits.
      const oldApi = normalizeApiConfig(previous[API_SETTINGS_KEY]);
      const bank = backup.questionBank ?? normalizeQuestionBankConfig(previous[QUESTION_BANK_SETTINGS_KEY]);
      try {
        if (oldApi.endpoint) {
          const oldOrigin = apiOrigin(oldApi.endpoint);
          if (oldOrigin !== apiOrigin(backup.api.endpoint) && !(bank.token && oldOrigin === QUESTION_BANK_ORIGIN)) await deps.release(oldOrigin);
        }
      } catch { /* A stale or shared permission never invalidates a successful restore. */ }
    },
  };
}
