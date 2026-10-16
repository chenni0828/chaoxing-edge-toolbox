import { isSupportedUrl } from '../shared/sites';

export type RouteAccess = 'public' | 'options' | 'top-page';
export interface BackgroundRoute {
  access: RouteAccess;
  handle(message: Record<string, unknown>, sender: chrome.runtime.MessageSender): Promise<unknown>;
}
export type BackgroundRoutes = Record<string, BackgroundRoute>;

/** Set the entire local area to trusted contexts before any feature accesses secrets. */
export const privateStorageReady = chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });

export function isExtensionPage(sender: chrome.runtime.MessageSender): boolean {
  return sender.id === chrome.runtime.id && Boolean(sender.url?.startsWith(chrome.runtime.getURL('')));
}

export function isSupportedContent(sender: chrome.runtime.MessageSender): boolean {
  return sender.id === chrome.runtime.id && sender.tab?.id !== undefined
    && (isSupportedUrl(sender.url) || isSupportedUrl(sender.origin)
      || (sender.url === 'about:blank' && isSupportedUrl(sender.tab.url)));
}

export function canAccess(access: RouteAccess, sender: chrome.runtime.MessageSender): boolean {
  if (sender.id !== chrome.runtime.id) return false;
  if (access === 'options') {
    return isExtensionPage(sender) && sender.url?.split(/[?#]/)[0] === chrome.runtime.getURL('options/index.html');
  }
  if (access === 'top-page') return isSupportedContent(sender) && sender.frameId === 0;
  return isExtensionPage(sender) || isSupportedContent(sender);
}

/** Only explicitly constructed public payloads may use this broadcaster. */
export async function broadcastPublic(message: Record<string, unknown>): Promise<void> {
  const tasks: Promise<unknown>[] = [chrome.runtime.sendMessage(message).catch(() => undefined)];
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.id !== undefined && isSupportedUrl(tab.url)) {
        tasks.push(chrome.tabs.sendMessage(tab.id, message).catch(() => undefined));
      }
    }
  } catch { /* Newly opened pages request their state explicitly. */ }
  await Promise.allSettled(tasks);
}
