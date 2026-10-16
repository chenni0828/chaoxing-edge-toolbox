import { requestExtension } from '../core/extension-rpc';
export type SettingsSection = 'api' | 'features' | 'floating';
export const openSettings = (section: SettingsSection = 'features'): Promise<void> => requestExtension('toolbox:open-settings', { section });
