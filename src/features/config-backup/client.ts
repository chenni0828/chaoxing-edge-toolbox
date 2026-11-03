import { requestExtension } from '../../core/extension-rpc';
import type { ConfigBackup } from './format';

export const exportConfigBackup = (): Promise<ConfigBackup> => requestExtension('toolbox:config-backup:export');
export const restoreConfigBackup = (backup: ConfigBackup): Promise<void> => requestExtension('toolbox:config-backup:restore', { backup });
