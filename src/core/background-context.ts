import { getPlatform, isSupportedUrl, type PlatformId } from '../shared/sites';

export type RouteAccess = 'public' | 'options' | 'top-page';
export interface BackgroundRoute {
  access: RouteAccess;
  platforms?: readonly PlatformId[];
  handle(message: Record<string, unknown>, sender: chrome.runtime.MessageSender): Promise<unknown>;
}
export type BackgroundRoutes = Record<string, BackgroundRoute>;

/** Set the entire local area to trusted contexts before any feature accesses secrets. */
export const privateStorageReady = chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });

export function isExtensionPage(sender: chrome.runtime.MessageSender): boolean {
  return sender.id === chrome.runtime.id && Boolean(sender.url?.startsWith(chrome.runtime.getURL('')));
}

export function senderPlatform(sender: chrome.runtime.MessageSender): PlatformId | undefined {
  if (sender.url && !['about:blank', 'about:srcdoc'].includes(sender.url)) return getPlatform(sender.url)?.id;
  return getPlatform(sender.origin)?.id ?? getPlatform(sender.tab?.url)?.id;
}

export function isSupportedContent(sender: chrome.runtime.MessageSender, platform?: PlatformId): boolean {
  const identified = senderPlatform(sender);
  return sender.id === chrome.runtime.id && sender.tab?.id !== undefined
    && identified !== undefined && (!platform || identified === platform);
}

export function canAccess(access: RouteAccess, sender: chrome.runtime.MessageSender, platforms?: readonly PlatformId[]): boolean {
  if (sender.id !== chrome.runtime.id) return false;
  if (access === 'options') {
    return isExtensionPage(sender) && sender.url?.split(/[?#]/)[0] === chrome.runtime.getURL('options/index.html');
  }
  if (!isExtensionPage(sender) && platforms && !platforms.some(platform => isSupportedContent(sender, platform))) return false;
  if (access === 'top-page') return isSupportedContent(sender) && sender.frameId === 0;
  return isExtensionPage(sender) || isSupportedContent(sender);
}

/** Only explicitly constructed public payloads may use this broadcaster. */
export async function broadcastPublic(message: Record<string, unknown>, platforms?: readonly PlatformId[]): Promise<void> {
  const tasks: Promise<unknown>[] = [chrome.runtime.sendMessage(message).catch(() => undefined)];
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.id !== undefined && isSupportedUrl(tab.url) && (!platforms || platforms.some(platform => platform === getPlatform(tab.url)?.id))) {
        tasks.push(chrome.tabs.sendMessage(tab.id, message).catch(() => undefined));
      }
    }
  } catch { /* Newly opened pages request their state explicitly. */ }
  await Promise.allSettled(tasks);
}
