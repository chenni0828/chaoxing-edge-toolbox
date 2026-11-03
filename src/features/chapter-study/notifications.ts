import { broadcastPublic, type BackgroundRoutes } from '../../core/background-context';
import { isFeatureEnabled } from '../toolbox-settings/types';
import { readStoredSettings } from '../toolbox-settings/background';
import { isChapterStudyUrl } from './adapters/chapter';
import { isStudyNotice } from './protocol';
import type { StudyNotice } from './types';

export const STUDY_NOTIFICATION_SETTINGS = 'toolbox.chapter-study.notifications.v1';
export const STUDY_NOTIFICATION_CHANGED = 'toolbox:study:notification-settings:changed';
const recordKey = (tabId: number) => `chapter-study.notice.${tabId}`;
const notificationId = (tabId: number) => `chapter-study-${tabId}`;
interface NoticeRecord { documentId: string; runId: string; eventId: string; shown: boolean; active: boolean }
export interface StudyNotificationSettings { enabled: boolean; granted: boolean }

export async function readStudyNotificationSettings(): Promise<StudyNotificationSettings> {
  const [stored, granted] = await Promise.all([
    chrome.storage.local.get(STUDY_NOTIFICATION_SETTINGS),
    chrome.permissions.contains({ permissions: ['notifications'] }),
  ]);
  return { enabled: stored[STUDY_NOTIFICATION_SETTINGS] === true && granted, granted };
}

/** Each tab has one notice. Revisions invalidate in-flight creates before they can revive a cleared alert. */
export function createStudyNoticeService() {
  const revisions = new Map<number, number>();
  const identities = new Map<number, { runId: string; documentId: string }>();
  const queues = new Map<number, Promise<void>>();
  const pendingNotices = new Map<number, { documentId: string; runId: string; eventId: string; operation: Promise<void> }>();
  function update(tabId: number, documentId: string, notice?: StudyNotice): Promise<void> {
    const identity = identities.get(tabId);
    if (notice?.kind === 'clear' && identity && (identity.runId !== notice.runId || identity.documentId !== documentId)) return Promise.resolve();
    const pending = pendingNotices.get(tabId);
    if (notice && notice.kind !== 'clear' && pending?.documentId === documentId && pending.runId === notice.runId && pending.eventId === notice.eventId) return pending.operation;
    pendingNotices.delete(tabId);
    if (notice && notice.kind !== 'clear') identities.set(tabId, { runId: notice.runId, documentId });
    if (!notice) identities.delete(tabId);
    const revision = (revisions.get(tabId) ?? 0) + 1;
    revisions.set(tabId, revision);
    const current = () => revisions.get(tabId) === revision;
    const operation = (queues.get(tabId) ?? Promise.resolve()).catch(() => {}).then(async () => {
      if (!current()) return;
      const key = recordKey(tabId);
      const previous = (await chrome.storage.session.get(key))[key] as NoticeRecord | undefined;
      if (!current()) return;
      if (!notice || notice.kind === 'clear') {
        if (notice && previous && (previous.runId !== notice.runId || previous.documentId !== documentId)) return;
        if (chrome.notifications) await chrome.notifications.clear(notificationId(tabId)).catch(() => false);
        if (previous && notice) await chrome.storage.session.set({ [key]: { ...previous, active: false } });
        else await chrome.storage.session.remove(key);
        return;
      }
      if (previous?.shown && previous.documentId === documentId && previous.runId === notice.runId && previous.eventId === notice.eventId) return;
      const [settings, toolbox] = await Promise.all([readStudyNotificationSettings(), readStoredSettings()]);
      if (!current() || !settings.enabled || !isFeatureEnabled(toolbox, 'chapter-study') || !chrome.notifications) return;
      const record: NoticeRecord = { documentId, runId: notice.runId, eventId: notice.eventId, shown: false, active: true };
      await chrome.storage.session.set({ [key]: record });
      if (!current()) return;
      try {
        await chrome.notifications.create(notificationId(tabId), {
          type: 'basic', iconUrl: chrome.runtime.getURL('icons/icon128.png'),
          title: notice.kind === 'verification' ? '学习工具箱 · 等待人脸验证' : '学习工具箱 · 需要处理',
          message: notice.message, contextMessage: '点击返回课程页面', silent: true,
        });
      } catch {
        await chrome.storage.session.set({ [key]: { ...record, shown: false, active: false } });
        return;
      }
      // Even a create completed during cancellation has already shown this episode.
      await chrome.storage.session.set({ [key]: { ...record, shown: true, active: current() } });
      if (!current()) await chrome.notifications.clear(notificationId(tabId)).catch(() => false);
    });
    queues.set(tabId, operation);
    if (notice && notice.kind !== 'clear') pendingNotices.set(tabId, { documentId, runId: notice.runId, eventId: notice.eventId, operation });
    void operation.finally(() => {
      if (queues.get(tabId) === operation) queues.delete(tabId);
      if (pendingNotices.get(tabId)?.operation === operation) pendingNotices.delete(tabId);
    }).catch(() => {});
    return operation;
  }
  async function clearAll(): Promise<void> {
    // Invalidate live creates before awaiting storage; a later new notice remains current.
    const clearing = [...revisions.keys()].map(tabId => update(tabId, ''));
    const records = await chrome.storage.session.get(null);
    const ids = Object.keys(records).filter(key => key.startsWith('chapter-study.notice.'))
      .map(key => Number(key.slice('chapter-study.notice.'.length))).filter(Number.isSafeInteger);
    for (const tabId of ids) if (!revisions.has(tabId)) clearing.push(update(tabId, ''));
    await Promise.allSettled(clearing);
  }
  return { update, clearAll };
}

const notices = createStudyNoticeService();
export const studyNotificationRoutes: BackgroundRoutes = {
  'toolbox:study:notifications:read': { access: 'public', platforms: ['chaoxing'], handle: readStudyNotificationSettings },
  'toolbox:study:notifications:write': { access: 'public', platforms: ['chaoxing'], handle: async message => {
    if (typeof message.enabled !== 'boolean') throw new Error('无效的通知设置。');
    if (message.enabled && !(await readStudyNotificationSettings()).granted) throw new Error('请先在扩展设置页授权系统通知。');
    await chrome.storage.local.set({ [STUDY_NOTIFICATION_SETTINGS]: message.enabled });
    if (!message.enabled) await notices.clearAll();
    return readStudyNotificationSettings();
  } },
  'toolbox:study:notice': { access: 'top-page', platforms: ['chaoxing'], handle: async (message, sender) => {
    if (!isStudyNotice(message.notice) || !isChapterStudyUrl(sender.url ?? '')) throw new Error('无效的章节提醒。');
    await notices.update(sender.tab!.id!, sender.documentId ?? sender.url!, message.notice);
  } },
};

export function installStudyNotifications(): void {
  let listening = false;
  let settingsRevision = 0;
  const listen = () => {
    if (listening || !chrome.notifications) return;
    listening = true;
    chrome.notifications.onClicked.addListener(id => {
      const match = /^chapter-study-(\d+)$/.exec(id);
      if (!match) return;
      const tabId = Number(match[1]);
      void (async () => {
        const record = (await chrome.storage.session.get(recordKey(tabId)))[recordKey(tabId)] as NoticeRecord | undefined;
        if (!record?.active) return;
        const tab = await chrome.tabs.get(tabId);
        if (!isChapterStudyUrl(tab.url ?? '')) return;
        await chrome.tabs.update(tabId, { active: true });
        if (tab.windowId >= 0) await chrome.windows.update(tab.windowId, { focused: true });
      })().catch(() => {}).finally(() => chrome.notifications.clear(id).catch(() => false));
    });
  };
  const changed = () => {
    listen();
    const revision = ++settingsRevision;
    void readStudyNotificationSettings().then(async settings => {
      if (revision !== settingsRevision) return;
      await broadcastPublic({ type: STUDY_NOTIFICATION_CHANGED, settings }, ['chaoxing']);
    }).catch(() => {});
  };
  listen();
  chrome.permissions.onAdded.addListener(changed);
  chrome.permissions.onRemoved.addListener(removed => {
    if (removed.permissions?.includes('notifications')) void notices.clearAll().catch(() => {});
    changed();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[STUDY_NOTIFICATION_SETTINGS]) return;
    if (changes[STUDY_NOTIFICATION_SETTINGS].newValue !== true) void notices.clearAll().catch(() => {});
    changed();
  });
  chrome.tabs.onRemoved.addListener(tabId => { void notices.update(tabId, '').catch(() => {}); });
  chrome.tabs.onUpdated.addListener((tabId, change) => {
    if (change.status === 'loading') void notices.update(tabId, '').catch(() => {});
  });
}
