import { privateStorageReady, type BackgroundRoutes } from '../../core/background-context';
import { API_SETTINGS_KEY } from '../api-settings/types';
import { withApiConfigMutation } from '../api-settings/background';
import { QUESTION_BANK_SETTINGS_KEY } from '../question-bank/types';
import { createConfigBackupService } from './service';

const service = createConfigBackupService({
  read: async () => { await privateStorageReady; return chrome.storage.local.get([API_SETTINGS_KEY, QUESTION_BANK_SETTINGS_KEY]); },
  write: async values => { await privateStorageReady; await chrome.storage.local.set(values); },
  authorized: origins => chrome.permissions.contains({ origins }),
  release: async origin => { await chrome.permissions.remove({ origins: [origin] }); },
});

/** Backup payloads contain secrets and are restricted to the trusted options page. */
export const configBackupRoutes: BackgroundRoutes = {
  'toolbox:config-backup:export': { access: 'options', handle: async () => service.export() },
  'toolbox:config-backup:restore': { access: 'options', handle: async message => withApiConfigMutation(() => service.restore(message.backup)) },
};
