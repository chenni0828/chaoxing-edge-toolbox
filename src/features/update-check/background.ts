import type { BackgroundRoutes } from '../../core/background-context';
import { createUpdateService } from './service';
import { UPDATE_STORAGE_KEY } from './types';

let service: ReturnType<typeof createUpdateService> | undefined;

function getService(): ReturnType<typeof createUpdateService> {
  service ??= createUpdateService({
    installedVersion: chrome.runtime.getManifest().version,
    readBuildInfo: async () => {
      const response = await fetch(chrome.runtime.getURL('build-info.json'));
      if (!response.ok) return undefined;
      return response.json();
    },
    readCache: async () => (await chrome.storage.local.get(UPDATE_STORAGE_KEY))[UPDATE_STORAGE_KEY],
    writeCache: async cache => { await chrome.storage.local.set({ [UPDATE_STORAGE_KEY]: cache }); },
  });
  return service;
}

export const updateCheckRoutes: BackgroundRoutes = {
  'toolbox:update:read': { access: 'options', handle: async () => getService().read() },
  'toolbox:update:check': { access: 'options', handle: async () => getService().check() },
};
